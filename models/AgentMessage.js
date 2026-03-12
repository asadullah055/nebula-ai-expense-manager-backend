import mongoose from "mongoose";

const agentMessageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },
    channel: {
      type: String,
      enum: ["ui", "telegram"],
      required: true
    },
    channelUserId: {
      type: String,
      default: null,
      index: true
    },
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true
    },
    text: {
      type: String,
      default: ""
    },
    voiceFileId: {
      type: String,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

const AgentMessage = mongoose.model("AgentMessage", agentMessageSchema);

export default AgentMessage;
