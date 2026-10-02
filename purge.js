// scripts/purgeOrphans.js
import mongoose from "mongoose";
import Neighborhood from "../minnowbe/structure/models/Neighborhood.js";
import User from "../minnowbe/structure/models/User.js";
import Post from "../minnobe/structure/models/Post.js";
import Message from "../minnowbe/structure/models/Message.js";
import dotenv from "dotenv";

dotenv.config();

async function purge() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected");

  const validUsers = await User.distinct("_id");
  const validSet = new Set(validUsers.map((id) => id.toString()));
  console.log(`${validUsers.length} valid users`);

  const hoods = await Neighborhood.find({});
  console.log(`${hoods.length} neighborhoods`);

  let deleted = 0;
  let fixed = 0;

  for (const hood of hoods) {
    // Filter orphaned members
    const cleanedMembers = hood.members.filter((m) => {
      if (!m.user) return false;
      return validSet.has(m.user.toString());
    });

    const ownerIsValid = hood.owner && validSet.has(hood.owner.toString());

    // If no valid members AND no valid owner → delete
    if (!ownerIsValid && cleanedMembers.length === 0) {
      console.log(`🗑️ Deleting empty neighborhood: ${hood.name}`);
      await Neighborhood.deleteOne({ _id: hood._id });
      deleted++;
      continue;
    }

    // If owner is orphaned but members remain → reassign
    if (!ownerIsValid && cleanedMembers.length > 0) {
      const newOwner = cleanedMembers[0].user;
      hood.owner = newOwner;
      cleanedMembers[0].role = "owner";
      hood.members = cleanedMembers;
      await hood.save();
      console.log(`✅ Reassigned owner of ${hood.name}`);
      fixed++;
      continue;
    }

    // Otherwise just clean members
    if (cleanedMembers.length !== hood.members.length) {
      hood.members = cleanedMembers;
      await hood.save();
      console.log(`✅ Cleaned members of ${hood.name}`);
      fixed++;
    }
  }

  console.log(`\nDeleted: ${deleted}`);
  console.log(`Fixed: ${fixed}`);

  await mongoose.disconnect();
}

purge().catch((err) => {
  console.error(err);
  process.exit(1);
});
