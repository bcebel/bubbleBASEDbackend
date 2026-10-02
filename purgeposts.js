// scripts/purgePosts.js
import mongoose from "mongoose";
import Post from "../minnowbe/structure/models/Post.js";
import Message from "../minnowbe/structure/models/Message.js";
import User from "../minnowbe/structure/models/User.js";
import dotenv from "dotenv";

dotenv.config();

async function purge() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected");

  // 1. Build the set of valid user IDs
  const validUsers = await User.distinct("_id");
  const validSet = new Set(validUsers.map((id) => id.toString()));
  console.log(`${validUsers.length} valid users`);

  // 2. Fix Post authors
  const posts = await Post.find({});
  console.log(`${posts.length} posts`);

  let postFixes = 0;
  for (const post of posts) {
    if (post.author && !validSet.has(post.author.toString())) {
      post.author = null;
      await post.save();
      postFixes++;
    }
  }
  console.log(`Fixed ${postFixes} posts`);

  // 3. Fix Message senders
  const messages = await Message.find({});
  console.log(`${messages.length} messages`);

  let msgFixes = 0;
  for (const msg of messages) {
    if (msg.sender && !validSet.has(msg.sender.toString())) {
      msg.sender = null;
      await msg.save();
      msgFixes++;
    }
  }
  console.log(`Fixed ${msgFixes} messages`);

  await mongoose.disconnect();
  console.log("Disconnected");
}

purge().catch((err) => {
  console.error(err);
  process.exit(1);
});
