import mongoose from "mongoose";

const incomeEntrySchema = new mongoose.Schema(
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
    incomeSourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IncomeSource",
      required: true
    },
    incomeSourceName: {
      type: String,
      required: true,
      trim: true
    },
    incomeNature: {
      type: String,
      enum: ["Recurring Income", "Variable Income"],
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

incomeEntrySchema.index({ userId: 1, workspaceName: 1, entryDate: -1 });
incomeEntrySchema.index(
  { userId: 1, workspaceName: 1, profile: 1, incomeSourceId: 1, monthKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      incomeNature: "Recurring Income",
      monthKey: { $type: "string" }
    }
  }
);

const IncomeEntry = mongoose.model("IncomeEntry", incomeEntrySchema);

export default IncomeEntry;
