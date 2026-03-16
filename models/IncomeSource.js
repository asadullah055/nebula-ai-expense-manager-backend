import mongoose from "mongoose";

const incomeSourceSchema = new mongoose.Schema(
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
      enum: ["Recurring Income", "Variable Income"],
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
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
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

incomeSourceSchema.index({ userId: 1, workspaceId: 1, normalizedProfile: 1, normalizedName: 1, type: 1 });

const IncomeSource = mongoose.model("IncomeSource", incomeSourceSchema);

export default IncomeSource;
