import { validationResult } from "express-validator";
import ExpenseCategory from "../models/ExpenseCategory.js";
import ExpenseEntry from "../models/ExpenseEntry.js";
import Workspace from "../models/Workspace.js";

const toMonthKey = (dateValue) => {
  const date = new Date(dateValue);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const startOfMonthUTC = (dateValue) => {
  const date = new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
};

const addMonthUTC = (monthStartDate) =>
  new Date(Date.UTC(monthStartDate.getUTCFullYear(), monthStartDate.getUTCMonth() + 1, 1));

const dateWithDayInMonthUTC = (monthStartDate, dayOfMonth) => {
  const year = monthStartDate.getUTCFullYear();
  const month = monthStartDate.getUTCMonth();
  const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(dayOfMonth, 1), maxDay);
  return new Date(Date.UTC(year, month, day));
};

export const ensureRecurringExpenseEntriesForScope = async ({
  userId,
  workspaceId,
  workspaceName,
  profile
}) => {
  const recurringFilter = { userId, expenseType: "Recurring Expense" };
  if (workspaceId && workspaceName) {
    recurringFilter.$or = [
      { workspaceId },
      { workspaceId: null, workspaceName },
      { workspaceId: { $exists: false }, workspaceName }
    ];
  } else if (workspaceId) {
    recurringFilter.workspaceId = workspaceId;
  } else if (workspaceName) {
    recurringFilter.workspaceName = workspaceName;
  }
  if (profile) recurringFilter.profile = profile;

  const recurringEntries = await ExpenseEntry.find(recurringFilter)
    .sort({ entryDate: 1 })
    .select(
      "_id userId workspaceId workspaceName profile expenseCategoryId category normalizedCategory expenseType amount entryDate monthKey"
    )
    .lean();

  if (!recurringEntries.length) return;

  const updateOps = [];
  const grouped = new Map();

  for (const entry of recurringEntries) {
    const monthKey = entry.monthKey || toMonthKey(entry.entryDate);
    if (!entry.monthKey) {
      updateOps.push({
        updateOne: {
          filter: { _id: entry._id },
          update: { $set: { monthKey } }
        }
      });
    }

    const groupKey = `${entry.workspaceId || entry.workspaceName}|${entry.profile}|${entry.expenseCategoryId}`;
    const existing = grouped.get(groupKey) || { entries: [], months: new Set() };
    existing.entries.push({ ...entry, monthKey });
    existing.months.add(monthKey);
    grouped.set(groupKey, existing);
  }

  if (updateOps.length) {
    await ExpenseEntry.bulkWrite(updateOps, { ordered: false });
  }

  const currentMonthStart = startOfMonthUTC(new Date());
  const newEntries = [];

  for (const [, group] of grouped) {
    const sorted = [...group.entries].sort(
      (a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
    );
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    const dayOfMonth = new Date(first.entryDate).getUTCDate();

    let cursor = addMonthUTC(startOfMonthUTC(latest.entryDate));
    while (cursor <= currentMonthStart) {
      const mk = toMonthKey(cursor);
      if (!group.months.has(mk)) {
        newEntries.push({
          userId: latest.userId,
          workspaceId: latest.workspaceId || null,
          workspaceName: latest.workspaceName,
          profile: latest.profile,
          expenseCategoryId: latest.expenseCategoryId,
          expenseType: "Recurring Expense",
          category: latest.category,
          normalizedCategory: latest.normalizedCategory,
          amount: latest.amount,
          entryDate: dateWithDayInMonthUTC(cursor, dayOfMonth),
          monthKey: mk
        });
        group.months.add(mk);
      }
      cursor = addMonthUTC(cursor);
    }
  }

  if (!newEntries.length) return;

  try {
    await ExpenseEntry.insertMany(newEntries, { ordered: false });
  } catch (error) {
    // Ignore duplicate key race conditions.
    if (error?.code !== 11000 && !Array.isArray(error?.writeErrors)) {
      throw error;
    }
  }
};

export const listExpenseEntries = async (req, res) => {
  const workspaceId = (req.query.workspaceId || "").trim();
  const workspaceName = (req.query.workspace || "").trim();
  const profile = (req.query.profile || "").trim();

  try {
    if (!workspaceId && !workspaceName) {
      return res.status(400).json({ message: "workspaceId is required" });
    }

    let workspace = null;
    if (workspaceId) {
      workspace = await Workspace.findOne({ _id: workspaceId, userId: req.userId }).select("_id name");
      if (!workspace) {
        return res.status(404).json({ message: "Workspace not found" });
      }
    }

    await ensureRecurringExpenseEntriesForScope({
      userId: req.userId,
      workspaceId: workspace ? workspace._id.toString() : undefined,
      workspaceName: workspace ? workspace.name : workspaceName || undefined,
      profile: profile || undefined
    });

    const filter = { userId: req.userId };
    if (workspace) {
      filter.$or = [
        { workspaceId: workspace._id },
        { workspaceId: null, workspaceName: workspace.name },
        { workspaceId: { $exists: false }, workspaceName: workspace.name }
      ];
    } else if (workspaceName) {
      filter.workspaceName = workspaceName;
    }
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

  const workspaceId = req.body.workspaceId;
  const profile = req.body.profile;
  const expenseCategoryId = req.body.expenseCategoryId;
  const expenseType = req.body.expenseType;
  const amount = Number(req.body.amount);
  const entryDate = new Date(req.body.entryDate);
  const monthKey = toMonthKey(entryDate);

  try {
    const workspace = await Workspace.findOne({
      _id: workspaceId,
      userId: req.userId
    }).select("_id name");

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const categoryDoc = await ExpenseCategory.findOne({
      _id: expenseCategoryId,
      userId: req.userId,
      workspaceId: workspace._id,
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
          workspaceId: workspace._id,
          workspaceName: workspace.name,
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
        workspaceId: workspace._id,
        workspaceName: workspace.name,
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
