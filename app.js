import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import passport from "passport";
import connectDB from "./config/db.js";
import configurePassport from "./config/passport.js";
import authRoutes from "./routes/authRoutes.js";
import protectedRoutes from "./routes/protectedRoutes.js";
import workspaceRoutes from "./routes/workspaceRoutes.js";
import incomeSourceRoutes from "./routes/incomeSourceRoutes.js";
import incomeEntryRoutes from "./routes/incomeEntryRoutes.js";
import expenseCategoryRoutes from "./routes/expenseCategoryRoutes.js";
import expenseEntryRoutes from "./routes/expenseEntryRoutes.js";
import agentRoutes from "./routes/agentRoutes.js";
import telegramRoutes from "./routes/telegramRoutes.js";
import telegramLinkRoutes from "./routes/telegramLinkRoutes.js";

const app = express();

connectDB();
configurePassport();

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
  })
);

app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok", app: "Nebula AI Expense Manager API" });
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/protected", protectedRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/income-sources", incomeSourceRoutes);
app.use("/api/incomes", incomeEntryRoutes);
app.use("/api/expense-categories", expenseCategoryRoutes);
app.use("/api/expenses", expenseEntryRoutes);
app.use("/api/agent", agentRoutes);
app.use("/api/telegram", telegramRoutes);
app.use("/api/telegram-link", telegramLinkRoutes);

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Internal server error" });
});

export default app;
