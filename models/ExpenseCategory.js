import mongoose from "mongoose";

const expenseCategorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      default: null,
      index: true
    },
    type: {
      type: String,
      enum: ["Recurring Expense", "Variable Expense"],
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    profile: {
      type: String,
      enum: ["Personal", "Company"],
      required: true
    },
    normalizedProfile: {
      type: String,
      required: true
    },
    normalizedName: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
);

expenseCategorySchema.index({ userId: 1, workspaceId: 1, normalizedProfile: 1, normalizedName: 1, type: 1 });

const ExpenseCategory = mongoose.model("ExpenseCategory", expenseCategorySchema);

export default ExpenseCategory;
