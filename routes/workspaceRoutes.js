import express from "express";
import { body } from "express-validator";
import authMiddleware from "../middleware/authMiddleware.js";
import { createWorkspace, listWorkspaces } from "../controllers/workspaceController.js";

const router = express.Router();

router.get("/", authMiddleware, listWorkspaces);
router.post(
  "/",
  authMiddleware,
  [body("name").trim().isLength({ min: 2 }).withMessage("Workspace name must be at least 2 characters")],
  createWorkspace
);

export default router;

