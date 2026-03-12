import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { agentCommandValidators, runAgentCommand } from "../controllers/agentController.js";

const router = express.Router();

router.post("/command", authMiddleware, agentCommandValidators, runAgentCommand);

export default router;

