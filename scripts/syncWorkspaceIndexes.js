import "dotenv/config";
import mongoose from "mongoose";
import IncomeSource from "../models/IncomeSource.js";
import ExpenseCategory from "../models/ExpenseCategory.js";
import IncomeEntry from "../models/IncomeEntry.js";
import ExpenseEntry from "../models/ExpenseEntry.js";

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected for index sync");

  await IncomeSource.syncIndexes();
  await ExpenseCategory.syncIndexes();
  await IncomeEntry.syncIndexes();
  await ExpenseEntry.syncIndexes();

  console.log("Workspace-scoped indexes synced successfully");
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Index sync failed:", error.message);
  try {
    await mongoose.disconnect();
  } catch (_error) {
    // no-op
  }
  process.exit(1);
});
