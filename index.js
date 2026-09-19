import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import jwt from "jsonwebtoken";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import pubsub from "./structure/pubsub.js";
import { Server } from "socket.io";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/use/ws";

import typeDefs from "./structure/typedefs/typedefs.js";
import ModelSchema from "./structure/models/index.js";
import mutationResolvers from "./structure/resolvers/mutations/mutations.js";
//import subscriptionResolvers from "./structure/resolvers/subscriptions/subscriptions.js";
import ogRoutes from "./ogRoutes.js";
import connectDB from "./config/connection.js";
import videoUploadHandler from "./videoUploadHandler.js";
import Video from "./structure/models/Video.js";
import Image from "./structure/models/Image.js";
import Neighborhood from "./structure/models/Neighborhood.js";
import MediaAPI from "./datasources/MediaAPI.cjs";

import { reactiveBooster } from "./seedService.js";
import fs from "fs";
import StreamChunk from "./structure/models/StreamChunk.js";
import Stream from "./structure/models/Stream.js";


dotenv.config();
// At the top of your backend file, after the imports
const announce = [
  "wss://tracker-0ad4cca9fd92.herokuapp.com",
  "wss://tracker.files.fm:7073/announce",
  "wss://tracker.webtorrent.dev",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
// In index.js, instead of importing subscriptions.js
const subscriptionResolvers = {
  Subscription: {
    livestreamChunkAdded: {
      // Use the 'subscribe' property correctly
      subscribe: (_, { sessionId }) => {
        const channel = `LIVESTREAM_CHUNK_ADDED_${sessionId}`;

        // Debug: Check if pubsub exists and what methods it has
        if (!pubsub) {
          console.error("🔴 PubSub is undefined!");
        } else {
        }

        return pubsub.asyncIterableIterator(channel);
      },
    },
  },
};
/*
const corsOptions = {
  origin:
    process.env.NODE_ENV === "production"
      ? [
          "https://shiny-space-memory-w6g6755pp5jhgv69-8081.app.github.dev",
          "https://bubblebase.app",
          "https://gigunit.com",
          "https://gigunit.vercel.app",
          "https://studio.apollographql.com",
        "https://studio.apollographql.dev",
          "http://192.168.1.234:8081",
          "http://localhost:3001",
          "http://localhost:8081",
          "http://127.0.0.1:5501",
          "http://localhost:19006",
          "exp://localhost:19000",
        ]
      : [
          "https://shiny-space-memory-w6g6755pp5jhgv69-8081.app.github.dev",
          "https://studio.apollographql.com",
          "https://bubblebase.app",
          "https://gigunit.com",
          "https://gigunit.vercel.app",
          "http://localhost:3001",
          "http://localhost:3001/graphql",
          "http://localhost:8081",
          "http://localhost:8081/",
          "http://127.0.0.1:5501",
        ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  exposedHeaders: ["Content-Length", "X-Powered-By"],
  maxAge: 86400,
};
*/
const corsOptions = {
  // Allow any origin during this testing phase
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  exposedHeaders: ["Content-Length", "X-Powered-By"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(ogRoutes);
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY;

connectDB();

// Import models
import Minnow from "./structure/models/User.js";
const User = Minnow;
const Message = ModelSchema.Message;

// ========== IMPORTANT MISSING PIECES FROM OLDEST VERSION ==========

// Helper function for expires header
const getExpiresDate = (maxAgeSeconds) => {
  return new Date(Date.now() + maxAgeSeconds * 1000).toUTCString();
};

// Middleware for Authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// SIMPLE ACCESS CHECK FUNCTION
async function checkPrivateMediaAccess(media, user) {
  if (!user) return false;

  // 1. Owner can always access
  if (media.user && media.user.toString() === user.userId) {
    return true;
  }

  // 2. If media has a neighborhood, check membership
  if (media.neighborhood) {
    const neighborhood = await Neighborhood.findById(media.neighborhood)
      .select("members")
      .lean();

    if (!neighborhood) return false;

    return neighborhood.members.some(
      (member) => member.user.toString() === user.userId,
    );
  }

  return false;
}

// ========== REST API ROUTES FROM OLDEST VERSION ==========
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// 1. PUBLIC endpoint - NO AUTH, aggressively cached
app.get("/api/media/public/:cid", async (req, res) => {
  const oneWeek = 604800;
  const thirtyDays = 2592000;

  try {
    let media = await Video.findOne({ cid: req.params.cid }).lean();
    let mediaType = "video";

    if (!media) {
      media = await Image.findOne({ cid: req.params.cid }).lean();
      mediaType = "image";
    }

    if (!media) {
      res.set({ "Cache-Control": "public, max-age=3600" });
      return res.status(404).json({ error: "Media not found" });
    }

    // Only serve if media isPublic = true
    if (!media.isPublic) {
      res.set({ "Cache-Control": "no-cache" });
      return res.status(404).json({ error: "Media not found" });
    }

    res.set({
      "Cache-Control": `public, max-age=${oneWeek}, immutable`,
      "CDN-Cache-Control": `public, max-age=${thirtyDays}`,
      Expires: getExpiresDate(thirtyDays),
      Vary: "Accept-Encoding",
    });

    return res.json({
      fileName: media.fileName,
      fileType: media.fileType,
      cid: media.cid,
      magnetLink: media.magnetLink,
      isPublic: true,
      mediaType: mediaType,
    });
  } catch (error) {
    console.error("Public media API error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 2. PRIVATE endpoint - REQUIRES AUTH, user-specific cache
app.get("/api/media/private/:cid", authenticateToken, async (req, res) => {
  try {
    let media = await Video.findOne({ cid: req.params.cid }).lean();
    let mediaType = "video";

    if (!media) {
      media = await Image.findOne({ cid: req.params.cid }).lean();
      mediaType = "image";
    }

    if (!media) {
      res.set({ "Cache-Control": "no-cache" });
      return res.status(404).json({ error: "Media not found" });
    }

    const hasAccess = await checkPrivateMediaAccess(media, req.user);

    if (!hasAccess) {
      res.set({ "Cache-Control": "no-cache" });
      return res.status(403).json({ error: "Access denied" });
    }

    res.set({
      "Cache-Control": `private, max-age=604800, must-revalidate`,
      "CDN-Cache-Control": `private, max-age=604800`,
      Vary: "Accept-Encoding, Authorization",
      Expires: getExpiresDate(604800),
    });

    return res.json({
      fileName: media.fileName,
      fileType: media.fileType,
      cid: media.cid,
      magnetLink: media.magnetLink,
      isPublic: media.isPublic,
      mediaType: mediaType,
    });
  } catch (error) {
    console.error("Private media API error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 3. SMART endpoint - Auto-detects public/private
app.get("/api/media/:cid", async (req, res) => {
  try {
    let user = null;
    const authHeader = req.headers["authorization"];

    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        user = { userId: decoded.userId };
      } catch (error) {
        // Invalid token, treat as anonymous
      }
    }

    let media = await Video.findOne({ cid: req.params.cid }).lean();
    let mediaType = "video";

    if (!media) {
      media = await Image.findOne({ cid: req.params.cid }).lean();
      mediaType = "image";
    }

    if (!media) {
      res.set({ "Cache-Control": "public, max-age=3600" });
      return res.status(404).json({ error: "Media not found" });
    }

    // SIMPLE BINARY LOGIC
    if (media.isPublic) {
      // PUBLIC: Anyone can see, aggressive caching
      res.set({
        "Cache-Control": `public, max-age=604800, immutable`,
        "CDN-Cache-Control": `public, max-age=2592000`,
        Vary: "Accept-Encoding",
      });
    } else {
      // PRIVATE: Check access
      const hasAccess = await checkPrivateMediaAccess(media, user);

      if (!hasAccess) {
        res.set({ "Cache-Control": "no-cache" });
        return res.status(403).json({ error: "Access denied" });
      }

      // Private content, user-specific cache
      res.set({
        "Cache-Control": `private, max-age=604800, must-revalidate`,
        "CDN-Cache-Control": `private, max-age=604800`,
        Vary: "Accept-Encoding, Authorization",
      });
    }

    return res.json({
      fileName: media.fileName,
      fileType: media.fileType,
      cid: media.cid,
      magnetLink: media.magnetLink,
      isPublic: media.isPublic,
      mediaType: mediaType,
    });
  } catch (error) {
    console.error("Media API error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// In your backend - cleanup job

// ========== MULTER UPLOAD CONFIGURATION ==========
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
});

// ========== LIVE STREAM CHUNK UPLOAD ==========
// Reuse your multer memoryStorage
const liveChunkUpload = multer({ storage: multer.memoryStorage() });

app.post(
  "/api/live-chunk",
  authenticateToken,
  liveChunkUpload.single("chunk"),
  async (req, res) => {


    try {
      // 1. DATA EXTRACTION - Use let/const consistently
      const { sessionId, chunkIndex, rotation } = req.body;
      const file = req.file;

      // 2. CRITICAL VALIDATION (The 500 Killers)
      if (!file || !file.buffer) {
        console.error("🔴 [LIVE-CHUNK] ERROR: No file buffer found.");
        return res.status(400).json({ success: false, error: "No file data" });
      }
      if (!sessionId) {
        console.error("🔴 [LIVE-CHUNK] ERROR: Missing sessionId.");
        return res
          .status(400)
          .json({ success: false, error: "Missing sessionId" });
      }

      // ✅ Use the full codec string
      const mimeType = 'video/mp4; codecs="mp4a.40.2,avc1.4d4015"';
      const indexInt = parseInt(chunkIndex);

      // 3. SEED SERVICE
      const trackers = [
        "wss://tracker-0ad4cca9fd92.herokuapp.com",
        "wss://tracker.openwebtorrent.com",
        "wss://tracker.webtorrent.dev",
      ];

      // Setup temp file
      const tempDir = path.join("/tmp", "live-chunks", sessionId);
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      const tempFilePath = path.join(tempDir, `chunk-${indexInt}.${ext}`);

      // Atomic write
      const writePath = tempFilePath + ".tmp";
      await fs.promises.writeFile(writePath, file.buffer);
      await fs.promises.rename(writePath, tempFilePath);


      const magnetLink = await reactiveBooster.boostChunkIfNeeded(
        tempFilePath,
        `${sessionId}-${indexInt}`,
        trackers,
      );

      // 4. DATABASE SYNC WITH RETRY LOGIC !
      let parentStream = await Stream.findOne({ sessionId });
      let retries = 0;
      const maxRetries = 5;

      // For header chunks, wait longer - they're first
      const isHeader = indexInt === -1;
      const maxRetriesForHeader = 10; // Header needs more patience

      while (
        !parentStream &&
        retries < (isHeader ? maxRetriesForHeader : maxRetries)
      ) {

        await new Promise((resolve) => setTimeout(resolve, 200));
        parentStream = await Stream.findOne({ sessionId });
        retries++;
      }

      if (!parentStream) {
        console.warn(
          `⚠️ Stream ${sessionId} still not found after ${retries} retries`,
        );
        // If it's not a header, we can proceed - header might come later
        if (!isHeader) {
          console.log("Proceeding with chunk creation anyway...");
        }
      }

      // 5. CREATE CHUNK DOCUMENT
      let newChunk;
      try {
        newChunk = await StreamChunk.create({
          stream: parentStream ? parentStream._id : undefined,
          sessionId: sessionId,
          chunkIndex: indexInt,
          magnetLink: magnetLink,
          fileName: file.originalname || `chunk-${indexInt}.${ext}`,
          fileSize: file.size || 0,
          fileType: isHeader ? "video_header" : "video_chunk",
          mimeType: mimeType,
        });

        console.log(`💾 [DB] Saved chunk ${indexInt} for session ${sessionId}`);
        console.log(`💾 [DB] Chunk ID: ${newChunk._id}`);

        // Verify it's in the database
        const verify = await StreamChunk.findOne({
          sessionId: sessionId,
          chunkIndex: indexInt,
        });
        console.log(`💾 [DB] Verify found: ${!!verify}`);
      } catch (dbError) {
        console.error(
          `❌ [DB] Failed to save chunk ${indexInt}:`,
          dbError.message,
        );
        // ⚠️ Return error response here - don't continue
        return res.status(500).json({
          success: false,
          error: "Failed to save chunk to database",
          details: dbError.message,
        });
      }

      // 6. GRAPHQL PUBLISH
      const publishData = {
        livestreamChunkAdded: {
          id: newChunk.id,
          sessionId: sessionId,
          chunkIndex: newChunk.chunkIndex,
          magnetLink: magnetLink,
          fileName: newChunk.fileName,
          fileSize: newChunk.fileSize,
          fileType: newChunk.fileType,
          mimeType: mimeType,
          rotation: rotation || 0,
        },
      };

      pubsub.publish(`LIVESTREAM_CHUNK_ADDED_${sessionId}`, publishData);

      console.log(`✅ [LIVE-CHUNK] Chunk ${indexInt} processed successfully.`);
      return res.json({
        success: true,
        magnetLink,
        chunkId: newChunk._id,
        streamFound: !!parentStream,
      });
    } catch (error) {
      console.error("🔴 [LIVE-CHUNK] SERVER ERROR:", error.message);
      return res.status(500).json({
        success: false,
        error: error.message,
        hint: "Check if StreamChunk model has 'stream' as required field",
      });
    }
  },
);

// In your backend, create an endpoint that generates an .m3u8 file
app.get("/api/stream/:sessionId/playlist.m3u8", async (req, res) => {
  const { sessionId } = req.params;

  console.log(`📺 Generating HLS manifest for: ${sessionId}`);

  // 1. Find the Stream document using the sessionId
  const streamDoc = await Stream.findOne({ sessionId });
  if (!streamDoc) {
    console.error(`❌ No stream found for sessionId: ${sessionId}`);
    return res.status(404).send("Stream not found");
  }

  console.log(`📺 Found stream: ${streamDoc._id}`);

  // 2. Get all chunks for this stream using the stream's ObjectId
  const chunks = await StreamChunk.find({
    stream: streamDoc._id,
  }).sort({ chunkIndex: 1 });

  console.log(`📦 Found ${chunks.length} chunks`);

  if (chunks.length === 0) {
    return res.status(404).send("No chunks found");
  }

  // 3. Generate HLS manifest (skip header chunk -1)
  let manifest = "#EXTM3U\n";
  manifest += "#EXT-X-VERSION:3\n";
  manifest += "#EXT-X-TARGETDURATION:10\n";
  manifest += "#EXT-X-MEDIA-SEQUENCE:0\n";

  chunks.forEach((chunk) => {
    // Skip header chunk (-1) - it's metadata, not video
    if (chunk.chunkIndex < 0) return;

    const url = `/api/live-chunk/${sessionId}/${chunk.chunkIndex}`;
    console.log(`📺 Adding chunk ${chunk.chunkIndex}: ${url}`);
    manifest += `#EXTINF:10.0,\n`;
    manifest += `${url}\n`;
  });

  manifest += "#EXT-X-ENDLIST\n";

  res.set("Content-Type", "application/vnd.apple.mpegurl");
  res.send(manifest);
});

app.get("/api/live-chunk/:sessionId/:index", async (req, res) => {
  // 🛡️ 1. Sanitize inputs to prevent Path Traversal jhgjhjh
  //dlksjflsdkjsdlfjks
  const sessionId = req.params.sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  const index = req.params.index.replace(/[^a-zA-Z0-9_-]/g, "");
  console.log(`🔍 Looking for chunk: ${sessionId}/${index}`);
  
  const { hash } = req.query;

  const tempDir = path.join("/tmp", "live-chunks", sessionId);

  // Set default CORS header for ALL responses (including 404s)
  res.set("Access-Control-Allow-Origin", "*");

  if (!fs.existsSync(tempDir)) {
    res.set("Cache-Control", "no-cache");
    return res.status(404).send("Session folder missing");
  }

  // 🎯 PRIORITY 1: Match by Hash (if provided)
  if (hash && typeof hash === "string") {
    const cleanHash = hash.replace(/[^a-zA-Z0-9_-]/g, "");
    try {
      const files = fs.readdirSync(tempDir);
      const hashMatch = files.find((f) => f.includes(cleanHash));
      if (hashMatch) {
        res.set("Cache-Control", "public, max-age=31536000, immutable");
        return res.sendFile(path.join(tempDir, hashMatch));
      }
    } catch (e) {
      console.warn("Hash lookup error:", e);
    }
  }

  // 🎯 PRIORITY 2: Match Stream Header (index === "-1")
  if (index === "-1") {
    try {
      const files = fs.readdirSync(tempDir);
      const headerFile = files.find(
        (f) => f.toLowerCase().includes("header") || f.includes("-1"),
      );
      if (headerFile) {
        res.set({
          "Cache-Control": "public, max-age=3600",
          "Content-Type": "video/mp4",
        });
        return res.sendFile(path.join(tempDir, headerFile));
      }
    } catch (e) {
      console.warn("Header lookup error:", e);
    }
  }

  // 🎯 PRIORITY 3: Match Chunk File by Extension or Prefix
  const candidateNames = [
    `chunk-${index}.mp4`,
    `c_${index}.mp4`,
    `${index}.mp4`,
    `chunk-${index}.webm`,
    `c_${index}.webm`,
  ];

  for (const filename of candidateNames) {
    const filePath = path.join(tempDir, filename);
    if (fs.existsSync(filePath)) {
      const mime = filename.endsWith(".webm")
        ? "video/webm"
        : 'video/mp4; codecs="mp4a.40.2,avc1.4d4015"';
      res.set({
        "Cache-Control": "public, max-age=3600",
        "Content-Type": mime,
      });
      return res.sendFile(filePath);
    }
  }

  // 🛑 SAFETY: Chunk isn't ready yet — DO NOT CACHE
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.status(404).send("Chunk not ready yet");
}); // ✅ Just ONE closing bracket


app.get("/api/stream-rotation/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  try {
    const message = await Message.findOne({
      sessionId,
      chunkIndex: -1,
    });
    res.json({ rotation: message?.rotation || 0 });
  } catch (error) {
    res.json({ rotation: 0 });
  }
});


app.post("/api/stream-end", authenticateToken, async (req, res) => {
  const { sessionId } = req.body;

  await Stream.findOneAndUpdate(
    { sessionId },
    {
      status: "ended",
      endedAt: new Date(), // ← Set endedAt timestamp
    },
  );

  // Clean up temp files immediately
  const tempDir = path.join("/tmp", "live-chunks", sessionId);
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  await reactiveBooster.stopStreamBoost(sessionId);
  res.json({ success: true, message: `Stopped boosting stream ${sessionId}` });
});

// In your backend - /api/seed-persist
// In your backend - add multer configuration for seed-persist
const seedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ✅ UPDATE the route with multer middleware
// In your backend - NO FILE UPLOAD, just register the magnet link
app.post("/api/seed-register", authenticateToken, async (req, res) => {
  try {
    const {
      magnetLink,
      neighborhoodId,
      content,
      fileName,
      fileSize,
      mediaType,
    } = req.body;
    const userId = req.user.userId;

    if (!magnetLink) {
      return res.status(400).json({ error: "magnetLink required" });
    }

    console.log(`🌱 Registering seed: ${fileName} (${fileSize} bytes)`);

    // Optional: Store seeding record for monitoring
    // You could create a SeedingRecord model here
    // But you don't NEED to - the magnet link is already in the post

    res.json({
      success: true,
      message: "Seed registered successfully",
      magnetLink: magnetLink,
    });
  } catch (error) {
    console.error("❌ Seed registration failed:", error);
    res.status(500).json({ error: error.message });
  }
});

// Simply upload endpoint for testing
app.post(
  "/api/upload-image",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {
    try {
      console.log("Upload request received!:", {
        file: req.file
          ? {
              originalname: req.file.originalname,
              mimetype: req.file.mimetype,
              size: req.file.size,
              hasBuffer: !!req.file.buffer,
            }
          : "NO FILE",
      });

      if (!req.file) {
        console.log("No file in request");
        return res.status(400).json({ error: "No file provided" });
      }

      // For testing - just return a success with test URL
      console.log("File received successfully:", {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype,
      });

      res.json({
        success: true,
        fileUrl: "https://picsum.photos/200/300", // Test URL
        message: "File received successfully - ready for IPFS integration",
        debug: {
          fileName: req.file.originalname,
          fileSize: req.file.size,
          hasBuffer: !!req.file.buffer,
        },
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({
        error: "Failed to upload file",
        details: error.message,
      });
    }
  },
);

// WebTorrent player HTML endpoint
app.get("/api/webtorrent-player", (req, res) => {
  const { fileName, magnetLink, cid, id } = req.query;

  let cleanMagnetLink = decodeURIComponent(magnetLink || "");
  if (cleanMagnetLink.startsWith("magnet:?magnet:")) {
    cleanMagnetLink = cleanMagnetLink.replace("magnet:?magnet:", "magnet:?");
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WebTorrent Player</title>
        <style>
            body { margin: 0; padding: 15px; background: #1a1a1a; color: white; font-family: Arial, sans-serif; }
            .video-card { border: 1px solid #333; padding: 15px; border-radius: 8px; background: #222; max-width: 600px; margin: 0 auto; }
            video { width: 100%; max-height: 400px; background: #000; border-radius: 8px; }
            .status { color: #FFFF00; margin: 10px 0; font-size: 14px; text-align: center; }
            .progress-bar { width: 100%; height: 20px; background: #333; border-radius: 10px; margin: 10px 0; overflow: hidden; }
            .progress-fill { height: 100%; background: linear-gradient(90deg, #00FF00, #00AAFF); transition: width 0.3s; }
            .stats { color: #888; font-size: 12px; text-align: center; margin: 5px 0; }
        </style>
    </head>
    <body>
        <div class="video-card">
            <div style="color: #00FF00; text-align:center; margin-bottom:10px;">🎬 ${
              fileName || "Video"
            }</div>
            <div class="status" id="status">🚀 Starting WebTorrent...</div>
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill" style="width: 0%"></div>
            </div>
            <div class="stats" id="stats">👥 0 peers | 📥 0%</div>
            <video id="videoPlayer" controls style="display:none;"></video>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js"></script>
        <script>
            const client = new WebTorrent();
            const videoElement = document.getElementById('videoPlayer');
            const statusElement = document.getElementById('status');
            const statsElement = document.getElementById('stats');
            const progressFill = document.getElementById('progressFill');

            ${
              cleanMagnetLink
                ? `
            // WEBTORRENT MODE - Start immediately
            console.log('Starting WebTorrent with:', '${cleanMagnetLink}');
            
            const torrent = client.add('${cleanMagnetLink}');
            let hasStartedPlaying = false;

            torrent.on('ready', () => {
                console.log('Torrent ready');
                statusElement.textContent = '📦 Torrent ready - ' + torrent.files.length + ' files';
            });

            torrent.on('download', (bytes) => {
                const percent = Math.round(torrent.progress * 100);
                progressFill.style.width = percent + '%';
                statsElement.textContent = '👥 ' + torrent.numPeers + ' peers | 📥 ' + percent + '% | ⚡ ' + (torrent.downloadSpeed / 1024 / 1024).toFixed(2) + ' MB/s';
                
                // Start playing once we have some data (5% buffer)
                if (percent >= 5 && !hasStartedPlaying) {
                    playVideo();
                }
                
                statusElement.textContent = '📥 Downloading: ' + percent + '% - ' + torrent.numPeers + ' peers';
            });

            torrent.on('done', () => {
                statusElement.textContent = '✅ Complete! Streaming from ' + torrent.numPeers + ' peers';
                progressFill.style.background = '#00FF00';
            });

            function playVideo() {
                const file = torrent.files.find(f => 
                    f.name.includes('.mp4') || f.name.includes('.mov') || f.name.includes('.webm')
                );
                
                if (file) {
                    console.log('Playing video file:', file.name);
                    file.renderTo(videoElement, (err, elem) => {
                        if (!err) {
                            videoElement.style.display = 'block';
                            hasStartedPlaying = true;
                            statusElement.textContent = '🎬 Now playing - ' + torrent.numPeers + ' peers';
                            videoElement.play().catch(e => {
                                console.log('Autoplay blocked, waiting for user interaction');
                            });
                        }
                    });
                }
            }

            // Fallback if no progress in 10 seconds
            setTimeout(() => {
                if (torrent.progress === 0) {
                    statusElement.textContent = '❌ No progress - you might be the first seeder!';
                    ${
                      cid
                        ? `
                    // Optional: Auto-fallback to IPFS
                    console.log('Falling back to IPFS');
                    videoElement.src = 'https://${PINATA_GATEWAY}/ipfs/${cid}';
                    videoElement.style.display = 'block';
                    statusElement.textContent = '📡 Using IPFS fallback';
                    `
                        : ""
                    }
                }
            }, 10000);

            `
                : `
            // NO MAGNET LINK - Use IPFS directly
            ${
              cid
                ? `
            console.log('Using direct IPFS');
            videoElement.src = 'https://${PINATA_GATEWAY}/ipfs/${cid}';
            videoElement.style.display = 'block';
            statusElement.textContent = '📡 Streaming from IPFS';
            progressFill.style.width = '100%';
            progressFill.style.background = '#00AAFF';
            statsElement.textContent = 'Direct IPFS streaming';
            `
                : `
            statusElement.textContent = '❌ No video source available';
            `
            }
            `
            }
        </script>
    </body>
    </html>
  `);
});

// Test neighborhood endpoint
app.get("/api/test-neighborhood", authenticateToken, async (req, res) => {
  try {
    const Neighborhood = ModelSchema.Neighborhood;
    const testNeighborhood = new Neighborhood({
      name: "Test Neighborhood",
      description: "Just testing the model",
      type: "private",
      owner: req.user._id,
      members: [
        {
          user: req.user._id,
          role: "owner",
        },
      ],
    });

    await testNeighborhood.save();

    res.json({
      success: true,
      message: "Neighborhood model works!",
      neighborhoodId: testNeighborhood._id,
    });
  } catch (error) {
    console.error("Neighborhood test error:", error);
    res.status(500).json({ error: "Model test failed" });
  }
});

// Gallery endpoint
app.get(
  "/api/neighborhoods/:id/gallery",
  authenticateToken,
  async (req, res) => {
    try {
      // 1. Set aggressive HTTP caching headers (1 hour)
      res.set("Cache-Control", "public, max-age=3600");

      const neighborhoodId = req.params.id;

      // 2. Fetch only essential metadata from your DB
      // This query is fast and reduces load vs. fetching everything
      const galleryData = await ModelSchema.Neighborhood.findOne(
        { _id: neighborhoodId },
        { videos: 1, images: 1, totalCount: 1, name: 1 },
      ).lean(); // `.lean()` for faster JSON

      if (!galleryData) {
        return res.status(404).json({ error: "Neighborhood not found" });
      }

      // 3. Return a slim, cache-friendly payload
      res.json({
        neighborhoodName: galleryData.name,
        totalCount: galleryData.totalCount || 0,
        // Send just enough data for the frontend to build the list and pass to WebTorrentMedia
        media: [
          ...(galleryData.videos || []).map((v) => ({
            id: v._id || v.id,
            title: v.title,
            fileName: v.fileName,
            fileType: "video",
            cid: v.cid,
            magnetLink: v.magnetLink, // Crucial for P2P
          })),
          ...(galleryData.images || []).map((i) => ({
            id: i._id || i.id,
            title: i.title,
            fileName: i.fileName,
            fileType: "image",
            cid: i.cid,
            magnetLink: i.magnetLink, // Crucial for P2P
          })),
        ],
      });
    } catch (error) {
      console.error("Gallery API error:", error);
      res.status(500).json({ error: "Failed to fetch gallery data" });
    }
  },
);

// Get messages for a specific room
app.get("/api/messages/:room", authenticateToken, async (req, res) => {
  try {
    const messages = await Message.find({ room: req.params.room })
      .populate("sender", "username profilePhoto")
      .sort("-createdAt")
      .limit(50);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Click tracking
app.post("/api/track-click", async (req, res) => {
  try {
    const { affiliateLinkId } = req.body;
    const user = await User.findOneAndUpdate(
      { "affiliateLinks._id": affiliateLinkId },
      { $inc: { "affiliateLinks.$.clicks": 1 } },
      { new: true },
    );
    res.json({ success: true });
  } catch (error) {
    console.error("Click tracking error:", error);
    res.status(500).json({ error: "Tracking failed" });
  }
});

// ========== GRAPHQL SETUP (FROM CURRENT VERSION) ==========

// Correctly merge resolvers
const resolvers = {
  ...mutationResolvers, // Contains Query, Mutation, and other type resolvers
  Subscription: subscriptionResolvers.Subscription,
};

const schema = makeExecutableSchema({ typeDefs, resolvers });

// WebSocket server for GraphQL subscriptions
const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/graphql",
});

// In index.js, replace the useServer setup:

const serverCleanup = useServer(
  {
    schema,
    context: async (ctx) => {
      // For debugging, log what we get
      console.log("🔌 [WS-CONTEXT] WebSocket connection established");
      console.log("🔌 [WS-CONTEXT] Connection params:", ctx.connectionParams);

      // Return the pubsub instance
      return { pubsub };
    },
    // Add onSubscribe for debugging
    onSubscribe: (ctx, msg) => {
      console.log(
        "🔌 [WS-ONSUBSCRIBE] Client subscribing:",
        msg.payload?.operationName,
      );
      console.log("🔌 [WS-ONSUBSCRIBE] Variables:", msg.payload?.variables);
    },
    onConnect: (ctx) => {
      console.log("🔌 [WS-ONCONNECT] Client connected");
      return true; // Allow the connection
    },
    onDisconnect: (ctx, code, reason) => {
      console.log(
        `🔌 [WS-ONDISCONNECT] Client disconnected: ${code} - ${reason}`,
      );
    },
  },
  wsServer,
);

// Apollo Server v4 setup
const apolloServer = new ApolloServer({
  schema,
  introspection: true,
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          },
        };
      },
    },
  ],
});

await apolloServer.start();

app.use(
  "/graphql",
  expressMiddleware(apolloServer, {
    context: async ({ req }) => {
      const { cache } = apolloServer;
      const authHeader = req?.headers?.authorization || "";
      let user = null;
      if (authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          user = { userId: decoded.userId };
        } catch (error) {
          // console.log("Token invalid:", error.message);
        }
      }
      const models = {
        User,
        Neighborhood,
        Video,
        Image,
        Message,
        ...ModelSchema, // This ensures anything in your index.js is also included
      };
      return {
        user,
        pubsub,
        models,
        token: authHeader.substring(7),
        dataSources: {
          mediaAPI: new MediaAPI({ cache }),
        },
      };
    },
  }),
);

// ========== SOCKET.IO SETUP (DUAL CONFIGURATION FROM CURRENT VERSION) ==========

// CHAT Socket.IO server (with separate path)
const chatIo = new Server(httpServer, {
  path: "/socket.io-chat/", // ✅ MUST match the client's 'path' option for chat
  cors: {
    origin: corsOptions.origin,
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// Add chat Socket.IO authentication and event handlers FROM OLDEST VERSION
chatIo.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error"));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) return next(new Error("User not found"));

    socket.user = {
      id: user._id,
      username: user.username,
    };
    next();
  } catch (error) {
    next(new Error("Authentication error"));
  }
});

chatIo.on("connection", (socket) => {
  console.log(`User connected for chat: ${socket.user.username}`);

  socket.on("join-neighborhood", (neighborhoodId) => {
    const room = `neighborhood-${neighborhoodId}`;
    socket.join(room);
    console.log(
      `${socket.user.username} joined neighborhood chat room: ${room}`,
    );
  });

  socket.on("leave-neighborhood", (neighborhoodId) => {
    const room = `neighborhood-${neighborhoodId}`;
    socket.leave(room);
    console.log(`${socket.user.username} left neighborhood chat room: ${room}`);
  });

  socket.on("join-room", (room) => {
    socket.join(room);
    console.log(`${socket.user.username} joined chat room: ${room}`);
  });

  socket.on("leave-room", (room) => {
    socket.leave(room);
    console.log(`${socket.user.username} left chat room: ${room}`);
  });

  socket.on("sendVideo", (videoId, room) => {
    console.log(`Video sent via chat: ${videoId} to room: ${room}`);
    chatIo.to(room).emit("receiveVideo", { videoId });
  });

  socket.on("message", async (data) => {
    try {
      const message = new Message({
        sender: socket.user.id,
        content: data.content,
        imageUrl: data.imageUrl,
        room: data.room,
      });
      await message.save();

      const populatedMessage = await Message.findById(message._id).populate(
        "sender",
        "username",
      );
      chatIo.to(data.room).emit("message", populatedMessage);
    } catch (error) {
      console.error("Error saving message:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected from chat: ${socket.user.username}`);
  });
});

// ========== ADD VIDEO UPLOAD HANDLER ==========
videoUploadHandler(app);

// ========== AUTH ROUTES ==========
import authRoutes from "./routes/auth.js";
app.use("/api", authRoutes);

// ========== START SERVER ==========
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`🚀 GraphQL Server ready at http://localhost:${PORT}/graphql`);
  console.log(`🚀 Subscriptions ready at ws://localhost:${PORT}/graphql`);
  console.log(`💬 Chat Socket.IO ready at path: /socket.io-chat/`);
});
