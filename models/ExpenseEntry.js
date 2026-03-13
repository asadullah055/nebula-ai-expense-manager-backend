import mongoose from "mongoose";

const expenseEntrySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    workspaceName: {
      type: String,
      required: true,
      trim: true
    },
    profile: {
      type: String,
      enum: ["Personal", "Company"],
      required: true
    },
    expenseCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseCategory",
      required: true
    },
    expenseType: {
      type: String,
      enum: ["Recurring Expense", "Variable Expense"],
      required: true
    },
    category: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    normalizedCategory: {
      type: String,
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    entryDate: {
      type: Date,
      required: true
    },
    monthKey: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

expenseEntrySchema.index({ userId: 1, workspaceName: 1, entryDate: -1 });
expenseEntrySchema.index({ userId: 1, normalizedCategory: 1 });
expenseEntrySchema.index(
  { userId: 1, workspaceName: 1, profile: 1, expenseCategoryId: 1, monthKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      expenseType: "Recurring Expense",
      monthKey: { $type: "string" }
    }
  }
);

const ExpenseEntry = mongoose.model("ExpenseEntry", expenseEntrySchema);

export default ExpenseEntry;
