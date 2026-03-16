import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      minlength: 6,
      validate: {
        validator(value) {
          return this.provider === "google" || Boolean(value);
        },
        message: "Password is required for local accounts"
      }
    },
    googleId: {
      type: String,
      default: null
    },
    avatar: {
      type: String,
      default: null
    },
    companyDescription: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },
    provider: {
      type: String,
      enum: ["local", "google"],
      default: "local"
    }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
