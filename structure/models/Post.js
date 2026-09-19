import mongoose from "mongoose";

// postSchema.js - Updated to match message patterns
const postSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: true,
      trim: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ✅ MATCH MESSAGE STRUCTURE
    media: [
      {
        url: { type: String },
        cid: { type: String },
        magnetURI: { type: String },
        mediaType: {
          type: String,
          enum: ["image", "video", "audio", "file"],
          default: "image",
        },
        // ✅ Add these to match message structure
        fileName: { type: String },
        fileSize: { type: Number },
        mimeType: { type: String },
        thumbnailUrl: { type: String },
      },
    ],

    // ✅ Keep affiliate separate (posts-only feature)
    affiliate: {
      targetUrl: { type: String },
      bannerUrl: { type: String },
      title: { type: String },
      network: { type: String },
      rawHtml: { type: String },
      isSponsored: { type: Boolean, default: false },
    },

    // ✅ MATCH MESSAGE FIELD NAMES
    feedType: {
      type: String,
      enum: ["neighborhood"], // ← ONLY neighborhood!
      default: "neighborhood",
    },
    neighborhood: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Neighborhood",
    },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
    },

    // ✅ Match message fields
    isPinned: { type: Boolean, default: false },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export default mongoose.model("Post", postSchema);
