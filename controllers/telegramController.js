import TelegramLink from "../models/TelegramLink.js";
import { runAgentWorkflow } from "../services/agentWorkflowService.js";

const sendTelegramMessage = async (chatId, text) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !text) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
};

const TELEGRAM_API_BASE = "https://api.telegram.org";

const guessMimeType = (fileName = "") => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "application/octet-stream";
};

const fetchTelegramVoiceFile = async ({ token, fileId }) => {
  const fileInfoResponse = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  if (!fileInfoResponse.ok) {
    throw new Error("Failed to fetch Telegram file metadata");
  }

  const fileInfo = await fileInfoResponse.json();
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) {
    throw new Error("Telegram file path is missing");
  }

  const fileName = filePath.split("/").pop() || "voice.ogg";
  const fileResponse = await fetch(`${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`);
  if (!fileResponse.ok) {
    throw new Error("Failed to download Telegram voice file");
  }

  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  return {
    buffer,
    fileName,
    mimeType: guessMimeType(fileName)
  };
};

const transcribeVoiceWithOpenAI = async ({ buffer, fileName, mimeType }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { text: "", error: "OPENAI_API_KEY is not configured" };
  }

  const model = process.env.OPENAI_STT_MODEL || "whisper-1";
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType || "audio/ogg" });
  form.append("model", model);
  form.append("language", "en");
  form.append("file", blob, fileName || "voice.ogg");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    const bodyText = await response.text();
    return { text: "", error: `STT failed: ${bodyText || "Unknown error"}` };
  }

  const data = await response.json();
  const text = (data?.text || "").trim();
  if (!text) {
    return { text: "", error: "Could not detect speech from voice message" };
  }

  return { text, error: "" };
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
        await sendTelegramMessage(
          chatId,
          "Hey, welcome to Nebula AI Expense Manager.\n" +
            "First, link your app account by sending:\n" +
            "/link <your-code>\n\n" +
            "After linking, you can chat naturally and I will help you with your expense workflow."
        );
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
        await sendTelegramMessage(
          chatId,
          "That link code looks invalid or expired. Please generate a fresh code from app Settings and send it again."
        );
        return res.status(200).json({ ok: true });
      }

      link.chatId = String(chatId);
      link.linkCode = null;
      link.linkCodeExpiresAt = null;
      link.linkedAt = now;
      await link.save();

      await sendTelegramMessage(
        chatId,
        "Perfect, your Telegram is linked now.\nYou can talk to me naturally, for example: 'hello' or 'list companies'."
      );
      return res.status(200).json({ ok: true });
    }

    const telegramLink = await TelegramLink.findOne({ chatId: String(chatId) }).select("userId");
    if (!telegramLink) {
      await sendTelegramMessage(
        chatId,
        "I cannot access your account yet because Telegram is not linked.\nGenerate a code from app Settings, then send: /link <code>"
      );
      return res.status(200).json({ ok: true });
    }

    let inputText = text;
    if (!inputText && voiceFileId) {
      try {
        const voiceFile = await fetchTelegramVoiceFile({
          token: process.env.TELEGRAM_BOT_TOKEN,
          fileId: voiceFileId
        });
        const transcription = await transcribeVoiceWithOpenAI(voiceFile);
        if (transcription.error) {
          await sendTelegramMessage(
            chatId,
            "I received your voice message, but I could not transcribe it right now. Please try again or send text."
          );
          return res.status(200).json({ ok: true });
        }
        inputText = transcription.text;
      } catch (_error) {
        await sendTelegramMessage(
          chatId,
          "I received your voice message, but transcription failed. Please try again or send text."
        );
        return res.status(200).json({ ok: true });
      }
    }

    const result = await runAgentWorkflow({
      channel: "telegram",
      userId: telegramLink.userId,
      channelUserId: `telegram:${chatId}`,
      text: inputText,
      voiceFileId
    });

    await sendTelegramMessage(chatId, result.reply);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Telegram webhook error", error: error.message });
  }
};
