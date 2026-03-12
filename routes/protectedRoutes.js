import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/dashboard", authMiddleware, (req, res) => {
  return res.status(200).json({
    message: "Protected dashboard data",
    userId: req.userId,
    timestamp: new Date().toISOString()
  });
});

export default router;