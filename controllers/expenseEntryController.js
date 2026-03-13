import { validationResult } from "express-validator";
import ExpenseCategory from "../models/ExpenseCategory.js";
import ExpenseEntry from "../models/ExpenseEntry.js";

const toMonthKey = (dateValue) => {
  const date = new Date(dateValue);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

export const listExpenseEntries = async (req, res) => {
  const workspaceName = (req.query.workspace || "").trim();
  const profile = (req.query.profile || "").trim();

  try {
    const filter = { userId: req.userId };
    if (workspaceName) filter.workspaceName = workspaceName;
    if (profile) filter.profile = profile;

    const entries = await ExpenseEntry.find(filter)
      .sort({ entryDate: -1, createdAt: -1 })
      .select("_id category expenseType amount profile workspaceName entryDate createdAt");

    const total = entries.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return res.status(200).json({ entries, summary: { total, count: entries.length } });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load expenses", error: error.message });
  }
};

export const createExpenseEntry = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const workspaceName = req.body.workspaceName.trim();
  const profile = req.body.profile;
  const expenseCategoryId = req.body.expenseCategoryId;
  const expenseType = req.body.expenseType;
  const amount = Number(req.body.amount);
  const entryDate = new Date(req.body.entryDate);
  const monthKey = toMonthKey(entryDate);

  try {
    const categoryDoc = await ExpenseCategory.findOne({
      _id: expenseCategoryId,
      userId: req.userId,
      profile
    }).select("_id name type");

    if (!categoryDoc) {
      return res.status(404).json({ message: "Expense category not found for selected profile" });
    }

    if (categoryDoc.type !== expenseType) {
      return res.status(400).json({ message: "Expense type does not match selected category" });
    }

    const category = categoryDoc.name;
    const normalizedCategory = category.toLowerCase();

    let entry = null;
    if (expenseType === "Recurring Expense") {
      entry = await ExpenseEntry.findOneAndUpdate(
        {
          userId: req.userId,
          workspaceName,
          profile,
          expenseCategoryId: categoryDoc._id,
          expenseType: "Recurring Expense",
          monthKey
        },
        {
          $set: {
            category,
            normalizedCategory,
            amount,
            entryDate,
            monthKey
          }
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true
        }
      );
    } else {
      entry = await ExpenseEntry.create({
        userId: req.userId,
        workspaceName,
        profile,
        expenseCategoryId: categoryDoc._id,
        expenseType,
        category,
        normalizedCategory,
        amount,
        entryDate,
        monthKey
      });
    }

    return res.status(201).json({
      message: "Expense added",
      entry: {
        id: entry._id,
        expenseCategoryId: entry.expenseCategoryId,
        expenseType: entry.expenseType,
        category: entry.category,
        amount: entry.amount,
        profile: entry.profile,
        workspaceName: entry.workspaceName,
        entryDate: entry.entryDate
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to add expense", error: error.message });
  }
};
