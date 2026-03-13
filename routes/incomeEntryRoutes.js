import express from "express";
import { body } from "express-validator";
import authMiddleware from "../middleware/authMiddleware.js";
import { createIncomeEntry, listIncomeEntries } from "../controllers/incomeEntryController.js";

const router = express.Router();

router.get("/", authMiddleware, listIncomeEntries);
router.post(
  "/",
  authMiddleware,
  [
    body("workspaceName").trim().isLength({ min: 2 }).withMessage("Workspace is required"),
    body("profile").isIn(["Personal", "Company"]).withMessage("Profile must be Personal or Company"),
    body("incomeSourceId").isMongoId().withMessage("Income category is required"),
    body("incomeNature")
      .isIn(["Recurring Income", "Variable Income"])
      .withMessage("Income nature must be Recurring Income or Variable Income"),
    body("amount").isFloat({ gt: 0 }).withMessage("Amount must be greater than 0"),
    body("entryDate").isISO8601().withMessage("Valid date is required")
  ],
  createIncomeEntry
);

export default router;
