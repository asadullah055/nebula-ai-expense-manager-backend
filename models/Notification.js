import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      default: null,
      index: true
    },
    workspaceName: {
      type: String,
      required: true,
      trim: true
    },
    profile: {
      type: String,
      enum: ["Personal", "Company"],
      required: true
    },
    origin: {
      type: String,
      enum: ["auto"],
      default: "auto",
      index: true
    },
    dedupeKey: {
      type: String,
      required: true,
      trim: true
    },
    source: {
      type: String,
      enum: ["recurring", "task"],
      required: true
    },
    type: {
      type: String,
      enum: ["income", "expense", "task"],
      required: true
    },
    taskType: {
      type: String,
      trim: true,
      default: ""
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240
    },
    amount: {
      type: Number,
      default: 0
    },
    dueDate: {
      type: Date,
      required: true,
      index: true
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;

