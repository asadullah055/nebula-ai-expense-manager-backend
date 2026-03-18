import { validationResult } from "express-validator";
import BudgetGoal from "../models/BudgetGoal.js";
import FinanceTask from "../models/FinanceTask.js";
import Workspace from "../models/Workspace.js";

const startOfUtcDay = (dateValue) => {
  const date = new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const getUtcDayDiff = (fromDate, toDate) => {
  const from = startOfUtcDay(fromDate);
  const to = startOfUtcDay(toDate);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
};

const getScope = async ({ userId, workspaceId, workspaceName }) => {
  if (workspaceId) {
    const workspace = await Workspace.findOne({ _id: workspaceId, userId }).select("_id name");
    if (!workspace) return null;
    return { workspaceId: workspace._id.toString(), workspaceName: workspace.name };
  }

  const fallbackName = (workspaceName || "").trim();
  if (!fallbackName) return null;
  return { workspaceId: "", workspaceName: fallbackName };
};

const applyScopeFilter = ({ userId, workspaceId, workspaceName, profile }) => {
  const filter = { userId };

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

  if (profile) filter.profile = profile;
  return filter;
};

const buildGoalMetrics = (goal) => {
  const contributions = goal.contributions || [];
  const incomeTotal = contributions
    .filter((item) => item.entryType === "income")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenseTotal = contributions
    .filter((item) => item.entryType === "expense")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const savedTotal = incomeTotal - expenseTotal;

  const trackedAmount =
    goal.goalType === "Spending Goal"
      ? expenseTotal
      : goal.goalType === "Income Goal"
      ? incomeTotal
      : Math.max(0, savedTotal);
  const targetAmount = Number(goal.targetAmount || 0);
  const progressPercent =
    targetAmount > 0 ? Math.min(100, (trackedAmount / targetAmount) * 100) : 0;

  return {
    incomeTotal,
    expenseTotal,
    savedTotal,
    trackedAmount,
    remainingAmount: Math.max(0, targetAmount - trackedAmount),
    progressPercent: Number(progressPercent.toFixed(2))
  };
};

const mapGoal = (goalDoc) => {
  const goal = goalDoc.toObject ? goalDoc.toObject() : goalDoc;
  const metrics = buildGoalMetrics(goal);
  return {
    id: goal._id,
    title: goal.title,
    description: goal.description || "",
    goalType: goal.goalType,
    targetAmount: Number(goal.targetAmount || 0),
    profile: goal.profile,
    workspaceName: goal.workspaceName,
    contributions: (goal.contributions || [])
      .map((item) => ({
        id: item._id,
        name: item.name || "",
        entryType: item.entryType,
        amount: Number(item.amount || 0),
        description: item.description || "",
        entryDate: item.entryDate
      }))
      .sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime()),
    metrics,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt
  };
};

const mapTask = (taskDoc) => {
  const task = taskDoc.toObject ? taskDoc.toObject() : taskDoc;
  return {
    id: task._id,
    taskType: task.taskType,
    name: task.name || task.description || "",
    amount: Number(task.amount || 0),
    description: task.description,
    deadline: task.deadline,
    profile: task.profile,
    workspaceName: task.workspaceName,
    status: task.status,
    completedAt: task.completedAt,
    daysLeft: getUtcDayDiff(new Date(), task.deadline),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
};

export const listBudgetGoals = async (req, res) => {
  const workspaceId = (req.query.workspaceId || "").trim();
  const workspaceName = (req.query.workspace || "").trim();
  const profile = (req.query.profile || "").trim();

  try {
    if (!workspaceId && !workspaceName) {
      return res.status(400).json({ message: "workspaceId is required" });
    }

    const scope = await getScope({ userId: req.userId, workspaceId, workspaceName });
    if (!scope) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const filter = applyScopeFilter({
      userId: req.userId,
      workspaceId: scope.workspaceId || undefined,
      workspaceName: scope.workspaceName || undefined,
      profile: profile || undefined
    });

    const goals = await BudgetGoal.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ goals: goals.map(mapGoal) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load budget goals", error: error.message });
  }
};

export const createBudgetGoal = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const workspaceId = req.body.workspaceId;
  const profile = req.body.profile;
  const title = req.body.title.trim();
  const description = String(req.body.description || "").trim();
  const goalType = req.body.goalType || "Savings Goal";
  const targetAmount = Number(req.body.targetAmount);

  try {
    const workspace = await Workspace.findOne({ _id: workspaceId, userId: req.userId }).select("_id name");
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const goal = await BudgetGoal.create({
      userId: req.userId,
      workspaceId: workspace._id,
      workspaceName: workspace.name,
      profile,
      title,
      description,
      goalType,
      targetAmount
    });

    return res.status(201).json({ message: "Budget goal created", goal: mapGoal(goal) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create budget goal", error: error.message });
  }
};

export const addBudgetGoalEntry = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const goalId = req.params.goalId;
  const name = String(req.body.name || "").trim();
  const entryType = req.body.entryType || "income";
  const amount = Number(req.body.amount);
  const description = String(req.body.description || "").trim();
  const entryDate = req.body.entryDate ? new Date(req.body.entryDate) : new Date();

  try {
    const goal = await BudgetGoal.findOne({ _id: goalId, userId: req.userId });
    if (!goal) {
      return res.status(404).json({ message: "Budget goal not found" });
    }

    goal.contributions.push({
      name,
      entryType,
      amount,
      description,
      entryDate
    });
    await goal.save();

    return res.status(200).json({ message: "Budget entry added", goal: mapGoal(goal) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to add budget entry", error: error.message });
  }
};

export const listFinanceTasks = async (req, res) => {
  const workspaceId = (req.query.workspaceId || "").trim();
  const workspaceName = (req.query.workspace || "").trim();
  const profile = (req.query.profile || "").trim();

  try {
    if (!workspaceId && !workspaceName) {
      return res.status(400).json({ message: "workspaceId is required" });
    }

    const scope = await getScope({ userId: req.userId, workspaceId, workspaceName });
    if (!scope) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const filter = applyScopeFilter({
      userId: req.userId,
      workspaceId: scope.workspaceId || undefined,
      workspaceName: scope.workspaceName || undefined,
      profile: profile || undefined
    });

    const tasks = await FinanceTask.find(filter).sort({ deadline: 1, createdAt: -1 });
    return res.status(200).json({ tasks: tasks.map(mapTask) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load finance tasks", error: error.message });
  }
};

export const createFinanceTask = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const workspaceId = req.body.workspaceId;
  const profile = req.body.profile;
  const taskType = req.body.taskType;
  const name = req.body.name.trim();
  const amount = Number(req.body.amount);
  const description = req.body.description.trim();
  const deadline = new Date(req.body.deadline);

  try {
    const workspace = await Workspace.findOne({ _id: workspaceId, userId: req.userId }).select("_id name");
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const task = await FinanceTask.create({
      userId: req.userId,
      workspaceId: workspace._id,
      workspaceName: workspace.name,
      profile,
      taskType,
      name,
      amount,
      description,
      deadline
    });

    return res.status(201).json({ message: "Finance task created", task: mapTask(task) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create finance task", error: error.message });
  }
};

export const updateFinanceTaskStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const taskId = req.params.taskId;
  const status = req.body.status;

  try {
    const task = await FinanceTask.findOne({ _id: taskId, userId: req.userId });
    if (!task) {
      return res.status(404).json({ message: "Finance task not found" });
    }

    task.status = status;
    task.completedAt = status === "Completed" ? new Date() : null;
    await task.save();

    return res.status(200).json({ message: "Task status updated", task: mapTask(task) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update task status", error: error.message });
  }
};
