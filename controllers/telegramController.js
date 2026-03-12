import TelegramLink from "../models/TelegramLink.js";
import { getAgentHelpText, runAgentWorkflow } from "../services/agentWorkflowService.js";

const sendTelegramMessage = async (chatId, text) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !text) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
};

export const telegramWebhook = async (req, res) => {
  try {
    const update = req.body;
    const message = update?.message;
    const chatId = message?.chat?.id;
    const text = (message?.text || "").trim();
    const voiceFileId = message?.voice?.file_id;

    if (!chatId) {
      return res.status(200).json({ ok: true });
    }

    const startMatch = text.match(/^\/start(?:\s+link_([A-Z0-9-]+))?$/i);
    if (startMatch) {
      const deepLinkCode = startMatch[1];
      if (!deepLinkCode) {
        await sendTelegramMessage(chatId, `Welcome. First link your account:\n/link ET-ABC123\n\n${getAgentHelpText()}`);
        return res.status(200).json({ ok: true });
      }
    }

    const linkMatch = text.match(/^\/link\s+([A-Z0-9-]{4,24})$/i);
    const deepLinkMatch = text.match(/^\/start\s+link_([A-Z0-9-]{4,24})$/i);
    const linkCode = (linkMatch?.[1] || deepLinkMatch?.[1] || "").toUpperCase();
    if (linkCode) {
      const now = new Date();
      const link = await TelegramLink.findOne({
        linkCode: linkCode,
        linkCodeExpiresAt: { $gt: now }
      });

      if (!link) {
        await sendTelegramMessage(chatId, "Invalid or expired link code. Generate a new code from Settings in the app.");
        return res.status(200).json({ ok: true });
      }

      link.chatId = String(chatId);
      link.linkCode = null;
      link.linkCodeExpiresAt = null;
      link.linkedAt = now;
      await link.save();

      await sendTelegramMessage(chatId, "Telegram linked successfully. You can now control your data from here. Type 'help'.");
      return res.status(200).json({ ok: true });
    }

    const telegramLink = await TelegramLink.findOne({ chatId: String(chatId) }).select("userId");
    if (!telegramLink) {
      await sendTelegramMessage(
        chatId,
        "Your Telegram is not linked yet. Generate link code from app Settings, then send: /link <code>"
      );
      return res.status(200).json({ ok: true });
    }

    const result = await runAgentWorkflow({
      channel: "telegram",
      userId: telegramLink.userId,
      channelUserId: `telegram:${chatId}`,
      text,
      voiceFileId
    });

    await sendTelegramMessage(chatId, result.reply);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Telegram webhook error", error: error.message });
  }
};
