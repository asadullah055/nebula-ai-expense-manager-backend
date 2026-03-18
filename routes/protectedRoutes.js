import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { getDashboardData, markNotificationsAsRead } from "../controllers/protectedController.js";

const router = express.Router();

router.get("/dashboard", authMiddleware, getDashboardData);
router.patch("/notifications/read", authMiddleware, markNotificationsAsRead);

export default router;
