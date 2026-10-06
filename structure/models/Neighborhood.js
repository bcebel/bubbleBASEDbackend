import mongoose from "mongoose";
import crypto from "crypto";

const { Schema } = mongoose;

const NeighborhoodSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      lowercase: true,
    },
    description: {
      type: String,
      default: "",
    },

    type: {
      type: String,
      enum: ["personal", "private", "public", "global", "direct"],
      default: "private",
    },
    isDirectMessage: {
      type: Boolean,
      default: false,
    },
    sourceBubbleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Neighborhood",
      default: null,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isDefault: { type: Boolean, default: false },
    visibility: {
      type: String,
      enum: ["private", "global", "public"], // or similar
      default: "private",
    },

    members: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        role: {
          type: String,
          enum: ["owner", "moderator", "member"],
          default: "member",
        },
        joinedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    bubblePhotoCid: {
      type: String,
      default: null,
    },
    joinRequests: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        requestedAt: {
          type: Date,
          default: Date.now,
        },
        status: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
      },
    ],
    rules: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    inviteLinks: [
      {
        code: {
          type: String,
          required: true,
          unique: true,
          sparse: true,
        },
        name: {
          type: String,
          default: "Invite Link",
        },
        createdBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        maxUses: {
          type: Number,
          default: 0, // 0 = unlimited
        },
        uses: {
          type: Number,
          default: 0,
        },
        expiresAt: {
          type: Date,
          default: null, // null = never expires
        },
        role: {
          type: String,
          enum: ["member", "moderator"],
          default: "member",
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    joinPolicy: {
      type: String,
      enum: ["invite_only", "request", "open"],
      default: "invite_only",
    },
    // Invite settings
    allowMemberInvites: {
      type: Boolean,
      default: true,
    },
    maxMembers: {
      type: Number,
      default: 10000,
    },
  },
  {
    timestamps: true, // The preferred place to define all serialization options
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        // 🔑 THE FIX: Explicitly call .toString() on _id
        ret.id = ret._id.toString();
        // Remove the MongoDB internal fields
        delete ret._id;
        delete ret.__v;
        // The result will be a plain JS object with 'id' as a string
      },
    },
    toObject: { virtuals: true },
  },
);


// Generate a unique invite code - FIXED: use this.constructor
NeighborhoodSchema.statics.generateInviteCode = function () {
  return crypto.randomBytes(8).toString("hex").toUpperCase();
};

// Check if invite link is valid
NeighborhoodSchema.methods.isValidInviteLink = function (code) {
  const link = this.inviteLinks.find((link) => link.code === code);

  if (!link || !link.isActive) return false;

  if (link.maxUses > 0 && link.uses >= link.maxUses) return false;

  if (link.expiresAt && link.expiresAt < new Date()) return false;

  return true;
};

// Helper method to create a new invite link - FIXED: use this.constructor
NeighborhoodSchema.methods.createInviteLink = async function (options) {
  const {
    createdBy,
    name = "Invite Link",
    maxUses = 0,
    expiresAt = null,
    role = "member",
  } = options;

  // Use this.constructor to access the static method
  const code = this.constructor.generateInviteCode();

  const newLink = {
    code,
    name,
    createdBy,
    maxUses,
    expiresAt,
    role,
    isActive: true,
    uses: 0,
    createdAt: new Date(),
  };

  this.inviteLinks.push(newLink);

  await this.save();

  return this.inviteLinks[this.inviteLinks.length - 1];
};

// Add index for better performance
NeighborhoodSchema.index({ owner: 1 });
NeighborhoodSchema.index({ "members.user": 1 });
NeighborhoodSchema.index({ type: 1 });
NeighborhoodSchema.index({ "inviteLinks.code": 1 });

export default mongoose.model("Neighborhood", NeighborhoodSchema);
