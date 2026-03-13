import ExpenseEntry from "../models/ExpenseEntry.js";
import IncomeEntry from "../models/IncomeEntry.js";
import { ensureRecurringEntriesForScope } from "./incomeEntryController.js";

const startOfUtcDay = (dateValue) => {
  const date = new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const addUtcDays = (dateValue, days) => {
  const start = startOfUtcDay(dateValue);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + days));
};

const groupByLabel = (rows, labelKey, valueKey) => {
  const grouped = rows.reduce((acc, row) => {
    const label = row[labelKey] || "Uncategorized";
    acc[label] = (acc[label] || 0) + Number(row[valueKey] || 0);
    return acc;
  }, {});

  return Object.entries(grouped)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
};

export const getDashboardData = async (req, res) => {
  const workspaceName = (req.query.workspace || "").trim();
  const profile = (req.query.profile || "").trim();

  try {
    await ensureRecurringEntriesForScope({
      userId: req.userId,
      workspaceName: workspaceName || undefined,
      profile: profile || undefined
    });

    const filter = { userId: req.userId };
    if (workspaceName) filter.workspaceName = workspaceName;
    if (profile) filter.profile = profile;

    const [incomeRowsRaw, expenseRowsRaw] = await Promise.all([
      IncomeEntry.find(filter)
        .sort({ entryDate: -1, createdAt: -1 })
        .select("_id incomeSourceName incomeNature amount profile workspaceName entryDate createdAt")
        .lean(),
      ExpenseEntry.find(filter)
        .sort({ entryDate: -1, createdAt: -1 })
        .select("_id category expenseType amount profile workspaceName entryDate createdAt")
        .lean()
    ]);

    const incomeRows = incomeRowsRaw.map((item) => ({
      ...item,
      amount: Number(item.amount || 0),
      dateObj: new Date(item.entryDate)
    }));
    const expenseRows = expenseRowsRaw.map((item) => ({
      ...item,
      amount: Number(item.amount || 0),
      dateObj: new Date(item.entryDate)
    }));

    const now = new Date();
    const income60Start = addUtcDays(now, -60);
    const expense30Start = addUtcDays(now, -30);

    const incomeLast60 = incomeRows.filter((item) => item.dateObj.getTime() >= income60Start.getTime());
    const expenseLast30 = expenseRows.filter((item) => item.dateObj.getTime() >= expense30Start.getTime());

    const totalIncome = incomeRows.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenses = expenseRows.reduce((sum, item) => sum + item.amount, 0);
    const totalBalance = totalIncome - totalExpenses;

    const recentTransactions = [
      ...incomeRows.map((item) => ({
        id: `income-${item._id}`,
        type: "income",
        name: item.incomeSourceName,
        amount: item.amount,
        date: item.entryDate,
        profile: item.profile,
        workspaceName: item.workspaceName
      })),
      ...expenseRows.map((item) => ({
        id: `expense-${item._id}`,
        type: "expense",
        name: item.category,
        amount: item.amount,
        date: item.entryDate,
        profile: item.profile,
        workspaceName: item.workspaceName
      }))
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10);

    return res.status(200).json({
      summary: {
        totalIncome,
        totalExpenses,
        totalBalance
      },
      income: {
        last60Total: incomeLast60.reduce((sum, item) => sum + item.amount, 0),
        byCategory: groupByLabel(incomeLast60, "incomeSourceName", "amount"),
        recent: incomeLast60
          .sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime())
          .slice(0, 8)
          .map((item) => ({
            id: item._id,
            name: item.incomeSourceName,
            amount: item.amount,
            nature: item.incomeNature,
            profile: item.profile,
            workspaceName: item.workspaceName,
            date: item.entryDate
          }))
      },
      expense: {
        last30Total: expenseLast30.reduce((sum, item) => sum + item.amount, 0),
        byCategory: groupByLabel(expenseLast30, "category", "amount"),
        recent: expenseLast30
          .sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime())
          .slice(0, 8)
          .map((item) => ({
            id: item._id,
            name: item.category,
            expenseType: item.expenseType,
            amount: item.amount,
            profile: item.profile,
            workspaceName: item.workspaceName,
            date: item.entryDate
          }))
      },
      recentTransactions,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load dashboard data", error: error.message });
  }
};
