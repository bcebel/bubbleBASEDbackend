import mongoose from "mongoose";
import pubsub from "../../pubsub.js";
import User from "../../models/User.js";
import Chat from "../../models/Chat.js";
import Post from "../../models/Post.js";
import Comment from "../../models/Comment.js";
import Group from "../../models/Group.js";
import Video from "../../models/Video.js";
import Stream from "../../models/Stream.js";
import Ad from "../../models/Ad.js";
import Neighborhood from "../../models/Neighborhood.js";
import Message from "../../models/Message.js";
import Image from "../../models/Image.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { requireNeighborhoodAccess } from "../../../utils/authHelpers.js";

import StreamChunk from "../../models/StreamChunk.js";


// In validateAndExtractAffiliateHtml, loosen the validation:
const validateAndExtractAffiliateHtml = (html) => {
  const allowedDomains = [
    "anrdoezrs.net",
    "tkqlhce.com",
    "jdoqocy.com",
    "tqlkg.com",
    "ftjcfx.com",
    "awltovhc.com",
    "kqzyfj.com",
  ];

  const domainPattern = allowedDomains.join("|");

  // Find the MAIN URL (href)
  const hrefMatch = html.match(/href="([^"]*)"/i);
  if (!hrefMatch) {
    return {
      isValid: false,
      error: "No href attribute found",
    };
  }

  const hrefUrl = hrefMatch[1];
  
  // Check if it's from an approved domain
  const isApproved = hrefUrl.match(new RegExp(`https?://[^/]*\\.(${domainPattern})/`, "i"));
  
  if (!isApproved) {
    return {
      isValid: false,
      error: "URL not from approved affiliate network",
    };
  }

  // Extract image URL if present
  const srcMatch = html.match(/src="([^"]*)"/i);
  const imageUrl = srcMatch ? srcMatch[1] : null;

  // Extract title from alt, title attribute, or link text
  const altMatch = html.match(/alt="([^"]*)"/i);
  const titleMatch = html.match(/title="([^"]*)"/i);
  const textMatch = html.match(/<a[^>]*>(.*?)<\/a>/i);
  
  let title = "Affiliate Link";
  if (altMatch) title = altMatch[1];
  else if (titleMatch) title = titleMatch[1];
  else if (textMatch) {
    const text = textMatch[1].replace(/<[^>]*>/g, '').trim();
    if (text) title = text;
  }

  return {
    isValid: true,
    data: {
      url: hrefUrl,
      imageUrl: imageUrl,
      title: title,
      description: html, // Store the raw HTML
    },
  };
};

const resolvers = {
  Query: {
    comments: async (_, { postId }, context) => {
      if (!context.user) throw new Error("Authentication required");

      // Find all comments for this post, sorted newest first
      const comments = await Comment.find({ post: postId })
        .populate("author", "username profilePhoto")
        .sort({ createdAt: -1 });

      return comments;
    },
    streamChunks: async (_, { sessionId }) => {
      try {
        // 1. Find the actual Stream document using the "live_..." string
        const streamDoc = await Stream.findOne({ sessionId });
        if (!streamDoc) {
          console.log("❌ No stream found for sessionId:", sessionId);
          return [];
        }

        // 2. Use the _id of that stream to find the chunks
        const chunks = await StreamChunk.find({ stream: streamDoc._id })
          .sort({ chunkIndex: 1 })
          .lean();

        /*    console.log(
          `✅ Found ${chunks.length} chunks for stream ${streamDoc._id}`,
        );
        */
        return chunks;
      } catch (error) {
        console.error("Error fetching stream history:", error);
        return [];
      }
    },
    getMyAllNeighborhoodsGallery: async (_, __, { user, models }) => {
      if (!user) throw new Error("Authentication required");

      try {
        // 1. Find all neighborhoods where the user is an owner or member
        const userNeighborhoods = await models.Neighborhood.find({
          $or: [{ owner: user.userId }, { "members.user": user.userId }],
        }).select("_id");

        const neighborhoodIds = userNeighborhoods.map((n) => n._id);

        // 2. Query Criteria: (Shared in my neighborhoods) OR (Uploaded by me)
        const mediaQuery = {
          $or: [
            { neighborhood: { $in: neighborhoodIds } },
            { user: user.userId },
          ],
        };

        const [videos, images] = await Promise.all([
          models.Video.find(mediaQuery)
            .populate("user", "username profilePhoto")
            .populate("neighborhood", "name")
            .sort({ createdAt: -1 }),
          models.Image.find(mediaQuery)
            .populate("user", "username profilePhoto")
            .populate("neighborhood", "name")
            .sort({ createdAt: -1 }),
        ]);
        console.log("FIRST IMAGE FROM DB:", JSON.stringify(images[0], null, 2));

        return {
          videos,
          images,
          totalCount: videos.length + images.length,
        };
      } catch (error) {
        console.error("Gallery Error:", error);
        throw new Error("Failed to fetch gallery");
      }
    },

    myDirectMessageBubbles: async (_, __, { user }) => {
      if (!user) throw new Error("Authentication required");

      const bubbles = await Neighborhood.find({
        type: "direct",
        "members.user": user.userId,
      })
        .populate("members.user", "username profilePhoto")
        .lean();

      // ✅ Manually convert _id → id for GraphQL
      return bubbles.map((bubble) => ({
        id: bubble._id.toString(),
        name: bubble.name,
        members: bubble.members.map((m) => ({
          user: m.user
            ? {
                id: m.user._id.toString(),
                username: m.user.username,
                profilePhoto: m.user.profilePhoto,
              }
            : null,
        })),
      }));
    },
    // Get public media (no auth needed) ok ok ok ok ok ok ok
    publicVideos: async () => {
      return await Video.find({ isPublic: true })
        .populate("user", "username profilePhoto")
        .sort({ createdAt: -1 });
    },

    publicImages: async () => {
      return await Image.find({ isPublic: true })
        .populate("user", "username profilePhoto")
        .sort({ createdAt: -1 });
    },

    // Get all media user can access (public + their private)
    myVideos: async (_, __, { user }) => {
      if (!user) {
        // If no user, only return public videos
        return await Video.find({ isPublic: true })
          .populate("user", "username profilePhoto")
          .sort({ createdAt: -1 });
      }

      // Return public videos OR videos user has access to
      return await Video.find({
        $or: [
          { isPublic: true },
          { user: user.userId },
          // Add neighborhood access logic if needed
        ],
      })
        .populate("user", "username profilePhoto")
        .populate("neighborhood", "name")
        .sort({ createdAt: -1 });
    },
    // User queries
    images: async () =>
      await Image.find().populate("user").populate("neighborhood"),
    image: async (_, { id }) =>
      await Image.findById(id).populate("user").populate("neighborhood"),
    users: async () => await User.find(),
    user: async (_, { id }) => await User.findById(id),
    me: async (_, __, context) => {
      if (!context.user) throw new Error("Authentication required");
      return await User.findById(context.user.userId);
    },
    userByUsername: async (_, { username }) => {
      const user = await User.findOne({ username });
      if (!user) throw new Error("User not found");
      return user;
    },

    // In resolvers.js - Update randomAffiliateLink
    randomAffiliateLink: async (_, __, context) => {
      try {
        // Get all users with affiliate links
        const usersWithLinks = await User.find({
          "affiliateLinks.0": { $exists: true },
        }).select("affiliateLinks");

        if (usersWithLinks.length === 0) return null;

        // Flatten all links
        const allLinks = [];
        usersWithLinks.forEach((user) => {
          user.affiliateLinks.forEach((link) => {
            // Ensure link is properly formatted
            if (link && link.url) {
              allLinks.push({
                id: link._id ? link._id.toString() : Math.random().toString(36),
                url: link.url,
                title: link.title || "",
                description: link.description || "",
                imageUrl: link.imageUrl || null,
                clicks: link.clicks || 0,
              });
            }
          });
        });

        if (allLinks.length === 0) return null;

        // Pick random link
        const randomIndex = Math.floor(Math.random() * allLinks.length);
        return allLinks[randomIndex];
      } catch (error) {
        console.error("Error in randomAffiliateLink:", error);
        return null;
      }
    },

    // Video queries
    videos: async () => await Video.find().populate("user"),
    video: async (parent, { id }, context) => {
      // 1. Destructure necessary items from context
      const { dataSources, token } = context;

      // 2. Fetch minimal data from the database using the MongoDB _id (id)
      // CRITICAL: We select the 'cid' field because the REST API requires it.
      const mediaInfo = await Video.findById(id)
        .select("accessLevel cid user")
        .populate("user"); // Populate 'user' if required by the Video type

      if (!mediaInfo) {
        throw new Error("Video not found.");
      }

      // Extract fields needed for routing and data merging
      const { accessLevel, cid, user } = mediaInfo;

      // 3. Route the request based on access level (PUBLIC/PRIVATE)
      let restMetadata;

      if (accessLevel === "PUBLIC") {
        // HITS the unauthenticated REST endpoint (/api/media/public/:cid)
        restMetadata = await dataSources.mediaAPI.getPublicMetadata(cid);
      } else if (accessLevel === "PRIVATE") {
        if (!token) {
          throw new Error("Authentication required for private media.");
        }
        // HITS the authenticated REST endpoint, token is used via willSendRequest hook
        restMetadata = await dataSources.mediaAPI.getPrivateMetadata(
          cid,
          token,
        );
      } else {
        throw new Error("Invalid access level.");
      }

      // 4. Merge the data: REST for metadata, MongoDB for populated 'user' field
      return {
        ...restMetadata, // Includes fileName, magnetLink, etc., from the REST API
        user: user, // Includes the populated user object from MongoDB
      };
    },
    // Stream queries
    streams: async (_, { status }) => {
      const filter = {};
      if (status) {
        filter.status = status;
      }
      return await Stream.find(filter)
        .populate("startedBy")
        .populate("neighborhood")
        .sort({ createdAt: -1 });
    },
    stream: async (_, { id }) =>
      await Stream.findById(id).populate("startedBy").populate("neighborhood"),

    // Ad queries
    ads: async () => await Ad.find().populate("user"),
    ad: async (_, { id }) => await Ad.findById(id).populate("user"),

    // Chat queries
    chats: async () => await Chat.find().populate("participants"),
    chat: async (_, { id }) => await Chat.findById(id).populate("participants"),

    // Message queries
    // Query: messages(neighborhood: ID!, room: String): [Message!]!
    messages: async (_, { neighborhood, room }, context) => {
      if (!context.user) throw new Error("Authentication required");

      const userId = context.user.userId || context.user.id;

      // 1. Validate Neighborhood ID format
      if (!neighborhood || !mongoose.Types.ObjectId.isValid(neighborhood)) {
        throw new Error("Invalid neighborhood ID provided");
      }

      // 2. Check Neighborhood access / membership
      const targetNeighborhood = await Neighborhood.findById(neighborhood);
      if (!targetNeighborhood) {
        throw new Error(`Neighborhood ID ${neighborhood} not found`);
      }

      const isMember = targetNeighborhood.members.some(
        (member) => member.user.toString() === userId,
      );
      if (!isMember) {
        throw new Error("Not a member of this neighborhood");
      }

      // 3. Construct query filter
      const query = { neighborhood };
      if (room) {
        query.room = room;
      }

      console.log("Backend: Fetching messages with filter:", query);

      const messages = await Message.find(query)
        .populate("sender", "username profilePhoto")
        .sort({ createdAt: 1 })
        .limit(50);

      console.log("Backend: Found", messages.length, "messages");
      return messages;
    },

    message: async (_, { id }, context) => {
      if (!context.user) throw new Error("Authentication required");
      return await Message.findById(id).populate(
        "sender",
        "username profilePhoto",
      );
    },

    posts: async (_, { neighborhoodId }, context) => {
      if (!context.user) throw new Error("Authentication required");

      const query = {};

      if (neighborhoodId) {
        // ✅ Show posts from this neighborhood
        query.neighborhood = neighborhoodId;
      } else {
        // ✅ If no neighborhoodId, return empty or error
        // Or return your future "public" posts
        return [];
      }

      const posts = await Post.find(query)
        .populate("author", "username profilePhoto")
        .sort({ createdAt: -1 })
        .limit(50);

      return posts;
    },

    post: async (_, { id }) =>
      await Post.findById(id).populate("author").populate("group"),

    // Group queries
    groups: async () => await Group.find().populate("members"),
    group: async (_, { id }) => await Group.findById(id).populate("members"),

    neighborhoods: async () => {
      return await Neighborhood.find({ isActive: true })
        .populate("owner", "username profilePhoto")
        .populate("members.user", "username profilePhoto")
        .sort({ createdAt: -1 });
    },

    // Get specific neighborhood
    neighborhood: async (_, { id }) => {
      return await Neighborhood.findById(id)
        .populate("owner", "username profilePhoto")
        .populate("members.user", "username profilePhoto")
        .populate("joinRequests.user", "username profilePhoto");
    },

    // Get neighborhoods the current user belongs to
    myNeighborhoods: async (_, __, context) => {
      if (!context.user) throw new Error("Authentication required");

      return await Neighborhood.find({
        "members.user": context.user.userId,
        type: { $ne: "direct" },
        isActive: true,
      })
        .populate("owner", "username profilePhoto")
        .populate("members.user", "username profilePhoto")
        .sort({ createdAt: -1 });
    },

    // Discover public neighborhoods
    discoverNeighborhoods: async () => {
      return await Neighborhood.find({
        type: "public",
        isActive: true,
      })
        .populate("owner", "username profilePhoto")
        .populate("members.user", "username profilePhoto")
        .sort({ createdAt: -1 })
        .limit(20); // Limit for discovery feed
    },
    neighborhoodMessages: async (_, { neighborhoodId }, context) => {
      if (!context.user) throw new Error("Authentication required");

      // 🔑 CRITICAL FIX: Add this check to prevent Mongoose from failing on bad IDs
      if (!neighborhoodId || !mongoose.Types.ObjectId.isValid(neighborhoodId)) {
        console.error("Invalid neighborhoodId provided:", neighborhoodId);
        // Return null or empty array gracefully instead of throwing a generic server error
        return [];
      }

      // Check if user is member of this neighborhood
      const neighborhood = await Neighborhood.findById(neighborhoodId);

      // Keep this check, but ensure it runs AFTER the ID validation
      if (!neighborhood) {
        // We should throw a specific error for debugging, but for robust API,
        // we can return empty if we can't find it.
        throw new Error(`Neighborhood ID ${neighborhoodId} not found.`);
      }

      const isMember = neighborhood.members.some(
        (member) => member.user.toString() === context.user.userId,
      );

      if (!isMember) throw new Error("Not a member of this neighborhood");
      // Message.find() always returns an array, so no need for || []
      return await Message.find({ neighborhood: neighborhoodId })
        .populate("sender", "username profilePhoto")
        .sort({ createdAt: -1 })
        .limit(50);
    },

    // Get videos for a specific neighborhood
    neighborhoodVideos: async (_, { neighborhoodId }, context) => {
      if (!context.user) throw new Error("Authentication required");

      // Check membership
      const neighborhood = await Neighborhood.findById(neighborhoodId);
      const isMember = neighborhood.members.some(
        (member) => member.user.toString() === context.user.userId,
      );

      if (!isMember) throw new Error("Not a member of this neighborhood");

      return await Video.find({ neighborhood: neighborhoodId })
        .populate("user", "username profilePhoto")
        .sort({ createdAt: -1 });
    },

    getMyVideos: async (_, __, { user }) => {
      try {
        if (!user) {
          throw new Error("Authentication required");
        }

        console.log("🔐 Fetching videos for user:", user.userId);

        const videos = await Video.find({ user: user.userId })
          .populate("user", "username profilePhoto")
          .populate("neighborhood", "name description")
          .sort({ createdAt: -1 });

        console.log(`✅ Found ${videos.length} videos for user ${user.userId}`);
        return videos;
      } catch (error) {
        console.error("❌ Error in getMyVideos:", error);
        throw new Error("Failed to fetch videos: " + error.message);
      }
    },
    // NEW: Get neighborhood videos (with access control)
    // Update your getNeighborhoodVideos resolver
    getNeighborhoodVideos: async (_, { neighborhoodId }, { user }) => {
      try {
        if (!user) throw new Error("Authentication required");

        console.log("🏘️ Fetching videos FOR neighborhood:", neighborhoodId);

        // 1. Verify user has access
        const neighborhood = await Neighborhood.findOne({
          _id: neighborhoodId,
          $or: [{ owner: user.userId }, { "members.user": user.userId }],
        });

        if (!neighborhood) throw new Error("Access denied to neighborhood");

        // 2. ✅ CRITICAL: Only get videos WITH this neighborhood ID
        const videos = await Video.find({
          neighborhood: neighborhoodId, // This is the key filter!
        })
          .populate("user", "username profilePhoto")
          .populate("neighborhood", "name description")
          .sort({ createdAt: -1 });
        /*
        console.log(
          `✅ Found ${videos.length} videos SHARED TO neighborhood ${neighborhoodId}`,
        );
        */
        return videos;
      } catch (error) {
        console.error("❌ Error:", error);
        throw error;
      }
    },

    // Add this resolver for neighborhood images
    getNeighborhoodImages: async (_, { neighborhoodId }, { user }) => {
      try {
        if (!user) throw new Error("Authentication required");

        // Verify access
        const neighborhood = await Neighborhood.findOne({
          _id: neighborhoodId,
          $or: [{ owner: user.userId }, { "members.user": user.userId }],
        });

        if (!neighborhood) throw new Error("Access denied to neighborhood");

        // Get images shared to this neighborhood
        const images = await Image.find({
          neighborhood: neighborhoodId, // Only images shared here
        })
          .populate("user", "username profilePhoto")
          .populate("neighborhood", "name description")
          .sort({ createdAt: -1 });

        return images;
      } catch (error) {
        console.error("Error getting neighborhood images:", error);
        throw error;
      }
    },

    // New combined resolver
    // Replace your current getNeighborhoodGallery resolver with this:
    getNeighborhoodGallery: async (_, { neighborhoodId }, { user }) => {
      try {
        if (!user) throw new Error("Authentication required");

        console.log("🎨 Fetching gallery for neighborhood:", neighborhoodId);

        // Verify access
        const neighborhood = await Neighborhood.findOne({
          _id: neighborhoodId,
          $or: [{ owner: user.userId }, { "members.user": user.userId }],
        });

        if (!neighborhood) {
          console.log("❌ Access denied or neighborhood not found");
          throw new Error("Access denied to neighborhood");
        }

        console.log("✅ Access granted to neighborhood:", neighborhood.name);

        // Get videos from this neighborhood
        const videos = await Video.find({ neighborhood: neighborhoodId })
          .populate("user", "username profilePhoto")
          .populate("neighborhood", "name description");

        // Get images from this neighborhood
        const images = await Image.find({ neighborhood: neighborhoodId })
          .populate("user", "username profilePhoto")
          .populate("neighborhood", "name description");
        /*
        console.log(
          `📊 Found: ${videos.length} videos, ${images.length} images`,
        );
        */

        // Return as GalleryResponse object
        return {
          videos: videos,
          images: images,
          totalCount: videos.length + images.length,
        };
      } catch (error) {
        console.error("❌ Error in getNeighborhoodGallery:", error);
        throw error;
      }
    },

    // NEW: Get specific user's videos (public only or with permission)
    getUserVideos: async (_, { userId }, { user }) => {
      try {
        if (!user) {
          throw new Error("Authentication required");
        }
        /*
        console.log("👤 Fetching user videos:", {
          targetUserId: userId,
          requestorId: user.userId,
        });
        */

        // Users can see their own videos or public videos from others
        const query = { user: userId };

        // If requesting someone else's videos, only show public ones
        if (userId !== user.userId) {
          query.isPublic = true;
        }

        const videos = await Video.find(query)
          .populate("user", "username profilePhoto")
          .populate("neighborhood", "name description")
          .sort({ createdAt: -1 });

        console.log(`✅ Found ${videos.length} videos for user ${userId}`);
        return videos;
      } catch (error) {
        console.error("❌ Error in getUserVideos:", error);
        throw new Error("Failed to fetch user videos: " + error.message);
      }
    },
    validateInviteLink: async (_, { code }) => {
      const neighborhood = await Neighborhood.findOne({
        "inviteLinks.code": code,
        "inviteLinks.isActive": true,
      })
        .populate("owner", "username profilePhoto")
        .populate("inviteLinks.createdBy", "username profilePhoto");

      if (!neighborhood) {
        return {
          isValid: false,
          message: "Invalid invite link",
        };
      }

      const link = neighborhood.inviteLinks.find((link) => link.code === code);

      if (!link) {
        return {
          isValid: false,
          message: "Invalid invite link",
        };
      }

      // Check if link is expired
      if (link.expiresAt && link.expiresAt < new Date()) {
        return {
          isValid: false,
          message: "This invite link has expired",
        };
      }

      // Check if link has reached max uses
      if (link.maxUses > 0 && link.uses >= link.maxUses) {
        return {
          isValid: false,
          message: "This invite link has reached its maximum uses",
        };
      }

      return {
        isValid: true,
        message: "Valid invite link",
        link: {
          ...link.toObject(),
          id: link._id.toString(),
        },
        neighborhood: {
          id: neighborhood._id.toString(),
          name: neighborhood.name,
          description: neighborhood.description,
          type: neighborhood.type,
          owner: neighborhood.owner,
          memberCount: neighborhood.members.length,
        },
      };
    },

    // Get invite links for a neighborhood
    // In resolvers.js - Update the neighborhoodInviteLinks resolver with debugging
    // In resolvers.js - Update the neighborhoodInviteLinks resolver with debugging
    // In resolvers.js - Fix the neighborhoodInviteLinks resolver
    neighborhoodInviteLinks: async (_, { neighborhoodId }, context) => {
      console.log("🔍 neighborhoodInviteLinks resolver - DEBUG");

      if (!context.user) {
        console.log("❌ No user in context");
        throw new Error("Authentication required");
      }

      const neighborhood = await Neighborhood.findById(neighborhoodId).populate(
        {
          path: "inviteLinks.createdBy",
          select: "_id username profilePhoto", // Make sure _id is selected
          transform: (doc) => {
            // Transform the populated document to match GraphQL schema
            if (!doc) return null;
            return {
              id: doc._id.toString(), // ✅ Convert to string
              username: doc.username,
              profilePhoto: doc.profilePhoto,
            };
          },
        },
      );

      if (!neighborhood) {
        console.log("❌ Neighborhood not found");
        throw new Error("Neighborhood not found");
      }

      // Check permissions
      const userRole = neighborhood.members.find(
        (member) => member.user.toString() === context.user.userId,
      )?.role;

      console.log("User role:", userRole);

      if (!["owner", "moderator"].includes(userRole)) {
        console.log("❌ User doesn't have permission");
        throw new Error("Only owners and moderators can view invite links");
      }

      console.log("Found invite links:", neighborhood.inviteLinks.length);

      // Transform each link to ensure proper format
      const result = neighborhood.inviteLinks.map((link) => {
        console.log("Processing link:", link.code);
        console.log("Link createdBy:", link.createdBy);
        console.log("Link createdBy type:", typeof link.createdBy);

        const transformedLink = {
          ...link.toObject(),
          id: link._id.toString(),
          url: `${process.env.APP_URL || "http://bubblebased.com"}/join/${
            link.code
          }`,
        };

        // Ensure createdBy has proper id field
        if (link.createdBy) {
          if (typeof link.createdBy === "object") {
            // If it's already an object from populate transform
            transformedLink.createdBy = link.createdBy;
          } else if (link.createdBy._id) {
            // If it's a mongoose document
            transformedLink.createdBy = {
              id: link.createdBy._id.toString(),
              username: link.createdBy.username,
              profilePhoto: link.createdBy.profilePhoto,
            };
          } else {
            // Fallback
            transformedLink.createdBy = {
              id: "unknown",
              username: "Unknown",
              profilePhoto: null,
            };
          }
        } else {
          // If no createdBy, provide fallback
          transformedLink.createdBy = {
            id: "unknown",
            username: "Unknown",
            profilePhoto: null,
          };
        }

        console.log("Transformed createdBy:", transformedLink.createdBy);
        return transformedLink;
      });

      console.log(`✅ Returning ${result.length} links`);
      return result;
    },
  },

  Mutation: {
    updateBubblePhoto: async (_, { neighborhoodId, cid }, context) => {
      console.log("🔥 updateBubblePhoto called");
      console.log("   neighborhoodId:", neighborhoodId);
      console.log("   cid:", cid);
      console.log("   context.user:", context.user);

      if (!context.user) throw new Error("Authentication required");

      const neighborhood = await Neighborhood.findById(neighborhoodId);
      console.log("   neighborhood found:", !!neighborhood);

      if (!neighborhood) throw new Error("Neighborhood not found");

      console.log("   neighborhood.owner:", neighborhood.owner.toString());
      console.log("   context.user.userId:", context.user.userId);

      if (neighborhood.owner.toString() !== context.user.userId.toString()) {
        throw new Error("Only the owner can set the bubble photo");
      }

      neighborhood.bubblePhotoCid = cid;
      console.log("   setting bubblePhotoCid to:", cid);

      await neighborhood.save();
      console.log("   ✅ saved!");

      return neighborhood;
    },

    createDirectMessageBubble: async (_, { userId }, { user }) => {
      if (!user) throw new Error("Authentication required");

      // Check if DM bubble already exists
      const existingBubble = await Neighborhood.findOne({
        type: "direct",
        $and: [{ "members.user": user.userId }, { "members.user": userId }],
      });

      if (existingBubble) return existingBubble;

      const newBubble = new Neighborhood({
        name: "Direct Message",
        type: "direct",
        owner: user.userId,
        members: [
          { user: user.userId, role: "owner" },
          { user: userId, role: "member" },
        ],
      });

      await newBubble.save();
      return newBubble;
    },

    acceptBubbleInvite: async (
      _,
      { directMessageBubbleId, originalBubbleId },
      { user },
    ) => {
      if (!user) throw new Error("Authentication required");

      const originalBubble = await Neighborhood.findById(originalBubbleId);
      if (!originalBubble) throw new Error("Bubble not found");

      originalBubble.members.push({
        user: user.userId,
        role: "member",
        joinedAt: new Date(),
      });

      await originalBubble.save();
      return true;
    },

    addComment: async (_, { postId, content }, context) => {
      if (!context.user) throw new Error("Authentication required");

      const userId = context.user.userId || context.user.id;

      // 1. Find the post
      const post = await Post.findById(postId);
      if (!post) throw new Error("Post not found");

      // 2. Create the comment
      const comment = new Comment({
        content,
        author: userId,
        post: postId,
      });

      await comment.save();

      // 3. Add comment to post's comments array
      post.comments.push(comment._id);
      await post.save();

      // 4. Populate author and return
      return await comment.populate("author", "username profilePhoto");
    },
    // In your createPost resolver
    // CREATE_POST mutation resolver
    createPost: async (_, { input }, context) => {
      if (!context.user) throw new Error("Authentication required");

      const userId = context.user.userId || context.user.id;

      // ✅ Require neighborhoodId
      if (!input.neighborhoodId) {
        throw new Error("neighborhoodId is required");
      }

      // Validate neighborhood access
      if (!mongoose.Types.ObjectId.isValid(input.neighborhoodId)) {
        throw new Error("Invalid neighborhood ID provided");
      }

      const targetNeighborhood = await Neighborhood.findById(
        input.neighborhoodId,
      );
      if (!targetNeighborhood) {
        throw new Error(`Neighborhood ${input.neighborhoodId} not found`);
      }

      const isMember = targetNeighborhood.members.some(
        (member) => member.user.toString() === userId,
      );
      if (!isMember) {
        throw new Error("Not a member of this neighborhood");
      }
      // Create the post - ALWAYS neighborhood!
      const post = new Post({
        content: input.content,
        author: userId,
        feedType: "neighborhood", // ← Always neighborhood
        neighborhood: input.neighborhoodId,
        group: input.groupId || null,
        media: input.media || [],
        affiliate: input.affiliate || null,
        isPinned: input.isPinned || false,
      });

      await post.save();
      const populated = await post.populate("author", "username profilePhoto");

      console.log("✅ Post created in neighborhood:", populated.neighborhood);
      return populated;
    },

    completeStream: async (
      _,
      { sessionId, archiveUrl, totalChunks },
      context,
    ) => {
      if (!context.user) throw new Error("Authentication required");

      // Determine if this is a "Long Hangout" (P2P only) or a "Clip" (IPFS)
      // If the frontend didn't send an archiveUrl, we assume it's staying P2P
      const isPermanentP2P = !archiveUrl;

      const stream = await Stream.findOneAndUpdate(
        { sessionId },
        {
          status: "completed",
          archiveUrl: archiveUrl || null,
          isPermanentP2P: isPermanentP2P,
          totalChunks: totalChunks,
          endedAt: new Date(),
        },
        { new: true },
      ).populate("startedBy neighborhood");

      return stream;
    },
    // Toggle video privacy
    toggleVideoPrivacy: async (_, { videoId }, { user }) => {
      if (!user) throw new Error("Authentication required");

      const video = await Video.findById(videoId);

      if (!video) throw new Error("Video not found");

      // Check ownership
      if (video.user.toString() !== user.userId) {
        throw new Error("Not authorized");
      }

      // Simple toggle
      video.isPublic = !video.isPublic;
      await video.save();

      return video;
    },

    // Create video with isPublic flag
    createVideo: async (_, { input }, { user }) => {
      if (!user) throw new Error("Authentication required");

      const video = new Video({
        ...input,
        user: user.userId,
        isPublic: input.isPublic || false, // Default to private
      });

      await video.save();
      return await video.populate("user neighborhood");
    },

    // backend/graphql/resolvers.js

    createStream: async (
      _,
      { title, neighborhoodId, sessionId, rotation },
      context,
    ) => {
      if (!context.user) throw new Error("Authentication required");

      // 1. Ensure the neighborhood exists and the user is a member
      const neighborhood = await Neighborhood.findById(neighborhoodId);
      if (!neighborhood) throw new Error("Neighborhood not found");

      const isMember = neighborhood.members.some(
        (member) => member.user.toString() === context.user.userId,
      );
      if (!isMember) throw new Error("You must be a member to stream here.");

      // 2. Create the Stream object (safely default rotation to 0 if undefined)
      const newStream = new Stream({
        title,
        startedBy: context.user.userId,
        neighborhood: neighborhoodId,
        sessionId:
          sessionId ||
          `live_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: "live",
        rotation: typeof rotation === "number" ? rotation : 0, // 👈 SAFELY CHECKED HERE
        createdAt: new Date(),
      });

      await newStream.save();
      console.log("✅ New stream created with sessionId:", newStream.sessionId);

      return await Stream.findById(newStream._id)
        .populate("startedBy")
        .populate("neighborhood");
    },

    // Mutation: sendMessage(input: MessageInput!): Message!
    sendMessage: async (_, args, context) => {
      if (!context.user) throw new Error("Authentication required");

      // 1. EXTRACT USERID HERE
      const userId = context.user.userId || context.user.id;

      // Fall back to args directly if 'input' wasn't passed as a sub-object
      const input = args.input || args;

      const {
        content,
        room = "neighborhood",
        imageUrl,
        videoUrl,
        fileUrl,
        fileName,
        fileType,
        fileSize,
        magnetLink,
        mimeType,
        ipfsHash,
        ipfsData,
        rotation,
        sessionId,
        chunkIndex,
        totalChunks,
        neighborhoodId,
      } = input;
      /*
      console.log(
        "Backend: Sending message for neighborhood:",
        neighborhoodId,
        "room:",
        room,
      );
*/
      // 2. Now userId is valid here:
      if (neighborhoodId) {
        if (!mongoose.Types.ObjectId.isValid(neighborhoodId)) {
          throw new Error("Invalid neighborhood ID");
        }
        const neighborhood = await Neighborhood.findById(neighborhoodId);
        if (!neighborhood) throw new Error("Neighborhood not found");

        const isMember = neighborhood.members.some(
          (member) => member.user.toString() === userId,
        );
        if (!isMember) throw new Error("Not a member of this neighborhood");
      }

      // 2. Create message document
      const message = new Message({
        sender: userId,
        content,
        room: room || "neighborhood",
        imageUrl: imageUrl || null,
        videoUrl: videoUrl || null,
        fileUrl: fileUrl || null,
        fileName: fileName || null,
        fileType: fileType || null,
        fileSize: fileSize || null,
        magnetLink: magnetLink || null,
        mimeType: mimeType,
        ipfsHash: ipfsHash || null,
        rotation: rotation || null,
        ipfsData: ipfsData || null,
        neighborhood: neighborhoodId || null,
        sessionId: sessionId || null,
        chunkIndex: typeof chunkIndex === "number" ? chunkIndex : undefined,
        totalChunks: typeof totalChunks === "number" ? totalChunks : undefined,
        createdAt: new Date(),
      });

      await message.save();
      console.log("Backend: Message saved with ID:", message._id);

      // ✅ NEW: If this message has media, also create a Post
      if (
        neighborhoodId &&
        !sessionId && // 👈 livestream exclusion
        (imageUrl || videoUrl || magnetLink) &&
        fileType !== "video_chunk" &&
        fileType !== "video_header"
      ) {
        try {
          await Post.create({
            content: content || `Shared: ${fileName || "media"}`,
            author: userId,
            feedType: "neighborhood",
            neighborhood: neighborhoodId,
            media: [
              {
                url: imageUrl || videoUrl,
                cid: ipfsHash,
                magnetURI: magnetLink,
                mediaType: fileType === "video" ? "video" : "image",
                fileName: fileName,
              },
            ],
            createdAt: new Date(),
          });
          console.log("✅ Created Post from chat media");
        } catch (postErr) {
          console.error("❌ Failed to create Post from chat media:", postErr);
        }
      }

      // 3. Sync video chunk to StreamChunk model if streaming
      if (
        sessionId &&
        (fileType === "video_chunk" || fileType === "video_header")
      ) {
        try {
          const parentStream = await Stream.findOne({ sessionId });
          if (parentStream) {
            await StreamChunk.findOneAndUpdate(
              {
                stream: parentStream._id,
                chunkIndex: typeof chunkIndex === "number" ? chunkIndex : -1,
              },
              {
                sessionId,
                magnetLink,
                fileName: fileName || "blob",
                mimeType: mimeType,
                fileSize: fileSize || 0,
              },
              {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
              },
            );

            if (chunkIndex === -1 && input.thumbnailUrl) {
              parentStream.status = "live";
              await parentStream.save();
            }
          }
        } catch (err) {
          console.error("Error syncing message to StreamChunk:", err);
        }
      }

      // 4. Populate sender user info
      const populatedMessage = await Message.findById(message._id)
        .populate("sender", "username profilePhoto")
        .exec();

      const result = populatedMessage.toObject();
      result.id = result._id.toString();

      // 5. Emit real-time updates via Socket.io
      if (context.io) {
        const emitRoom = neighborhoodId
          ? `neighborhood-${neighborhoodId}`
          : room;
        context.io.to(emitRoom).emit("message", result);
      }

      // 6. Publish chunk updates via GraphQL Subscriptions
      if (
        (fileType === "video_chunk" || fileType === "video_header") &&
        sessionId
      ) {
        const topic = `LIVESTREAM_CHUNK_ADDED_${sessionId}`;
        const cleanChunk = {
          ...result,
          id: result._id.toString(),
          chunkIndex: typeof chunkIndex === "number" ? chunkIndex : -1,
        };
        /*
        console.log(
          `[PUB] Sending ${fileType} #${cleanChunk.chunkIndex} to ${topic}`,
        );
        */
        pubsub.publish(topic, {
          livestreamChunkAdded: cleanChunk,
        });
      }

      return result;
    },

    deleteMessage: async (_, { messageId }, context) => {
      try {
        if (!context.user) {
          throw new Error("Authentication required");
        }

        const message = await Message.findById(messageId);
        if (!message) {
          throw new Error("Message not found");
        }

        // Check if user owns the message or is admin
        // ⬅️ FIXED: Changed context.user.id to context.user.userId for consistency
        const isOwner = message.sender.toString() === context.user.userId;
        if (!isOwner) {
          // Optional: Check if user is neighborhood admin
          const neighborhood = await Neighborhood.findOne({
            _id: message.neighborhood,
            $or: [
              // ⬅️ FIXED: Changed context.user.id to context.user.userId
              { owner: context.user.userId },
              // ⬅️ FIXED: Changed context.user.id to context.user.userId
              { "members.user": context.user.userId, "members.role": "admin" },
            ],
          });
          if (!neighborhood) {
            throw new Error("Not authorized to delete this message");
          }
        }

        // Delete associated files from IPFS (optional)
        if (message.imageUrl || message.videoUrl || message.fileUrl) {
          console.log("Cleaning up media for message:", messageId);
          // You might want to add IPFS cleanup logic here
        }

        await Message.findByIdAndDelete(messageId);
        return true;
      } catch (error) {
        console.error("Delete message error:", error);
        throw new Error(`Failed to delete message: ${error.message}`);
      }
    },

    deletePost: async (_, { postId }, context) => {
      try {
        if (!context.user) {
          throw new Error("Authentication required");
        }

        const post = await Post.findById(postId).populate("author");
        if (!post) {
          throw new Error("Post not found");
        }

        // Check if user owns the post or is admin
        // ⬅️ FIXED: Changed context.user.id to context.user.userId
        const isOwner = post.author._id.toString() === context.user.userId;
        if (!isOwner) {
          throw new Error("Not authorized to delete this post");
        }

        // Delete associated comments
        // NOTE: The Comment model must be imported for this line to work.
        // Assuming Comment is available in the scope above.
        // await Comment.deleteMany({ _id: { $in: post.comments } });

        await Post.findByIdAndDelete(postId);
        return true;
      } catch (error) {
        console.error("Delete post error:", error);
        throw new Error(`Failed to delete post: ${error.message}`);
      }
    },
    addAffiliateLink: async (_, { url, title, description }, context) => {
      // ... (existing addAffiliateLink logic is correct, assuming context.user.id is used there)
      try {
        if (!context.user) {
          throw new Error("Authentication required");
        }

        const userId = context.user.userId; // Assuming context.user.userId here
        console.log("🔄 Looking for user with ID:", userId);

        // Use _id for MongoDB query
        const user = await User.findById(userId);
        console.log("🔍 User found:", user ? "Yes" : "No");

        if (!user) {
          throw new Error(`User not found with ID: ${userId}`);
        }

        // Validate the affiliate link (make sure this function is defined)
        if (!validateAndExtractAffiliateHtml(html)) {
          throw new Error(
            "Invalid affiliate link. Must be from approved networks (impact.com, cj.com, rakuten.com, shareasale.com, awin.com, webgains.com)",
          );
        }

        const newLink = {
          url,
          title: title || "",
          description: description || "",
          clicks: 0,
        };

        user.affiliateLinks.push(newLink);
        await user.save();

        console.log("✅ Affiliate link added successfully");
        return user;
      } catch (error) {
        console.error("❌ Error in addAffiliateLink:", error);
        throw new Error(`Error adding affiliate link: ${error.message}`);
      }
    },

    updateProfile: async (
      _,
      { bio, profilePhoto, affiliateLinks },
      context,
    ) => {
      if (!context.user) throw new Error("Authentication required");

      const userId = context.user.userId;
      const updates = {};

      if (bio !== undefined) updates.bio = bio;
      if (profilePhoto !== undefined) updates.profilePhoto = profilePhoto;

      // --- Affiliate Link Processing ---
      if (affiliateLinks && affiliateLinks.length > 0) {
        const validatedLinks = [];

        for (const link of affiliateLinks) {
          // link.url holds the raw HTML snippet sent from the client
          const validationResult = validateAndExtractAffiliateHtml(link.url);

          if (validationResult.isValid) {
            // ✅ SUCCESS: Structure the data to save to MongoDB
            validatedLinks.push({
              // 1. The Extracted Destination URL (href)
              url: validationResult.data.url,

              // 2. The Extracted Image URL (src)
              imageUrl: validationResult.data.imageUrl,

              // 3. The Extracted Title
              title: validationResult.data.title,

              // 🔑 CRITICAL FIX: Save the original RAW HTML snippet into the available 'description' field
              description: link.url,

              clicks: 0,
            });
          } else {
            console.warn(
              `Skipping invalid link for user ${userId}: ${validationResult.error}`,
            );
          }
        }

        updates.affiliateLinks = validatedLinks;
      } else if (affiliateLinks && affiliateLinks.length === 0) {
        updates.affiliateLinks = [];
      }

      // --- Database Update ---
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: updates },
        { new: true },
      );

      if (!updatedUser) {
        throw new Error("User not found or update failed.");
      }

      return updatedUser;
    },

    // ⬅️ STANDALONE MUTATION: Extracted attachMagnet from removeMember
    attachMagnet: async (_, { id, magnetLink }, { user }) => {
      try {
        if (!user) throw new Error("Authentication required");

        // Find the Video and verify the user owns it
        const media = await Video.findOne({ _id: id, user: user.userId }); // Assuming 'user' field on Video schema
        if (!media) throw new Error("Video not found or you don't own it");

        // Update the magnetLink field
        return Video.findByIdAndUpdate(id, { magnetLink }, { new: true });
      } catch (error) {
        console.error("Error attaching magnet link:", error);
        throw new Error(`Failed to attach magnet link: ${error.message}`);
      }
    },

    removeMember: async (_, { neighborhoodId, userId }, context) => {
      if (!context.user) throw new Error("Authentication required");

      const neighborhood = await Neighborhood.findById(neighborhoodId);
      if (!neighborhood) throw new Error("Neighborhood not found");

      // Check if user has permission (owner or moderator)
      const userRole = neighborhood.members.find(
        (member) => member.user.toString() === context.user.userId,
      )?.role;

      if (!userRole || !["owner", "moderator"].includes(userRole)) {
        throw new Error("Only owners and moderators can remove members");
      }

      // Can't remove yourself or the owner
      if (userId === context.user.userId) {
        throw new Error("Cannot remove yourself");
      }

      const targetMember = neighborhood.members.find(
        (member) => member.user.toString() === userId,
      );

      if (targetMember?.role === "owner") {
        throw new Error("Cannot remove the neighborhood owner");
      }

      // Remove from members
      neighborhood.members = neighborhood.members.filter(
        (member) => member.user.toString() !== userId,
      );

      await neighborhood.save();

      return await Neighborhood.findById(neighborhood._id)
        .populate("owner", "username profilePhoto")
        .populate("members.user", "username profilePhoto");
    },
    // ... (rest of mutations are assumed correct)
    registerUser: async (_, { username, email, password }) => {
      // ... (existing registerUser logic)
      const existingUser = await User.findOne({
        $or: [{ email }, { username }],
      });
      if (existingUser) throw new Error("User already exists");

      const user = new User({
        username,
        email,
        password: password,
        profilePhoto: `https://ui-avatars.com/api/?name=${encodeURIComponent(
          username,
        )}&background=00FF00&color=000`,
        affiliateLinks: [],
        videos: [],
        streams: [],
        chats: [],
        posts: [],
        groups: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await user.save();

      const personalNeighborhood = new Neighborhood({
        name: `${user.username}'s Bubble`,
        description: "Your personal digital bubbledom",
        type: "personal",
        owner: user._id,
        members: [
          {
            user: user._id,
            role: "owner",
            joinedAt: new Date(),
          },
        ],
      });
      await personalNeighborhood.save();

      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        // Ensure JWT payload uses 'userId'
        expiresIn: "24h",
      });

      return {
        token,
        user,
      };
    },

    loginUser: async (_, { username, password }) => {
      const user = await User.findOne({ username });
      if (!user) throw new Error("User not found");

      // ... (existing loginUser logic)
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) throw new Error("Invalid password");

      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        // Ensure JWT payload uses 'userId'
        expiresIn: "24h",
      });

      return {
        token,
        user,
      };
    },

    // Create a new neighborhood
    createNeighborhood: async (_, { name, description, type }, context) => {
      // ... (existing createNeighborhood logic)
      if (!context.user) throw new Error("Authentication required");

      // Validate neighborhood type
      const validTypes = ["personal", "private", "public", "global"];
      if (!validTypes.includes(type)) {
        throw new Error(
          `Invalid neighborhood type. Must be one of: ${validTypes.join(", ")}`,
        );
      }

      const neighborhood = new Neighborhood({
        name,
        description: description || "",
        type,
        owner: context.user.userId,
        members: [
          {
            user: context.user.userId,
            role: "owner",
            joinedAt: new Date(),
          },
        ],
        rules: "",
      });

      await neighborhood.save();

      // Return populated neighborhood
      return await Neighborhood.findById(neighborhood._id)
        .populate("owner", "username profilePhoto")
        .populate("members.user", "username profilePhoto");
    },
    // ... (rest of mutations are assumed correct)

    // Update neighborhood (owner only)
    updateNeighborhood: async (
      _,
      { id, name, description, rules },
      context,
    ) => {
      if (!context.user) throw new Error("Authentication required");

      const neighborhood = await Neighborhood.findById(id);
      if (!neighborhood) throw new Error("Neighborhood not found");

      // Check if user is the owner
      if (neighborhood.owner.toString() !== context.user.userId) {
        throw new Error("Only the neighborhood owner can update settings");
      }

      // Update fields if provided
      if (name !== undefined) neighborhood.name = name;
      if (description !== undefined) neighborhood.description = description;
      if (rules !== undefined) neighborhood.rules = rules;

      await neighborhood.save();

      return await Neighborhood.findById(neighborhood._id)
        .populate("owner", "username profilePhoto")
        .populate("members.user", "username profilePhoto");
    },

    // Delete neighborhood (owner only)
    deleteNeighborhood: async (_, { neighborhoodId }, context) => {
      if (!context.user) throw new Error("Authentication required");

      const neighborhood = await Neighborhood.findById(neighborhoodId);
      if (!neighborhood) throw new Error("Neighborhood not found");

      // Only the owner can delete
      if (neighborhood.owner.toString() !== context.user.userId.toString()) {
        throw new Error("Only the owner can delete this bubble");
      }

      // Prevent deleting personal bubbles (they're the user's sanctuary)
      if (neighborhood.type === "personal") {
        throw new Error("Personal bubbles cannot be deleted");
      }

      // Clean up associated data
      await Post.deleteMany({ neighborhood: neighborhoodId });
      await Message.deleteMany({ neighborhood: neighborhoodId });
      await Neighborhood.findByIdAndDelete(neighborhoodId);

      return true;
    },

    // Join a neighborhood
    joinNeighborhood: async (_, { neighborhoodId }, context) => {
      if (!context.user) throw new Error("Authentication required");

      const neighborhood = await Neighborhood.findById(neighborhoodId);
      if (!neighborhood || !neighborhood.isActive) {
        throw new Error("Neighborhood not found");
      }

      // Check if user is already a member
      const isAlreadyMember = neighborhood.members.some(
        (member) => member.user.toString() === context.user.userId,
      );

      if (isAlreadyMember) {
        throw new Error("You are already a member of this neighborhood");
      }

      // Handle different neighborhood types
      if (neighborhood.type === "public") {
        // Auto-join public neighborhoods
        neighborhood.members.push({
          user: context.user.userId,
          role: "member",
          joinedAt: new Date(),
        });
      } else if (neighborhood.type === "private") {
        // Add to join requests for private neighborhoods
        const alreadyRequested = neighborhood.joinRequests.some(
          (request) => request.user.toString() === context.user.userId,
        );

        if (!alreadyRequested) {
          neighborhood.joinRequests.push({
            user: context.user.userId,
            status: "pending",
          });
        }
      } else if (neighborhood.type === "personal") {
        throw new Error("Cannot join personal neighborhoods");
      }

      await neighborhood.save();

      return await Neighborhood.findById(neighborhood._id)
        .populate("owner", "username profilePhoto")
        .populate("members.user", "username profilePhoto")
        .populate("joinRequests.user", "username profilePhoto");
    },

    // Leave a neighborhood
    leaveNeighborhood: async (_, { neighborhoodId }, context) => {
      if (!context.user) throw new Error("Authentication required");

      const neighborhood = await Neighborhood.findById(neighborhoodId);
      if (!neighborhood) throw new Error("Neighborhood not found");

      // Can't leave if you're the owner (or implement transfer ownership)
      if (neighborhood.owner.toString() === context.user.userId) {
        throw new Error(
          "Neighborhood owner cannot leave. Transfer ownership or delete the neighborhood.",
        );
      }

      // Remove from members
      neighborhood.members = neighborhood.members.filter(
        (member) => member.user.toString() !== context.user.userId,
      );

      await neighborhood.save();
      return true;
    },

    // Approve join request (owner/moderator only)
    approveJoinRequest: async (_, { neighborhoodId, userId }, context) => {
      if (!context.user) throw new Error("Authentication required");

      const neighborhood = await Neighborhood.findById(neighborhoodId);
      if (!neighborhood) throw new Error("Neighborhood not found");

      // Check permissions
      const userRole = neighborhood.members.find(
        (member) => member.user.toString() === context.user.userId,
      )?.role;

      if (!userRole || !["owner", "moderator"].includes(userRole)) {
        throw new Error("Only owners and moderators can approve join requests");
      }

      // Find and update the join request
      const joinRequest = neighborhood.joinRequests.find(
        (request) =>
          request.user.toString() === userId && request.status === "pending",
      );

      if (!joinRequest) throw new Error("Join request not found");

      joinRequest.status = "approved";

      // Add to members
      neighborhood.members.push({
        user: userId,
        role: "member",
        joinedAt: new Date(),
      });

      await neighborhood.save();

      return await Neighborhood.findById(neighborhood._id)
        .populate("owner", "username profilePhoto")
        .populate("members.user", "username profilePhoto")
        .populate("joinRequests.user", "username profilePhoto");
    },

    // In resolvers.js - Update the createInviteLink resolver
    createInviteLink: async (
      _,
      {
        neighborhoodId,
        name = "Invite Link",
        maxUses = 0,
        expiresInDays,
        role = "member",
      },
      context,
    ) => {
      console.log("🚀 CREATE INVITE LINK RESOLVER");

      try {
        if (!context.user) throw new Error("Authentication required");

        const neighborhood = await Neighborhood.findById(neighborhoodId);
        if (!neighborhood) throw new Error("Neighborhood not found");

        // Check permissions
        const userRole = neighborhood.members.find(
          (member) => member.user.toString() === context.user.userId,
        )?.role;

        if (!["owner", "moderator"].includes(userRole)) {
          throw new Error("Only owners and moderators can create invite links");
        }

        // Handle expiresInDays
        let expiresAt = null;
        if (expiresInDays && expiresInDays > 0) {
          expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + expiresInDays);
        }

        // Create the link using the model method
        const link = await neighborhood.createInviteLink({
          createdBy: context.user.userId,
          name,
          maxUses,
          expiresAt,
          role,
        });

        console.log("✅ Link created, ID:", link._id);

        // Get the neighborhood with populated data
        const savedNeighborhood = await Neighborhood.findById(
          neighborhood._id,
        ).populate({
          path: "inviteLinks.createdBy",
          select: "id username profilePhoto", // Make sure id is selected
        });

        const savedLink = savedNeighborhood.inviteLinks.id(link._id);

        if (!savedLink) {
          throw new Error("Failed to retrieve created invite link");
        }

        // Ensure all fields are properly formatted
        const result = {
          id: savedLink._id.toString(),
          code: savedLink.code,
          name: savedLink.name,
          maxUses: savedLink.maxUses || 0,
          uses: savedLink.uses || 0,
          expiresAt: savedLink.expiresAt
            ? savedLink.expiresAt.toISOString()
            : null,
          role: savedLink.role || "member",
          isActive: savedLink.isActive !== false,
          url: `${process.env.APP_URL || "http://bubblebased.com"}/join/${
            savedLink.code
          }`,
          createdAt: savedLink.createdAt
            ? savedLink.createdAt.toISOString()
            : new Date().toISOString(),
          createdBy: savedLink.createdBy
            ? {
                id: savedLink.createdBy._id.toString(), // ✅ Ensure id is string
                username: savedLink.createdBy.username,
                profilePhoto: savedLink.createdBy.profilePhoto,
              }
            : {
                id: context.user.userId,
                username: "Unknown",
                profilePhoto: null,
              },
        };

        console.log("✅ Returning result with createdBy:", result.createdBy);
        return result;
      } catch (error) {
        console.error("❌ Error in createInviteLink:", error);
        throw new Error(`Failed to create invite link: ${error.message}`);
      }
    },

    // Update an invite link
    updateInviteLink: async (
      _,
      { linkId, name, maxUses, expiresAt, isActive },
      context,
    ) => {
      if (!context.user) throw new Error("Authentication required");

      const neighborhood = await Neighborhood.findOne({
        "inviteLinks._id": linkId,
      });

      if (!neighborhood) throw new Error("Invite link not found");

      // Check if user has permission
      const userRole = neighborhood.members.find(
        (member) => member.user.toString() === context.user.userId,
      )?.role;

      if (!["owner", "moderator"].includes(userRole)) {
        throw new Error("Only owners and moderators can update invite links");
      }

      const link = neighborhood.inviteLinks.id(linkId);
      if (!link) throw new Error("Invite link not found");

      // Update fields
      if (name !== undefined) link.name = name;
      if (maxUses !== undefined) link.maxUses = maxUses;
      if (expiresAt !== undefined) link.expiresAt = expiresAt;
      if (isActive !== undefined) link.isActive = isActive;

      await neighborhood.save();

      // Populate and return
      const savedNeighborhood = await Neighborhood.findById(
        neighborhood._id,
      ).populate("inviteLinks.createdBy", "username profilePhoto");

      const savedLink = savedNeighborhood.inviteLinks.id(linkId);

      return {
        ...savedLink.toObject(),
        id: savedLink._id.toString(),
        url: `${process.env.APP_URL || "https://bubblebased.com"}/join/${
          savedLink.code
        }`,
      };
    },

    // Delete an invite link
    deleteInviteLink: async (_, { linkId }, context) => {
      if (!context.user) throw new Error("Authentication required");

      const neighborhood = await Neighborhood.findOne({
        "inviteLinks._id": linkId,
      });

      if (!neighborhood) throw new Error("Invite link not found");

      // Check if user has permission
      const userRole = neighborhood.members.find(
        (member) => member.user.toString() === context.user.userId,
      )?.role;

      if (!["owner", "moderator"].includes(userRole)) {
        throw new Error("Only owners and moderators can delete invite links");
      }

      const link = neighborhood.inviteLinks.id(linkId);
      if (!link) throw new Error("Invite link not found");

      link.remove();
      await neighborhood.save();

      return true;
    },

    // Public: Join a neighborhood via invite link (user must be authenticated)
    joinViaInviteLink: async (_, { code }, context) => {
      if (!context.user) {
        return {
          success: false,
          message:
            "Authentication required. Please log in or create an account.",
          error: "NOT_AUTHENTICATED",
        };
      }

      const neighborhood = await Neighborhood.findOne({
        "inviteLinks.code": code,
        "inviteLinks.isActive": true,
      }).populate("owner", "username profilePhoto");

      if (!neighborhood) {
        return {
          success: false,
          message: "Invalid invite link",
          error: "INVALID_LINK",
        };
      }

      const link = neighborhood.inviteLinks.find((link) => link.code === code);

      if (!link) {
        return {
          success: false,
          message: "Invalid invite link",
          error: "INVALID_LINK",
        };
      }

      // Check if link is expired
      if (link.expiresAt && link.expiresAt < new Date()) {
        return {
          success: false,
          message: "This invite link has expired",
          error: "LINK_EXPIRED",
        };
      }

      // Check if link has reached max uses
      if (link.maxUses > 0 && link.uses >= link.maxUses) {
        return {
          success: false,
          message: "This invite link has reached its maximum uses",
          error: "MAX_USES_REACHED",
        };
      }

      // Check if user is already a member
      const isAlreadyMember = neighborhood.members.some(
        (member) => member.user.toString() === context.user.userId,
      );

      if (isAlreadyMember) {
        return {
          success: false,
          message: "You are already a member of this neighborhood",
          error: "ALREADY_MEMBER",
          neighborhood: {
            id: neighborhood._id.toString(),
            name: neighborhood.name,
          },
        };
      }

      // Check if neighborhood has reached max members
      if (neighborhood.members.length >= neighborhood.maxMembers) {
        return {
          success: false,
          message: "This neighborhood has reached its maximum member limit",
          error: "NEIGHBORHOOD_FULL",
        };
      }

      // Add user as member with specified role
      neighborhood.members.push({
        user: context.user.userId,
        role: link.role,
        joinedAt: new Date(),
      });

      // Increment link uses
      link.uses += 1;

      // Add to user's join history
      const user = await User.findById(context.user.userId);
      user.joinedViaLink.push({
        neighborhood: neighborhood._id,
        linkCode: code,
        joinedAt: new Date(),
      });

      await Promise.all([neighborhood.save(), user.save()]);

      return {
        success: true,
        message: `Successfully joined ${neighborhood.name}!`,
        neighborhood: await Neighborhood.findById(neighborhood._id)
          .populate("owner", "username profilePhoto")
          .populate("members.user", "username profilePhoto"),
      };
    },

    // Public: Register and join via link in one step
    registerAndJoinViaLink: async (_, { code, username, email, password }) => {
      // First, validate the invite link
      const neighborhood = await Neighborhood.findOne({
        "inviteLinks.code": code,
        "inviteLinks.isActive": true,
      });

      if (!neighborhood) {
        throw new Error("Invalid invite link");
      }

      const link = neighborhood.inviteLinks.find((link) => link.code === code);

      if (!link) {
        throw new Error("Invalid invite link");
      }

      // Check link validity
      if (link.expiresAt && link.expiresAt < new Date()) {
        throw new Error("This invite link has expired");
      }

      if (link.maxUses > 0 && link.uses >= link.maxUses) {
        throw new Error("This invite link has reached its maximum uses");
      }

      // Check if email/username already exists
      const existingUser = await User.findOne({
        $or: [{ email }, { username }],
      });

      if (existingUser) {
        throw new Error("User with this email or username already exists");
      }

      // Create the user
      const user = new User({
        username,
        email,
        password: password,
        profilePhoto: `https://ui-avatars.com/api/?name=${encodeURIComponent(
          username,
        )}&background=00FF00&color=000`,
        affiliateLinks: [],
        videos: [],
        streams: [],
        chats: [],
        posts: [],
        groups: [],
        joinedViaLink: [
          {
            neighborhood: neighborhood._id,
            linkCode: code,
            joinedAt: new Date(),
          },
        ],
      });

      await user.save();

      // Add user to neighborhood
      neighborhood.members.push({
        user: user._id,
        role: link.role,
        joinedAt: new Date(),
      });

      // Increment link uses
      link.uses += 1;

      await neighborhood.save();

      // Generate auth token
      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: "24h",
      });

      return {
        token,
        user,
      };
    },
  },

  Post: {
    commentCount: (parent) => {
      // ✅ Always return a number
      if (parent.comments) {
        return Array.isArray(parent.comments) ? parent.comments.length : 0;
      }
      return 0;
    },
    neighborhood: async (parent) => {
      if (!parent.neighborhood) return null;
      return await Neighborhood.findById(parent.neighborhood);
    },
    author: async (parent) => {
      if (!parent.author) return null;
      return await User.findById(parent.author);
    },
  },

  Neighborhood: {
    // Add a computed field for memberCount
    memberCount: (parent) => {
      // If parent is a neighborhood from database
      if (parent.members) {
        return parent.members.length;
      }
      // If it's the transformed object from validateInviteLink
      if (parent.memberCount !== undefined) {
        return parent.memberCount;
      }
      return 0;
    },
  },

  Subscription: {
    livestreamChunkAdded: {
      subscribe: (_, { sessionId }, { pubsub }) => {
        // Logic check: ensure we are listening to the same ID format used in app.post
        console.log("📡 Subscribing to session:", sessionId);
        return pubsub.asyncIterableIterator([
          `LIVESTREAM_CHUNK_ADDED_${sessionId}`,
        ]);
      },
    },
  },
  // Field resolvers// In resolvers.js - Update the InviteLink field resolver
  InviteLink: {
    url: (parent) => {
      return `${process.env.APP_URL || "https://bubblebased.com"}/join/${
        parent.code
      }`;
    },
    createdBy: async (parent) => {
      // If already populated, return it
      if (parent.createdBy && parent.createdBy.id) {
        return parent.createdBy;
      }

      // If we have just the ID, fetch the user
      if (parent.createdBy) {
        const user = await User.findById(parent.createdBy).select(
          "id username profilePhoto",
        );
        return {
          id: user._id.toString(),
          username: user.username,
          profilePhoto: user.profilePhoto,
        };
      }

      // Fallback
      return {
        id: "unknown",
        username: "Unknown",
        profilePhoto: null,
      };
    },
  },

  // In your GraphQL Resolvers file
  // Backend: resolvers.js
  Stream: {
    // This function will fix the "header: null" issue by hunting the Message collection
    header: async (parent) => {
      const Message = mongoose.model("Message");
      // Look for the message with the same sessionId that acts as the header
      return await Message.findOne({
        sessionId: parent.sessionId,
        content: "STREAM_HEADER", // or check for the one that has the thumbnail
      }).lean();
    },

    // This gives you a direct shortcut to the thumbnail
    thumbnailUrl: async (parent) => {
      const Message = mongoose.model("Message");
      const msg = await Message.findOne({
        sessionId: parent.sessionId,
        thumbnailUrl: { $ne: null },
      })
        .select("thumbnailUrl")
        .lean();

      return msg?.thumbnailUrl || null;
    },
  },
};

export default resolvers;
