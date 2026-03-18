import express from "express";
import { body, param } from "express-validator";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  addBudgetGoalEntry,
  createBudgetGoal,
  createFinanceTask,
  listBudgetGoals,
  listFinanceTasks,
  updateFinanceTaskStatus
} from "../controllers/todoController.js";

const router = express.Router();

router.get("/goals", authMiddleware, listBudgetGoals);
router.post(
  "/goals",
  authMiddleware,
  [
    body("workspaceId").isMongoId().withMessage("Workspace is required"),
    body("profile").isIn(["Personal", "Company"]).withMessage("Profile must be Personal or Company"),
    body("title").trim().isLength({ min: 2, max: 120 }).withMessage("Goal title must be 2 to 120 characters"),
    body("description")
      .trim()
      .isLength({ min: 2, max: 500 })
      .withMessage("Description must be 2 to 500 characters"),
    body("goalType").optional().isIn(["Income Goal", "Savings Goal", "Spending Goal"]).withMessage("Goal type is invalid"),
    body("targetAmount").isFloat({ gt: 0 }).withMessage("Target amount must be greater than 0")
  ],
  createBudgetGoal
);
router.post(
  "/goals/:goalId/entries",
  authMiddleware,
  [
    param("goalId").isMongoId().withMessage("Goal id is invalid"),
    body("name").trim().isLength({ min: 2, max: 120 }).withMessage("Name must be 2 to 120 characters"),
    body("entryType").optional().isIn(["income", "expense"]).withMessage("Entry type is invalid"),
    body("amount").isFloat({ gt: 0 }).withMessage("Amount must be greater than 0"),
    body("description").optional().trim().isLength({ max: 240 }).withMessage("Description is too long"),
    body("entryDate").optional().isISO8601().withMessage("Entry date must be valid")
  ],
  addBudgetGoalEntry
);

router.get("/tasks", authMiddleware, listFinanceTasks);
router.post(
  "/tasks",
  authMiddleware,
  [
    body("workspaceId").isMongoId().withMessage("Workspace is required"),
    body("profile").isIn(["Personal", "Company"]).withMessage("Profile must be Personal or Company"),
    body("taskType").isIn(["Bill Payment", "Income Collection"]).withMessage("Task type is invalid"),
    body("name").trim().isLength({ min: 2, max: 120 }).withMessage("Name must be 2 to 120 characters"),
    body("amount").isFloat({ gt: 0 }).withMessage("Amount must be greater than 0"),
    body("deadline").isISO8601().withMessage("Deadline must be a valid date"),
    body("description").trim().isLength({ min: 2, max: 240 }).withMessage("Description must be 2 to 240 characters")
  ],
  createFinanceTask
);
router.patch(
  "/tasks/:taskId/status",
  authMiddleware,
  [
    param("taskId").isMongoId().withMessage("Task id is invalid"),
    body("status").isIn(["Pending", "Completed"]).withMessage("Status is invalid")
  ],
  updateFinanceTaskStatus
);

export default router;
