import { validationResult } from "express-validator";
import Workspace from "../models/Workspace.js";

export const listWorkspaces = async (req, res) => {
  try {
    const workspaces = await Workspace.find({ userId: req.userId })
      .sort({ createdAt: 1 })
      .select("_id name createdAt");

    return res.status(200).json({ workspaces });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load workspaces", error: error.message });
  }
};

export const createWorkspace = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const name = req.body.name.trim();
  const normalizedName = name.toLowerCase();

  try {
    const existing = await Workspace.findOne({ userId: req.userId, normalizedName });
    if (existing) {
      return res.status(409).json({ message: "Workspace already exists" });
    }

    const workspace = await Workspace.create({
      userId: req.userId,
      name,
      normalizedName
    });

    return res.status(201).json({
      message: "Workspace created",
      workspace: { id: workspace._id, name: workspace.name, createdAt: workspace.createdAt }
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create workspace", error: error.message });
  }
};

