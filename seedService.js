import WebTorrent from "webtorrent";
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";

class ReactiveSeedBooster {
  constructor() {
    EventEmitter.defaultMaxListeners = 100; // Increased for livestream
    this.client = new WebTorrent({
      maxConns: 50, // Increased connections
      dht: true, // ENABLE DHT for better peer discovery
      lsd: true, // Enable local peer discovery
      tracker: {
        rtcConfig: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
          ],
        },
      },
    });

    this.trackers = [
      "wss://tracker-0ad4cca9fd92.herokuapp.com",
      "wss://tracker.openwebtorrent.com",
      "wss://tracker.webtorrent.dev", // Added UDP tracker
    ];

    this.activeTorrents = new Map();
    console.log("🎯 Reactive Seed Booster started (P2P Livestream Optimized)");
  }

  /**
   * Start seeding a chunk for livestream
   * For livestreams, we NEVER stop seeding automatically
   */
  async boostChunkIfNeeded(filePath, chunkId, announceUrls, webSeedUrls) {
      console.log(`🌱 boostChunkIfNeeded called with chunkId: "${chunkId}"`);
    if (this.activeTorrents.has(chunkId)) {
      const job = this.activeTorrents.get(chunkId);
      return job.torrent.magnetURI;
    }

    const isGallery = chunkId.startsWith("gallery-");
    
const getSeedName = (chunkId) => {
  if (chunkId.startsWith("gallery-")) return `gallery-${chunkId.slice(8)}`;
  if (chunkId.startsWith("image-")) return `image-${chunkId.slice(6)}`;
  if (chunkId.startsWith("video-")) return `video-${chunkId.slice(6)}`;
  if (chunkId.startsWith("live_") || chunkId.includes("-chunk-")) {
    return `livestream-${chunkId}`;
  }
  return `media-${chunkId}`;
};

const torrentOptions = {
  announce:
    announceUrls && announceUrls.length > 0 ? announceUrls : this.trackers,
  name: getSeedName(chunkId),
  urlList: webSeedUrls || [],
};

    return new Promise((resolve, reject) => {
      this.client.seed(filePath, torrentOptions, (torrent) => {
        /*   console.log(
          `📤 Seeding chunk ${chunkId}. InfoHash: ${torrent.infoHash.substring(
            0,
            8,
          )}...`,
        );
        */

        // Log peer connections
        torrent.on("wire", (wire, addr) => {
          console.log(`🤝 Connected to peer for ${chunkId}: ${addr}`);
        });

        torrent.on("error", (err) => {
          console.error(`❌ Torrent error for ${chunkId}:`, err.message);
        });

        const boosterJob = {
          torrent: torrent,
          filePath: filePath,
          startTime: Date.now(),
          peers: new Set(),
        };

        this.activeTorrents.set(chunkId, boosterJob);
        resolve(torrent.magnetURI);
      });
    });
  }

  /**
   * Manual cleanup for a specific chunk
   */
  async stopBoosting(chunkId) {
    const job = this.activeTorrents.get(chunkId);
    if (!job) return;

    // Remove from WebTorrent client
    if (job.torrent) {
      this.client.remove(job.torrent.infoHash);
    }

    // Try to delete the temporary file
    try {
      await fs.promises.unlink(job.filePath);
      console.log(`🧹 Deleted temp file: ${path.basename(job.filePath)}`);
    } catch (err) {
      // File might already be gone; ignore
    }

    this.activeTorrents.delete(chunkId);
    console.log(`⏹️ Stopped boosting chunk ${chunkId}`);
  }

  /**
   * Cleanup all chunks for a stream session
   */
  async stopStreamBoost(sessionId) {
    const chunksToRemove = [];

    for (const [chunkId, job] of this.activeTorrents.entries()) {
      if (chunkId.includes(sessionId)) {
        chunksToRemove.push(chunkId);
      }
    }
    /*
    console.log(
      `🧼 Stopping ${chunksToRemove.length} chunks from stream ${sessionId}`,
    );
    */

    for (const chunkId of chunksToRemove) {
      await this.stopBoosting(chunkId);
    }
  }

  getStatus() {
    const status = {
      activeTorrents: this.activeTorrents.size,
      totalPeers: 0,
      sessions: {},
    };

    for (const [chunkId, job] of this.activeTorrents.entries()) {
      const peerCount = job.torrent.numPeers;
      status.totalPeers += peerCount;

      // Extract session ID from chunkId format
      const sessionMatch = chunkId.match(/(.*?)-chunk-\d+/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        if (!status.sessions[sessionId]) {
          status.sessions[sessionId] = { chunks: 0, peers: 0 };
        }
        status.sessions[sessionId].chunks++;
        status.sessions[sessionId].peers += peerCount;
      }
    }

    return status;
  }

  destroy() {
    console.log("🛑 Shutting down Seed Booster...");

    for (const [chunkId, job] of this.activeTorrents.entries()) {
      this.client.remove(job.torrent.infoHash);
    }

    this.activeTorrents.clear();
    this.client.destroy();
  }
}

export const reactiveBooster = new ReactiveSeedBooster();
