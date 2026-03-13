import express from "express";
import { body } from "express-validator";
import authMiddleware from "../middleware/authMiddleware.js";
import { createIncomeSource, listIncomeSources } from "../controllers/incomeSourceController.js";

const router = express.Router();

router.get("/", authMiddleware, listIncomeSources);
router.post(
  "/",
  authMiddleware,
  [
    body("name").trim().isLength({ min: 2 }).withMessage("Income category must be at least 2 characters"),
    body("profile").isIn(["Personal", "Company"]).withMessage("Profile must be Personal or Company"),
    body("type")
      .isIn(["Recurring Income", "Variable Income"])
      .withMessage("Type must be Recurring Income or Variable Income")
  ],
  createIncomeSource
);

export default router;
