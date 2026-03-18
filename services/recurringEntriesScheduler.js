import mongoose from "mongoose";
import cron from "node-cron";
import ExpenseEntry from "../models/ExpenseEntry.js";
import IncomeEntry from "../models/IncomeEntry.js";
import { ensureRecurringExpenseEntriesForScope } from "../controllers/expenseEntryController.js";
import { ensureRecurringEntriesForScope } from "../controllers/incomeEntryController.js";

const DEFAULT_CRON_EXPRESSION = "5 0 * * *";
const DEFAULT_TIMEZONE = "UTC";

let schedulerTask = null;
let isJobRunning = false;
let startupHookRegistered = false;

const collectUserIdsWithRecurringData = async () => {
  const [incomeUserIds, expenseUserIds] = await Promise.all([
    IncomeEntry.distinct("userId", { incomeNature: "Recurring Income" }),
    ExpenseEntry.distinct("userId", { expenseType: "Recurring Expense" })
  ]);

  return [
    ...new Set(
      [...incomeUserIds, ...expenseUserIds]
        .filter(Boolean)
        .map((item) => item.toString())
    )
  ];
};

export const runRecurringEntriesSyncJob = async ({ reason = "manual" } = {}) => {
  if (isJobRunning) {
    console.log("[RecurringScheduler] Sync is already running, skipping this trigger.");
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    console.log("[RecurringScheduler] MongoDB is not connected yet, skipping this trigger.");
    return;
  }

  isJobRunning = true;
  const startedAt = Date.now();

  try {
    const userIds = await collectUserIdsWithRecurringData();
    if (!userIds.length) {
      console.log(`[RecurringScheduler] No recurring entries found to sync (${reason}).`);
      return;
    }

    for (const userId of userIds) {
      try {
        await ensureRecurringEntriesForScope({ userId });
        await ensureRecurringExpenseEntriesForScope({ userId });
      } catch (error) {
        console.error(
          `[RecurringScheduler] Failed to sync recurring entries for user ${userId}: ${error.message}`
        );
      }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[RecurringScheduler] Sync complete (${reason}). Users processed: ${userIds.length}. Time: ${elapsedMs}ms.`
    );
  } catch (error) {
    console.error(`[RecurringScheduler] Sync failed (${reason}): ${error.message}`);
  } finally {
    isJobRunning = false;
  }
};

export const startRecurringEntriesScheduler = () => {
  if (schedulerTask) return schedulerTask;

  const cronExpression = (process.env.RECURRING_ENTRIES_CRON || DEFAULT_CRON_EXPRESSION).trim();
  const timezone = (process.env.RECURRING_ENTRIES_CRON_TZ || DEFAULT_TIMEZONE).trim();
  const runOnStartup = String(process.env.RECURRING_ENTRIES_RUN_ON_START || "true").toLowerCase() !== "false";

  schedulerTask = cron.schedule(
    cronExpression,
    () => {
      void runRecurringEntriesSyncJob({ reason: "cron" });
    },
    { timezone }
  );

  console.log(`[RecurringScheduler] Started with cron "${cronExpression}" (${timezone}).`);

  if (runOnStartup && !startupHookRegistered) {
    startupHookRegistered = true;
    const runStartupSync = () => {
      void runRecurringEntriesSyncJob({ reason: "startup" });
    };

    if (mongoose.connection.readyState === 1) {
      runStartupSync();
    } else {
      mongoose.connection.once("connected", runStartupSync);
    }
  }

  return schedulerTask;
};

export const stopRecurringEntriesScheduler = () => {
  if (!schedulerTask) return;
  schedulerTask.stop();
  schedulerTask = null;
  startupHookRegistered = false;
  console.log("[RecurringScheduler] Stopped.");
};
