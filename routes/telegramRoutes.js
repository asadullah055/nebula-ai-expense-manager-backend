import express from "express";
import { telegramWebhook } from "../controllers/telegramController.js";

const router = express.Router();

const verifyTelegramSecret = (req, res, next) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return next();

  const providedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (providedSecret !== expectedSecret) {
    return res.status(401).json({ message: "Invalid telegram webhook secret" });
  }

  return next();
};

const proxyTelegramWebhookToN8n = async (req, res, next) => {
  const mode = (process.env.TELEGRAM_WEBHOOK_MODE || "app").trim().toLowerCase();
  if (mode !== "n8n") return next();

  const n8nWebhookUrl = (process.env.N8N_TELEGRAM_WEBHOOK_URL || "").trim();
  if (!n8nWebhookUrl) {
    return res.status(500).json({
      message: "N8N_TELEGRAM_WEBHOOK_URL is required when TELEGRAM_WEBHOOK_MODE is n8n"
    });
  }

  try {
    const proxySecret = (process.env.N8N_TELEGRAM_WEBHOOK_SECRET || "").trim();
    const incomingSecret = req.headers["x-telegram-bot-api-secret-token"];
    const headers = { "Content-Type": "application/json" };
    if (proxySecret || incomingSecret) {
      headers["x-telegram-bot-api-secret-token"] = proxySecret || incomingSecret;
    }

    const response = await fetch(n8nWebhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body || {})
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("n8n proxy error:", response.status, errorBody);
    }
  } catch (error) {
    console.error("Failed to proxy Telegram webhook to n8n:", error?.message || error);
  }

  return res.status(200).json({ ok: true, proxied: true });
};

router.post("/webhook", verifyTelegramSecret, proxyTelegramWebhookToN8n, telegramWebhook);

export default router;
