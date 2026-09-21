import mongoose from "mongoose";
import bcrypt from "bcrypt";
const { Schema } = mongoose;

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      match: [/.+@.+\..+/, "Must match an email address!"],
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    bio: {
      type: String,
      default: "",
      maxlength: 500,
    },
    password: {
      type: String,
      required: true,
      minlength: 5,
    },
    profilePhoto: {
      type: String,
      default: function () {
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(
          this.username,
        )}&background=00FF00&color=000`;
      },
    },
    affiliateLinks: [
      {
        url: String,
        title: String,
        description: String,
        imageUrl: String,
        clicks: { type: Number, default: 0 },
      },
    ],
    joinedViaLink: {
      type: [
        {
          neighborhood: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Neighborhood",
          },
          linkCode: String,
          joinedAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    // 🔑 CRITICAL FIX: Add serialization options for GraphQL compatibility
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        // Ensure the root ID is a string
        ret.id = ret._id.toString();
        // Clean up internal fields
        delete ret._id;
        delete ret.__v;
        return ret; // Return the cleaned object
      },
    },
    toObject: { virtuals: true },
  },
);

// Pre-save middleware to hash password (This is correct)
userSchema.pre("save", async function (next) {
  if (this.isNew || this.isModified("password")) {
    const saltRounds = 10;
    this.password = await bcrypt.hash(this.password, saltRounds);
  }
  next();
});

// Password comparison method (This is correct)
userSchema.methods.isCorrectPassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

const User = mongoose.model("User", userSchema);
export default User;
