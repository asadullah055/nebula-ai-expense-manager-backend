import mongoose from "mongoose";

const workspaceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    normalizedName: {
      type: String,
      required: true
    },
    profileName: {
      type: String,
      trim: true,
      minlength: 2,
      maxlength: 80,
      default: ""
    },
    avatar: {
      type: String,
      default: null
    },
    avatarPublicId: {
      type: String,
      default: null
    },
    companyDescription: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    }
  },
  { timestamps: true }
);

workspaceSchema.index({ userId: 1, normalizedName: 1 }, { unique: true });

const Workspace = mongoose.model("Workspace", workspaceSchema);

export default Workspace;
