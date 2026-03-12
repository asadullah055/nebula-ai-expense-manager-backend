import mongoose from "mongoose";

const telegramLinkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true
    },
    chatId: {
      type: String,
      default: null,
      unique: true,
      sparse: true
    },
    linkCode: {
      type: String,
      default: null,
      unique: true,
      sparse: true
    },
    linkCodeExpiresAt: {
      type: Date,
      default: null
    },
    linkedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

const TelegramLink = mongoose.model("TelegramLink", telegramLinkSchema);

export default TelegramLink;
