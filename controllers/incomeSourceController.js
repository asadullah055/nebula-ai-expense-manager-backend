import { validationResult } from "express-validator";
import IncomeSource from "../models/IncomeSource.js";

export const listIncomeSources = async (req, res) => {
  const profile = (req.query.profile || "").trim();
  const type = (req.query.type || "").trim();

  try {
    const filter = { userId: req.userId };
    if (profile) filter.profile = profile;
    if (type) filter.type = type;

    const incomeSources = await IncomeSource.find(filter)
      .sort({ createdAt: -1 })
      .select("_id name type profile createdAt");

    return res.status(200).json({ incomeSources });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load income sources", error: error.message });
  }
};

export const createIncomeSource = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const name = req.body.name.trim();
  const profile = req.body.profile.trim();
  const type = req.body.type;
  const normalizedName = name.toLowerCase();
  const normalizedProfile = profile.toLowerCase();

  try {
    const existing = await IncomeSource.findOne({ userId: req.userId, normalizedName, normalizedProfile, type });
    if (existing) {
      return res.status(409).json({ message: "Income source already exists for this profile and type" });
    }

    const incomeSource = await IncomeSource.create({
      userId: req.userId,
      type,
      name,
      profile,
      normalizedProfile,
      normalizedName
    });

    return res.status(201).json({
      message: "Income source created",
      incomeSource: {
        id: incomeSource._id,
        name: incomeSource.name,
        type: incomeSource.type,
        profile: incomeSource.profile,
        createdAt: incomeSource.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create income source", error: error.message });
  }
};
