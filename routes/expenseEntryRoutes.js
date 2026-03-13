import express from "express";
import { body } from "express-validator";
import authMiddleware from "../middleware/authMiddleware.js";
import { createExpenseEntry, listExpenseEntries } from "../controllers/expenseEntryController.js";

const router = express.Router();

router.get("/", authMiddleware, listExpenseEntries);
router.post(
  "/",
  authMiddleware,
  [
    body("workspaceName").trim().isLength({ min: 2 }).withMessage("Workspace is required"),
    body("profile").isIn(["Personal", "Company"]).withMessage("Profile must be Personal or Company"),
    body("expenseCategoryId").isMongoId().withMessage("Expense category is required"),
    body("expenseType")
      .isIn(["Recurring Expense", "Variable Expense"])
      .withMessage("Expense type must be Recurring Expense or Variable Expense"),
    body("amount").isFloat({ gt: 0 }).withMessage("Amount must be greater than 0"),
    body("entryDate").isISO8601().withMessage("Valid date is required")
  ],
  createExpenseEntry
);

export default router;
