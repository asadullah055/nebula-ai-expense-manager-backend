import { validationResult } from "express-validator";
import fs from "fs/promises";
import formidable from "formidable";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";
import ExpenseEntry from "../models/ExpenseEntry.js";
import IncomeEntry from "../models/IncomeEntry.js";
import Workspace from "../models/Workspace.js";

const normalizeValue = (value) => (Array.isArray(value) ? value[0] : value);

const parseMultipartForm = (req) =>
  new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      keepExtensions: true,
      maxFiles: 1,
      maxFileSize: 5 * 1024 * 1024
    });

    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ fields, files });
    });
  });

const cleanTempFile = async (file) => {
  if (!file?.filepath) return;
  try {
    await fs.unlink(file.filepath);
  } catch (_error) {
    // Ignore cleanup errors.
  }
};

const resolveSingleFile = (fileEntry) => {
  if (!fileEntry) return null;
  if (Array.isArray(fileEntry)) return fileEntry[0] || null;
  return fileEntry;
};

export const listWorkspaces = async (req, res) => {
  try {
    const workspaces = await Workspace.find({ userId: req.userId })
      .sort({ createdAt: 1 })
      .select(
        "_id name profileName avatar companyDescription monthlyExpenseLimitPersonal monthlyExpenseLimitCompany createdAt"
      );

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
      normalizedName,
      profileName: name,
      companyDescription: ""
    });

    return res.status(201).json({
      message: "Workspace created",
      workspace: {
        id: workspace._id,
        name: workspace.name,
        profileName: workspace.profileName || workspace.name,
        avatar: workspace.avatar || null,
        companyDescription: workspace.companyDescription || "",
        monthlyExpenseLimitPersonal: Number(workspace.monthlyExpenseLimitPersonal || 0),
        monthlyExpenseLimitCompany: Number(workspace.monthlyExpenseLimitCompany || 0),
        createdAt: workspace.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create workspace", error: error.message });
  }
};

export const getWorkspaceProfile = async (req, res) => {
  const workspaceId = (req.query.workspaceId || "").trim();
  const profileRaw = (req.query.profile || "").trim();
  const profile = profileRaw === "Personal" ? "Personal" : "Company";

  try {
    if (!workspaceId) {
      return res.status(400).json({ message: "workspaceId is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ message: "workspaceId is invalid" });
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, userId: req.userId }).select(
      "_id name profileName avatar companyDescription monthlyExpenseLimitPersonal monthlyExpenseLimitCompany"
    );

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    return res.status(200).json({
      workspace: {
        id: workspace._id,
        name: workspace.name,
        profileName: workspace.profileName || workspace.name,
        avatar: workspace.avatar || null,
        companyDescription: workspace.companyDescription || "",
        profile,
        monthlyExpenseLimit:
          profile === "Personal"
            ? Number(workspace.monthlyExpenseLimitPersonal || 0)
            : Number(workspace.monthlyExpenseLimitCompany || 0),
        monthlyExpenseLimitPersonal: Number(workspace.monthlyExpenseLimitPersonal || 0),
        monthlyExpenseLimitCompany: Number(workspace.monthlyExpenseLimitCompany || 0)
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load workspace profile", error: error.message });
  }
};

export const updateWorkspaceProfile = async (req, res) => {
  let avatarFile = null;

  try {
    const { fields, files } = await parseMultipartForm(req);
    const workspaceId = String(normalizeValue(fields.workspaceId) || "").trim();
    const profileNameRaw = String(normalizeValue(fields.profileName) || "").trim();
    const companyDescriptionRaw = String(normalizeValue(fields.companyDescription) || "").trim();
    const profileRaw = String(normalizeValue(fields.profile) || "").trim();
    const profile = profileRaw === "Personal" ? "Personal" : "Company";
    const monthlyExpenseLimitField = normalizeValue(fields.monthlyExpenseLimit);
    const monthlyExpenseLimitRaw =
      monthlyExpenseLimitField === undefined || monthlyExpenseLimitField === null
        ? null
        : String(monthlyExpenseLimitField).trim();
    const shouldUpdateMonthlyExpenseLimit = monthlyExpenseLimitRaw !== null;
    const monthlyExpenseLimitValue = shouldUpdateMonthlyExpenseLimit
      ? monthlyExpenseLimitRaw === ""
        ? 0
        : Number(monthlyExpenseLimitRaw)
      : null;
    avatarFile = resolveSingleFile(files.avatar);

    if (!workspaceId) {
      return res.status(400).json({ message: "workspaceId is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ message: "workspaceId is invalid" });
    }

    if (profileNameRaw.length < 2 || profileNameRaw.length > 80) {
      return res.status(400).json({ message: "Name must be between 2 and 80 characters" });
    }

    if (companyDescriptionRaw.length > 500) {
      return res.status(400).json({ message: "Company description must be at most 500 characters" });
    }
    if (
      shouldUpdateMonthlyExpenseLimit &&
      (!Number.isFinite(monthlyExpenseLimitValue) || monthlyExpenseLimitValue < 0)
    ) {
      return res.status(400).json({ message: "Monthly expense limit must be a valid positive amount" });
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, userId: req.userId });
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const normalizedName = profileNameRaw.toLowerCase();
    const duplicateWorkspace = await Workspace.findOne({
      userId: req.userId,
      normalizedName,
      _id: { $ne: workspace._id }
    }).select("_id");

    if (duplicateWorkspace) {
      return res.status(409).json({ message: "Workspace name already exists" });
    }

    const previousWorkspaceName = workspace.name;
    workspace.name = profileNameRaw;
    workspace.normalizedName = normalizedName;
    workspace.profileName = profileNameRaw;
    workspace.companyDescription = companyDescriptionRaw;
    if (shouldUpdateMonthlyExpenseLimit) {
      if (profile === "Personal") {
        workspace.monthlyExpenseLimitPersonal = monthlyExpenseLimitValue;
      } else {
        workspace.monthlyExpenseLimitCompany = monthlyExpenseLimitValue;
      }
    }

    if (avatarFile?.filepath) {
      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ message: "Cloudinary is not configured" });
      }

      const uploadResult = await cloudinary.uploader.upload(avatarFile.filepath, {
        folder: "nebula/workspace-profiles",
        resource_type: "image"
      });

      if (workspace.avatarPublicId) {
        await cloudinary.uploader.destroy(workspace.avatarPublicId, { resource_type: "image" });
      }

      workspace.avatar = uploadResult.secure_url;
      workspace.avatarPublicId = uploadResult.public_id;
    }

    await workspace.save();

    if (previousWorkspaceName !== workspace.name) {
      await Promise.all([
        IncomeEntry.updateMany(
          { userId: req.userId, workspaceId: workspace._id },
          { $set: { workspaceName: workspace.name } }
        ),
        ExpenseEntry.updateMany(
          { userId: req.userId, workspaceId: workspace._id },
          { $set: { workspaceName: workspace.name } }
        )
      ]);
    }

    return res.status(200).json({
      message: "Workspace profile updated",
      workspace: {
        id: workspace._id,
        name: workspace.name,
        profileName: workspace.profileName || workspace.name,
        avatar: workspace.avatar || null,
        companyDescription: workspace.companyDescription || "",
        profile,
        monthlyExpenseLimit:
          profile === "Personal"
            ? Number(workspace.monthlyExpenseLimitPersonal || 0)
            : Number(workspace.monthlyExpenseLimitCompany || 0),
        monthlyExpenseLimitPersonal: Number(workspace.monthlyExpenseLimitPersonal || 0),
        monthlyExpenseLimitCompany: Number(workspace.monthlyExpenseLimitCompany || 0)
      }
    });
  } catch (error) {
    if (error?.code === 1009 || String(error?.message || "").toLowerCase().includes("maxfilesize")) {
      return res.status(413).json({ message: "Image size must be under 5MB" });
    }
    return res.status(500).json({ message: "Failed to update workspace profile", error: error.message });
  } finally {
    await cleanTempFile(avatarFile);
  }
};
