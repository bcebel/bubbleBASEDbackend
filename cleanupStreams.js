// cleanupStreams.js
import Stream from "./structure/models/Stream.js";
import StreamChunk from "./structure/models/StreamChunk.js";
import Message from "./structure/models/Message.js";
import { reactiveBooster } from "./seedService.js";

const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 7 hours

export async function cleanupOldStreams() {
  const cutoff = new Date(Date.now() - MAX_AGE_MS);

  try {
    const oldStreams = await Stream.find({
      createdAt: { $lt: cutoff },
    }).lean();

    if (oldStreams.length === 0) return;

    console.log(
      `🧹 [cleanup] Found ${oldStreams.length} streams older than 6h`,
    );

    for (const stream of oldStreams) {
      try {
        await reactiveBooster.stopStreamBoost(stream.sessionId);

        await Message.deleteMany({
          sessionId: stream.sessionId,
          content: "STREAM_HEADER",
        });

        await StreamChunk.deleteMany({ stream: stream._id });

        await Stream.deleteOne({ _id: stream._id });

        const ageMin = Math.round(
          (Date.now() - new Date(stream.createdAt).getTime()) / 60000,
        );
        console.log(
          `🧹 [cleanup] Deleted ${stream.sessionId} (age: ${ageMin}min)`,
        );
      } catch (err) {
        console.error(
          `🧹 [cleanup] Failed on ${stream.sessionId}:`,
          err.message,
        );
      }
    }

    console.log(`🧹 [cleanup] Done`);
  } catch (err) {
    console.error("🧹 [cleanup] Sweep failed:", err.message);
  }
}
