import dotenv from "dotenv";
dotenv.config();
import { create } from "ipfs-http-client";
import fs from "fs";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import createTorrent from "create-torrent";
import WebTorrent from "webtorrent";

// Derive __dirname for ES modules
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const FILE_PATH = "./MOVIE5.mp4"; // Path to your video file
const FILEBASE_ACCESS_KEY = process.env.FILEBASE_ACCESS_KEY; // Replace with your Filebase Access Key
const FILEBASE_SECRET_KEY = process.env.FILEBASE_SECRET_KEY; // Replace with your Filebase Secret Key
const FILEBASE_BUCKET_NAME = process.env.FILEBASE_BUCKET_NAME; // Replace with your Filebase bucket name

async function calculateCID(filePath) {
  const ipfs = create();
  const fileContent = fs.readFileSync(filePath);
  const result = await ipfs.add(fileContent, { onlyHash: true });
  return result.cid.toString();
}

async function main() {
  try {
    // Calculate the CID locally
    const cid = await calculateCID(FILE_PATH);
    console.log("Pre-calculated CID:", cid);

    // Initialize AWS S3 client for Filebase
    const s3 = new S3Client({
      endpoint: "https://s3.filebase.com",
      region: "us-east-1",
      credentials: {
        accessKeyId: FILEBASE_ACCESS_KEY,
        secretAccessKey: FILEBASE_SECRET_KEY,
      },
    });

    // Upload file to Filebase
    const fileContent = fs.readFileSync(FILE_PATH);
    const params = {
      Bucket: FILEBASE_BUCKET_NAME,
      Key: cid, // Use the CID as the key
      Body: fileContent,
    };

    const command = new PutObjectCommand(params);
    const response = await s3.send(command);
    console.log("File uploaded to Filebase. Response:", response);

    // Generate a public URL for the file
    const ipfsUrl = `https://ipfs.filebase.io/ipfs/${cid}`;
    console.log("Public IPFS URL:", ipfsUrl);

    // Download the file from IPFS (optional, if you want to work locally)
    console.log("Downloading file from IPFS...");
    const arrayBuffer = await fetch(ipfsUrl).then((res) => res.arrayBuffer());
    const downloadedFilePath = path.join(__dirname, "downloaded-MOVIE5.mp4");
    fs.writeFileSync(downloadedFilePath, Buffer.from(arrayBuffer));
    console.log(`File downloaded to: ${downloadedFilePath}`);

    // Create a .torrent file
    console.log("Creating .torrent file...");
    createTorrent(
      downloadedFilePath,
      { announce: ["wss://tracker.openwebtorrent.com"] },
      (err, torrent) => {
        if (err) {
          console.error("Error creating torrent:", err);
          return;
        }

        const torrentFilePath = path.join(__dirname, "MOVIE5.torrent");
        fs.writeFileSync(torrentFilePath, torrent);
        console.log(`.torrent file created: ${torrentFilePath}`);

        // Seed the file using WebTorrent
        console.log("Seeding file with WebTorrent...");
        const client = new WebTorrent();
        client.seed(
          downloadedFilePath,
          { announce: ["wss://tracker.openwebtorrent.com"] },
          (torrent) => {
            console.log("File is now seeding.");
            console.log("Magnet link:", torrent.magnetURI);

            // Keep the script running to continue seeding
            console.log("Press Ctrl+C to stop seeding.");
          }
        );
      }
    );
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
