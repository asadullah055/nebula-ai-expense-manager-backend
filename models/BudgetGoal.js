import mongoose from "mongoose";

const goalContributionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    entryType: {
      type: String,
      enum: ["income", "expense"],
      required: true,
      default: "income"
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    description: {
      type: String,
      trim: true,
      maxlength: 240,
      default: ""
    },
    entryDate: {
      type: Date,
      required: true,
      default: Date.now
    }
  },
  { _id: true }
);

const budgetGoalSchema = new mongoose.Schema(
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
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },
    goalType: {
      type: String,
      enum: ["Income Goal", "Savings Goal", "Spending Goal"],
      required: true,
      default: "Savings Goal"
    },
    targetAmount: {
      type: Number,
      required: true,
      min: 0
    },
    contributions: {
      type: [goalContributionSchema],
      default: []
    }
  },
  { timestamps: true }
);

budgetGoalSchema.index({ userId: 1, workspaceId: 1, profile: 1, createdAt: -1 });

const BudgetGoal = mongoose.model("BudgetGoal", budgetGoalSchema);

export default BudgetGoal;
