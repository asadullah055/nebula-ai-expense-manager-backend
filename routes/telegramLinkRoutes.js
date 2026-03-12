import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  createTelegramLinkCode,
  getTelegramLinkStatus,
  unlinkTelegram
} from "../controllers/telegramLinkController.js";

const router = express.Router();

router.get("/status", authMiddleware, getTelegramLinkStatus);
router.post("/code", authMiddleware, createTelegramLinkCode);
router.post("/unlink", authMiddleware, unlinkTelegram);

export default router;
