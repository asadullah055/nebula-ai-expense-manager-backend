import express from "express";
import { telegramWebhook } from "../controllers/telegramController.js";

const router = express.Router();

router.post("/webhook", (req, res, next) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return next();

  const providedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (providedSecret !== expectedSecret) {
    return res.status(401).json({ message: "Invalid telegram webhook secret" });
  }

  return next();
}, telegramWebhook);

export default router;
