import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "fs";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import createTorrent from "create-torrent";
import WebTorrent from "webtorrent";
import dotenv from "dotenv";
import axios from "axios";
import FormData from "form-data";
import Video from "./structure/models/Video.js";
import Image from "./structure/models/Image.js";
import User from "./structure/models/User.js";
import Neighborhood from "./structure/models/Neighborhood.js";
import { reactiveBooster } from "./seedService.js";

dotenv.config();

const SLICE_SIZE = 500 * 1024 * 1024; // 500MB
const MIN_VIDEO_SIZE_FOR_SLICING = 500 * 1024 * 1024; // 500MB

const UPLOAD_TMP = "/tmp/uploads";

const announce = [
  "wss://tracker-0ad4cca9fd92.herokuapp.com",
  "wss://tracker.files.fm:7073/announce",
  "wss://tracker.webtorrent.dev",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.files.fm:7073",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://9.rarbg.to:2710/announce",
  "udp://tracker.coppersurfer.tk:6969/announce",
  "udp://tracker.leechers-paradise.org:6969/announce",
  "udp://tracker.internetwarriors.net:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://opentor.org:2710/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://tracker3.itzmx.com:6961/announce",
];

const FILEBASE_ACCESS_KEY = process.env.FILEBASE_ACCESS_KEY;
const FILEBASE_SECRET_KEY = process.env.FILEBASE_SECRET_KEY;
const FILEBASE_BUCKET_NAME = process.env.FILEBASE_BUCKET_NAME;
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY;

const getFileType = (mimetype, originalname) => {
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("audio/")) return "audio";

  const ext = originalname.split(".").pop().toLowerCase();
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (
    [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "heic",
      "avif",
      "tiff",
      "bmp",
      "svg",
      "ico",
    ].includes(ext)
  )
    return "image";
  if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return "audio";

  return "file";
};

export const authenticateUser = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send("Unauthorized: Missing or invalid token.");
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error(error);
    return res.status(401).send("Unauthorized: Invalid token.");
  }
};

// Upload to Pinata
async function uploadToPinata(fileBuffer, fileName, mimeType) {
  try {
    console.log("📤 Uploading to Pinata:", fileName);

     let normalizedMime = mimeType;
     if (mimeType === "video/quicktime") {
       normalizedMime = "video/mp4";
     } else if (mimeType === "video/x-m4v") {
       normalizedMime = "video/mp4";
     }
    
    const formData = new FormData();
    formData.append("file", fileBuffer, {
      filename: fileName,
      contentType: normalizedMime,
    });
    formData.append("pinataMetadata", JSON.stringify({ name: fileName }));
    formData.append("pinataOptions", JSON.stringify({ cidVersion: 0 }));

    const response = await axios.post(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${PINATA_JWT}`,
        },
      },
    );

    const cid = response.data.IpfsHash;
    const ipfsUrl = `https://${PINATA_GATEWAY}/ipfs/${cid}`;
    console.log("✅ Pinata upload successful:", { cid, ipfsUrl });
    return { cid, ipfsUrl };
  } catch (error) {
    console.error(
      "❌ Pinata upload error:",
      error.response?.data || error.message,
    );
    throw new Error(`Pinata upload failed: ${error.message}`);
  }
}

// Upload to Filebase
async function uploadToFilebase(fileBuffer, fileName, mimeType) {
  try {
    console.log("📤 Uploading to Filebase:", fileName);
    const s3 = new S3Client({
      endpoint: "https://s3.filebase.com",
      region: "us-east-1",
      credentials: {
        accessKeyId: FILEBASE_ACCESS_KEY,
        secretAccessKey: FILEBASE_SECRET_KEY,
      },
    });

    const timestamp = Date.now();
    const key = `${timestamp}_${fileName.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: FILEBASE_BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType,
        Metadata: { originalname: fileName },
      }),
    );

    const cid = key;
    const ipfsUrl = `https://${FILEBASE_BUCKET_NAME}.s3.filebase.com/${key}`;
    return { cid, ipfsUrl };
  } catch (error) {
    console.error("❌ Filebase upload error:", error);
    throw new Error(`Filebase upload failed: ${error.message}`);
  }
}

// Write a buffer to disk and return the path
async function writeToDisk(buffer, filename) {
  if (!fs.existsSync(UPLOAD_TMP)) {
    fs.mkdirSync(UPLOAD_TMP, { recursive: true });
  }

  const filePath = path.join(UPLOAD_TMP, filename);
  const writePath = filePath + ".tmp";

  await fs.promises.writeFile(writePath, buffer);
  await fs.promises.rename(writePath, filePath);

  return filePath;
}

export default (app) => {
  const uploadHandler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
  }).any();

  async function handleUpload(req, res) {
    const { title, description, neighborhoodId, mediaType } = req.body;
    const uid = req.user?.userId;

    const user = await User.findById(uid).select("isPublic").lean();
    const bubble = neighborhoodId
      ? await Neighborhood.findById(neighborhoodId).select("type").lean()
      : null;

    const isPublic = user?.isPublic === true && bubble?.type === "global";

    const file = req.files?.[0] || req.file;
    if (!file) {
      return res.status(400).send("No file uploaded.");
    }

    const detectedType =
      mediaType || getFileType(file.mimetype, file.originalname);

    console.log(`📤 Uploading ${detectedType}:`, file.originalname);

    try {
      // ────────────────────────────────────────────────
      // IMAGE
      // ────────────────────────────────────────────────
      if (detectedType === "image") {
        const { cid, ipfsUrl } = await uploadToPinata(
          file.buffer,
          file.originalname,
          file.mimetype,
        );

        const webseed = `https://ebubbl.com/api/webseed/${cid}`;

        // Images are small — keep passing the buffer
        const magnetLink = await reactiveBooster.boostChunkIfNeeded(
          file.buffer,
          `image-${cid}`,
          announce,
          [webseed],
        );

        const newImage = new Image({
          title: title || file.originalname,
          description,
          user: uid,
          fileName: file.originalname,
          fileSize: file.size,
          fileType: "image",
          cid,
          ipfsUrl,
          magnetLink,
          neighborhood: neighborhoodId || null,
          isPublic,
        });

        await newImage.save();

        return res.json({
          success: true,
          imageId: newImage._id,
          ipfsUrl,
          magnetLink,
          cid,
        });
      }

      // ────────────────────────────────────────────────
      // VIDEO
      // ────────────────────────────────────────────────
      if (detectedType === "video") {
        const fullBuffer = file.buffer;

        // --- LARGE VIDEO: SLICE ---
        if (fullBuffer.length > MIN_VIDEO_SIZE_FOR_SLICING) {
          const totalSlices = Math.ceil(fullBuffer.length / SLICE_SIZE);
          const sliceRecords = [];

          for (let i = 0; i < totalSlices; i++) {
            const start = i * SLICE_SIZE;
            const end = Math.min(start + SLICE_SIZE, fullBuffer.length);
            const chunkBuffer = fullBuffer.slice(start, end);

            const { cid, ipfsUrl } = await uploadToPinata(
              chunkBuffer,
              `slice-${i}-${file.originalname}`,
              file.mimetype,
            );
        const webseed = `https://ebubbl.com/api/webseed/${cid}`;

            // Write slice to disk, seed from path
            const slicePath = await writeToDisk(
              chunkBuffer,
              `slice-${cid}.mp4`,
            );
console.log("WEBSEED ARRAY:", [webseed]);
            const magnetLink = await reactiveBooster.boostChunkIfNeeded(
              slicePath,
              `gallery-${cid}`,
              announce,
              [webseed],
            );

            sliceRecords.push({
              index: i,
              cid,
              magnetLink,
              size: chunkBuffer.length,
            });
          }

          const newVideo = new Video({
            title: title || file.originalname,
            description,
            user: uid,
            fileName: file.originalname,
            fileSize: file.size,
            fileType: "video",
            cid: sliceRecords[0].cid,
            ipfsUrl: `https://${PINATA_GATEWAY}/ipfs/${sliceRecords[0].cid}`,
            magnetLink: sliceRecords[0].magnetLink,
            neighborhood: neighborhoodId || null,
            isSliced: true,
            isPublic,
            slices: sliceRecords,
          });

          await newVideo.save();

          return res.json({
            success: true,
            videoId: newVideo._id,
            totalSlices,
            slices: sliceRecords,
            ipfsUrl: newVideo.ipfsUrl,
            magnetLink: newVideo.magnetLink,
            cid: newVideo.cid,
          });
        }

        // --- SMALL VIDEO: SINGLE FILE ---
        const { cid, ipfsUrl } = await uploadToPinata(
          fullBuffer,
          file.originalname,
          file.mimetype,
        );

        // Write video to disk, seed from path
        const videoPath = await writeToDisk(fullBuffer, `video-${cid}.mp4`);
        const webseed = `https://ebubbl.com/api/webseed/${cid}`;

        console.log("WEBSEED ARRAY:", [webseed]);
        const magnetLink = await reactiveBooster.boostChunkIfNeeded(
          videoPath,
          `video-${cid}`,
          announce,
          [webseed],
        );

        const newVideo = new Video({
          title: title || file.originalname,
          description,
          user: uid,
          fileName: file.originalname,
          fileSize: file.size,
          fileType: "video",
          cid,
          ipfsUrl,
          isPublic,
          magnetLink,
          neighborhood: neighborhoodId || null,
          isSliced: false,
          slices: [],
        });

        await newVideo.save();

        return res.json({
          success: true,
          videoId: newVideo._id,
          totalSlices: 1,
          ipfsUrl,
          magnetLink,
          cid,
        });
      }

      return res.status(400).send("Unsupported file type");
    } catch (error) {
      console.error("❌ Upload failed:", error);
      res.status(500).send(`Upload failed: ${error.message}`);
    }
  }

  app.post("/upload", authenticateUser, uploadHandler, handleUpload);
};
