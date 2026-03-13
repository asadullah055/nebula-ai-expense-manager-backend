import crypto from "crypto";
import TelegramLink from "../models/TelegramLink.js";

const buildLinkCode = () => {
  const raw = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `ET-${raw}`;
};

export const createTelegramLinkCode = async (req, res) => {
  try {
    const code = buildLinkCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const updated = await TelegramLink.findOneAndUpdate(
      { userId: req.userId },
      { linkCode: code, linkCodeExpiresAt: expiresAt },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || "";
    const deepLink = botUsername
      ? `https://t.me/${botUsername}?start=link_${encodeURIComponent(updated.linkCode)}`
      : "";

    return res.status(200).json({
      code: updated.linkCode,
      expiresAt: updated.linkCodeExpiresAt,
      botUsername,
      deepLink,
      instruction: `Open your Telegram bot and send: /link ${updated.linkCode}`
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create telegram link code", error: error.message });
  }
};

export const getTelegramLinkStatus = async (req, res) => {
  try {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || "";
    const link = await TelegramLink.findOne({ userId: req.userId });

    if (!link) {
      return res.status(200).json({
        linked: false,
        chatId: null,
        activeWorkspaceName: null,
        activeProfile: null,
        pendingCode: null,
        pendingCodeExpiresAt: null,
        botUsername,
        deepLink: ""
      });
    }

    const deepLink =
      link.linkCode && botUsername
        ? `https://t.me/${botUsername}?start=link_${encodeURIComponent(link.linkCode)}`
        : "";

    return res.status(200).json({
      linked: Boolean(link.chatId),
      chatId: link.chatId,
      linkedAt: link.linkedAt,
      activeWorkspaceName: link.activeWorkspaceName || null,
      activeProfile: link.activeProfile || null,
      pendingCode: link.linkCode,
      pendingCodeExpiresAt: link.linkCodeExpiresAt,
      botUsername,
      deepLink
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load telegram link status", error: error.message });
  }
};

export const unlinkTelegram = async (req, res) => {
  try {
    const link = await TelegramLink.findOne({ userId: req.userId });
    if (!link) {
      return res.status(200).json({ message: "Telegram link not found" });
    }

    link.chatId = null;
    link.linkedAt = null;
    link.activeWorkspaceName = null;
    link.activeProfile = null;
    link.pendingWorkspaceSwitch = false;
    await link.save();

    return res.status(200).json({ message: "Telegram unlinked successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to unlink telegram", error: error.message });
  }
};
