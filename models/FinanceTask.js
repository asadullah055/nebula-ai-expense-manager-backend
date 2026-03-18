import mongoose from "mongoose";

const financeTaskSchema = new mongoose.Schema(
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
    taskType: {
      type: String,
      enum: ["Bill Payment", "Income Collection"],
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 240
    },
    deadline: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: ["Pending", "Completed"],
      default: "Pending"
    },
    completedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

financeTaskSchema.index({ userId: 1, workspaceId: 1, profile: 1, deadline: 1, status: 1 });

const FinanceTask = mongoose.model("FinanceTask", financeTaskSchema);

export default FinanceTask;
