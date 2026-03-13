import { validationResult } from "express-validator";
import ExpenseCategory from "../models/ExpenseCategory.js";

export const listExpenseCategories = async (req, res) => {
  const profile = (req.query.profile || "").trim();
  const type = (req.query.type || "").trim();

  try {
    const filter = { userId: req.userId };
    if (profile) filter.profile = profile;
    if (type) filter.type = type;

    const expenseCategories = await ExpenseCategory.find(filter)
      .sort({ createdAt: -1 })
      .select("_id name type profile createdAt");

    return res.status(200).json({ expenseCategories });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load expense categories", error: error.message });
  }
};

export const createExpenseCategory = async (req, res) => {
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
    const existing = await ExpenseCategory.findOne({ userId: req.userId, normalizedName, normalizedProfile, type });
    if (existing) {
      return res.status(409).json({ message: "Expense category already exists for this profile and type" });
    }

    const expenseCategory = await ExpenseCategory.create({
      userId: req.userId,
      type,
      name,
      profile,
      normalizedProfile,
      normalizedName
    });

    return res.status(201).json({
      message: "Expense category created",
      expenseCategory: {
        id: expenseCategory._id,
        name: expenseCategory.name,
        type: expenseCategory.type,
        profile: expenseCategory.profile,
        createdAt: expenseCategory.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create expense category", error: error.message });
  }
};
