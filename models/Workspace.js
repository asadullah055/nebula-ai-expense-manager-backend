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
    }
  },
  { timestamps: true }
);

workspaceSchema.index({ userId: 1, normalizedName: 1 }, { unique: true });

const Workspace = mongoose.model("Workspace", workspaceSchema);

export default Workspace;

