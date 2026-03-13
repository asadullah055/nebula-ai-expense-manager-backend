import express from "express";
import { body } from "express-validator";
import authMiddleware from "../middleware/authMiddleware.js";
import { createExpenseCategory, listExpenseCategories } from "../controllers/expenseCategoryController.js";

const router = express.Router();

router.get("/", authMiddleware, listExpenseCategories);
router.post(
  "/",
  authMiddleware,
  [
    body("name").trim().isLength({ min: 2 }).withMessage("Expense category must be at least 2 characters"),
    body("profile").isIn(["Personal", "Company"]).withMessage("Profile must be Personal or Company"),
    body("type")
      .isIn(["Recurring Expense", "Variable Expense"])
      .withMessage("Type must be Recurring Expense or Variable Expense")
  ],
  createExpenseCategory
);

export default router;
