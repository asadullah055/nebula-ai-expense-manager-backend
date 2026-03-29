import ExpenseEntry from "../models/ExpenseEntry.js";
import FinanceTask from "../models/FinanceTask.js";
import IncomeEntry from "../models/IncomeEntry.js";
import Notification from "../models/Notification.js";
import Workspace from "../models/Workspace.js";
import { ensureRecurringExpenseEntriesForScope } from "./expenseEntryController.js";
import { ensureRecurringEntriesForScope } from "./incomeEntryController.js";

const startOfUtcDay = (dateValue) => {
  const date = new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const startOfUtcMonth = (dateValue) => {
  const date = new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
};

const addUtcDays = (dateValue, days) => {
  const start = startOfUtcDay(dateValue);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + days));
};

const addUtcMonths = (dateValue, months) => {
  const date = new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
};

const dateWithDayInMonthUTC = (monthStartDate, dayOfMonth) => {
  const year = monthStartDate.getUTCFullYear();
  const month = monthStartDate.getUTCMonth();
  const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(dayOfMonth, 1), maxDay);
  return new Date(Date.UTC(year, month, day));
};

const getUtcDayDiff = (fromDate, toDate) => {
  const from = startOfUtcDay(fromDate);
  const to = startOfUtcDay(toDate);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
};

const isSameUtcMonth = (dateValue, compareDate) => {
  const date = new Date(dateValue);
  return (
    date.getUTCFullYear() === compareDate.getUTCFullYear() &&
    date.getUTCMonth() === compareDate.getUTCMonth()
  );
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

const applyScopeFilter = ({ workspaceId, workspaceName, profile }) => {
  const filter = {};

  if (workspaceId && workspaceName) {
    filter.$or = [
      { workspaceId },
      { workspaceId: null, workspaceName },
      { workspaceId: { $exists: false }, workspaceName }
    ];
  } else if (workspaceId) {
    filter.workspaceId = workspaceId;
  } else if (workspaceName) {
    filter.workspaceName = workspaceName;
  }

  if (profile) {
    filter.profile = profile;
  }

  return filter;
};

const isMongoObjectId = (value) => /^[a-fA-F0-9]{24}$/.test(String(value || ""));
const parsedNotificationRetentionDays = Number(process.env.NOTIFICATION_RETENTION_DAYS || 30);
const NOTIFICATION_RETENTION_DAYS =
  Number.isFinite(parsedNotificationRetentionDays) && parsedNotificationRetentionDays >= 0
    ? Math.floor(parsedNotificationRetentionDays)
    : 30;

const buildUpcomingRecurringNotifications = ({ incomeRows, expenseRows, now }) => {
  const today = startOfUtcDay(now);
  const currentMonthStart = startOfUtcMonth(today);
  const reminders = [];

  const collectBySeries = (rows, keyBuilder) => {
    const grouped = new Map();
    for (const row of rows) {
      const groupKey = keyBuilder(row);
      const existing = grouped.get(groupKey) || [];
      existing.push(row);
      grouped.set(groupKey, existing);
    }
    return grouped;
  };

  const toUpcomingDate = (anchorDay) => {
    const thisMonthDate = dateWithDayInMonthUTC(currentMonthStart, anchorDay);
    if (thisMonthDate.getTime() >= today.getTime()) return thisMonthDate;
    return dateWithDayInMonthUTC(addUtcMonths(currentMonthStart, 1), anchorDay);
  };

  const recurringIncomeRows = incomeRows.filter((item) => item.incomeNature === "Recurring Income");
  const recurringExpenseRows = expenseRows.filter((item) => item.expenseType === "Recurring Expense");

  const incomeGroups = collectBySeries(
    recurringIncomeRows,
    (item) => `${item.workspaceName}|${item.profile}|${item.incomeSourceName}`
  );
  const expenseGroups = collectBySeries(
    recurringExpenseRows,
    (item) => `${item.workspaceName}|${item.profile}|${item.category}`
  );

  for (const [key, rows] of incomeGroups.entries()) {
    const sorted = [...rows].sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
    const first = sorted[0];
    const upcomingDate = toUpcomingDate(first.dateObj.getUTCDate());
    const daysLeft = getUtcDayDiff(today, upcomingDate);
    if (daysLeft >= 1 && daysLeft <= 3) {
      reminders.push({
        dedupeKey: `income-${key}-${upcomingDate.toISOString().slice(0, 10)}`,
        source: "recurring",
        type: "income",
        name: first.incomeSourceName,
        profile: first.profile,
        workspaceName: first.workspaceName,
        daysLeft,
        dueDate: upcomingDate.toISOString()
      });
    }
  }

  for (const [key, rows] of expenseGroups.entries()) {
    const sorted = [...rows].sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
    const first = sorted[0];
    const upcomingDate = toUpcomingDate(first.dateObj.getUTCDate());
    const daysLeft = getUtcDayDiff(today, upcomingDate);
    if (daysLeft >= 1 && daysLeft <= 3) {
      reminders.push({
        dedupeKey: `expense-${key}-${upcomingDate.toISOString().slice(0, 10)}`,
        source: "recurring",
        type: "expense",
        name: first.category,
        profile: first.profile,
        workspaceName: first.workspaceName,
        daysLeft,
        dueDate: upcomingDate.toISOString()
      });
    }
  }

  return reminders.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
};

const buildUpcomingTaskNotifications = ({ taskRows, now }) => {
  const today = startOfUtcDay(now);
  const reminders = [];

  for (const task of taskRows) {
    if (task.status === "Completed") continue;
    const deadline = startOfUtcDay(task.deadline);
    const daysLeft = getUtcDayDiff(today, deadline);
    if (daysLeft === 3 || daysLeft === 1) {
      reminders.push({
        dedupeKey: `task-${task._id}-${deadline.toISOString().slice(0, 10)}`,
        source: "task",
        type: "task",
        taskType: task.taskType,
        name: task.name || task.description,
        amount: Number(task.amount || 0),
        profile: task.profile,
        workspaceName: task.workspaceName,
        daysLeft,
        dueDate: task.deadline
      });
    }
  }

  return reminders.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
};

const syncAndListNotifications = async ({
  userId,
  workspaceId,
  workspaceName,
  profile,
  reminders,
  now
}) => {
  const scopeFilter = applyScopeFilter({ workspaceId, workspaceName, profile });
  const today = startOfUtcDay(now);
  const retentionCutoff = addUtcDays(today, -NOTIFICATION_RETENTION_DAYS);
  const dedupeKeys = reminders.map((item) => item.dedupeKey);

  // await Notification.deleteMany({
  //   userId,
  //   origin: "auto",
  //   ...scopeFilter,
  //   dueDate: { $lt: retentionCutoff }
  // });

  if (!dedupeKeys.length) {
    return {
      items: [],
      count: 0,
      unreadCount: 0
    };
  }

  for (const reminder of reminders) {
    await Notification.updateOne(
      { userId, dedupeKey: reminder.dedupeKey },
      {
        $set: {
          workspaceId: workspaceId || null,
          workspaceName: workspaceName || "",
          profile: reminder.profile || profile || "Company",
          origin: "auto",
          source: reminder.source,
          type: reminder.type,
          taskType: reminder.taskType || "",
          name: reminder.name,
          amount: Number(reminder.amount || 0),
          dueDate: new Date(reminder.dueDate)
        },
        $setOnInsert: {
          isRead: false,
          readAt: null
        }
      },
      { upsert: true }
    );
  }

  const docs = await Notification.find({
    userId,
    origin: "auto",
    ...scopeFilter,
    dedupeKey: { $in: dedupeKeys }
  })
    .sort({ dueDate: 1, createdAt: -1 })
    .lean();

  const items = docs
    .map((item) => ({
      id: String(item._id),
      source: item.source,
      type: item.type,
      taskType: item.taskType || "",
      name: item.name,
      amount: Number(item.amount || 0),
      profile: item.profile,
      workspaceName: item.workspaceName,
      dueDate: item.dueDate,
      daysLeft: getUtcDayDiff(now, item.dueDate),
      isRead: Boolean(item.isRead)
    }))
    .filter((item) => item.daysLeft >= 1 && item.daysLeft <= 3);

  return {
    items,
    count: items.length,
    unreadCount: items.filter((item) => !item.isRead).length
  };
};

export const getDashboardData = async (req, res) => {
  const workspaceId = (req.query.workspaceId || "").trim();
  const workspaceName = (req.query.workspace || "").trim();
  const profile = (req.query.profile || "").trim();

  try {
    if (!workspaceId && !workspaceName) {
      return res.status(400).json({ message: "workspaceId is required" });
    }

    let resolvedWorkspaceName = workspaceName;
    let resolvedWorkspace = null;
    if (workspaceId) {
      resolvedWorkspace = await Workspace.findOne({ _id: workspaceId, userId: req.userId }).select(
        "_id name monthlyExpenseLimitPersonal monthlyExpenseLimitCompany"
      );
      if (!resolvedWorkspace) {
        return res.status(404).json({ message: "Workspace not found" });
      }
      resolvedWorkspaceName = resolvedWorkspace.name;
    }

    await ensureRecurringEntriesForScope({
      userId: req.userId,
      workspaceId: workspaceId || undefined,
      workspaceName: resolvedWorkspaceName || undefined,
      profile: profile || undefined
    });
    await ensureRecurringExpenseEntriesForScope({
      userId: req.userId,
      workspaceId: workspaceId || undefined,
      workspaceName: resolvedWorkspaceName || undefined,
      profile: profile || undefined
    });

    const filter = {
      userId: req.userId,
      ...applyScopeFilter({
        workspaceId: workspaceId || undefined,
        workspaceName: resolvedWorkspaceName || undefined,
        profile: profile || undefined
      })
    };

    const [incomeRowsRaw, expenseRowsRaw, taskRowsRaw] = await Promise.all([
      IncomeEntry.find(filter)
        .sort({ entryDate: -1, createdAt: -1 })
        .select("_id incomeSourceName incomeNature amount profile workspaceName entryDate createdAt")
        .lean(),
      ExpenseEntry.find(filter)
        .sort({ entryDate: -1, createdAt: -1 })
        .select("_id category expenseType amount profile workspaceName entryDate createdAt")
        .lean(),
      FinanceTask.find(filter)
        .sort({ deadline: 1, createdAt: -1 })
        .select("_id taskType name amount description deadline status profile workspaceName createdAt")
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
    const recurringNotifications = buildUpcomingRecurringNotifications({
      incomeRows,
      expenseRows,
      now
    });
    const taskNotifications = buildUpcomingTaskNotifications({ taskRows: taskRowsRaw, now });
    const upcomingNotifications = [...recurringNotifications, ...taskNotifications].sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    );
    const notificationsPayload = await syncAndListNotifications({
      userId: req.userId,
      workspaceId: workspaceId || undefined,
      workspaceName: resolvedWorkspaceName || undefined,
      profile: profile || undefined,
      reminders: upcomingNotifications,
      now
    });

    const income60Start = addUtcDays(now, -60);
    const expense30Start = addUtcDays(now, -30);

    const incomeLast60 = incomeRows.filter((item) => item.dateObj.getTime() >= income60Start.getTime());
    const expenseLast30 = expenseRows.filter((item) => item.dateObj.getTime() >= expense30Start.getTime());

    const totalIncome = incomeRows.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenses = expenseRows.reduce((sum, item) => sum + item.amount, 0);
    const totalBalance = totalIncome - totalExpenses;

    const currentMonthIncome = incomeRows
      .filter((item) => isSameUtcMonth(item.dateObj, now))
      .reduce((sum, item) => sum + item.amount, 0);
    const currentMonthExpense = expenseRows
      .filter((item) => isSameUtcMonth(item.dateObj, now))
      .reduce((sum, item) => sum + item.amount, 0);

    let spendingUsagePercent = 0;
    if (currentMonthIncome > 0) {
      spendingUsagePercent = (currentMonthExpense / currentMonthIncome) * 100;
    } else if (currentMonthExpense > 0) {
      spendingUsagePercent = 100;
    }

    let spendingStatus = "normal";
    if (spendingUsagePercent >= 100 || (currentMonthIncome <= 0 && currentMonthExpense > 0)) {
      spendingStatus = "alert";
    } else if (spendingUsagePercent >= 80) {
      spendingStatus = "warning";
    }

    const remainingAmount = currentMonthIncome - currentMonthExpense;
    const monthlyExpenseLimit = resolvedWorkspace
      ? profile === "Personal"
        ? Number(resolvedWorkspace.monthlyExpenseLimitPersonal || 0)
        : Number(resolvedWorkspace.monthlyExpenseLimitCompany || 0)
      : 0;

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
      spendingControl: {
        monthlyExpenseLimit,
        currentMonthIncome,
        currentMonthExpense,
        usagePercent: Number(spendingUsagePercent.toFixed(2)),
        status: spendingStatus,
        remainingAmount
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
      notifications: notificationsPayload,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load dashboard data", error: error.message });
  }
};

export const markNotificationsAsRead = async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const workspaceId = String(req.body?.workspaceId || "").trim();
  const workspaceName = String(req.body?.workspace || "").trim();
  const profile = String(req.body?.profile || "").trim();

  try {
    const validIds = ids.filter((item) => isMongoObjectId(item)).map((item) => String(item));
    const filter = {
      userId: req.userId,
      origin: "auto",
      isRead: false
    };

    if (validIds.length > 0) {
      filter._id = { $in: validIds };
    } else {
      if (!workspaceId && !workspaceName) {
        return res
          .status(400)
          .json({ message: "Provide notification ids or workspaceId/workspace to mark as read" });
      }

      let resolvedWorkspaceName = workspaceName;
      if (workspaceId) {
        const workspace = await Workspace.findOne({ _id: workspaceId, userId: req.userId }).select("_id name");
        if (!workspace) {
          return res.status(404).json({ message: "Workspace not found" });
        }
        resolvedWorkspaceName = workspace.name;
      }

      Object.assign(
        filter,
        applyScopeFilter({
          workspaceId: workspaceId || undefined,
          workspaceName: resolvedWorkspaceName || undefined,
          profile: profile || undefined
        })
      );
    }

    const result = await Notification.updateMany(filter, {
      $set: {
        isRead: true,
        readAt: new Date()
      }
    });

    return res.status(200).json({
      message: "Notifications marked as read",
      updatedCount: Number(result.modifiedCount || 0)
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to mark notifications as read", error: error.message });
  }
};
