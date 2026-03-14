import AgentMessage from "../models/AgentMessage.js";
import ExpenseCategory from "../models/ExpenseCategory.js";
import ExpenseEntry from "../models/ExpenseEntry.js";
import IncomeEntry from "../models/IncomeEntry.js";
import IncomeSource from "../models/IncomeSource.js";
import TelegramLink from "../models/TelegramLink.js";
import Workspace from "../models/Workspace.js";
import { ensureRecurringEntriesForScope } from "../controllers/incomeEntryController.js";

const helpText = [
  "Sure, I can help with that.",
  "You can say things like:",
  "- list companies",
  "- add company Nebula",
  "- list income sources",
  "- add income source Salary as Recurring Income for Personal",
  "- list incomes",
  "- list incomes for Company",
  "- give me last 10 days income",
  "- show incomes from 2026-03-01 to 2026-03-10",
  "- show income from 1 to 10 date",
  "- add income 50000 salary for personal in facebook workspace",
  "- add income amount 1200 freelance as Variable Income",
  "- list expense categories",
  "- add expense category Rent as Recurring Expense for Personal",
  "- list expenses",
  "- list expenses for Company",
  "- show expenses from 2026-03-01 to 2026-03-10",
  "- add expense 800 rent as Recurring Expense for Personal in facebook workspace",
  "- financial summary",
  "- show total income total expense",
  "You can also chat naturally, and I will respond in English."
].join("\n");

const MONTH_NAME_TO_INDEX = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
};



const persistMessage = async ({ userId, channel, channelUserId, role, text, voiceFileId, metadata }) => {
  try {
    await AgentMessage.create({
      userId: userId || null,
      channel,
      channelUserId: channelUserId || null,
      role,
      text: text || "",
      voiceFileId: voiceFileId || null,
      metadata: metadata || {}
    });
  } catch (_error) {
    // Do not fail the workflow if logging fails.
  }
};

const getRecentConversation = async ({ userId, channelUserId }) => {
  const query = userId ? { userId } : { channelUserId };
  const rows = await AgentMessage.find(query).sort({ createdAt: -1 }).limit(12).lean();
  return rows.reverse();
};

const extractResponseText = (data) => {
  if (data?.output_text && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content?.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
};

const quickHumanReply = (text) => {
  const lower = (text || "").toLowerCase();

  if (/^(hi|hello|hey|yo|assalamu|as-salamu|salam)\b/.test(lower)) {
    return "Hey, glad to see you. Tell me what you want to do first, expenses or company setup?";
  }

  if (/how are you/.test(lower)) {
    return "I am doing great. How are you? I can help with incomes, workspaces, and setup right away.";
  }

  return "";
};

const hasBengaliText = (value) => /[\u0980-\u09FF]/.test(value || "");

const getAgentContext = async (userId) => {
  if (!userId) {
    return {
      activeWorkspaceName: "",
      activeProfile: "",
      pendingWorkspaceSwitch: false
    };
  }

  const row = await TelegramLink.findOne({ userId })
    .select("activeWorkspaceName activeProfile pendingWorkspaceSwitch")
    .lean();

  return {
    activeWorkspaceName: row?.activeWorkspaceName || "",
    activeProfile: row?.activeProfile || "",
    pendingWorkspaceSwitch: Boolean(row?.pendingWorkspaceSwitch)
  };
};

const updateAgentContext = async (userId, updates = {}) => {
  if (!userId) return;
  await TelegramLink.findOneAndUpdate(
    { userId },
    { $set: updates },
    { new: true }
  );
};

const callLlmReply = async ({ text, history, workspaceHint }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const quick = quickHumanReply(text);
    if (quick) return quick;
    return "I got your message. I can still help with app actions now. Try: list incomes, list expenses, add income <amount> <category>, or add expense <amount> <category>.";
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const systemPrompt = [
    "You are Nebula AI, a professional assistant for an expense manager.",
    "Respond naturally in clear English, with a concise and confident tone.",
    "Never fabricate numbers, transactions, balances, or actions.",
    "Never claim database execution unless confirmed by backend execution result.",
    "If information is missing or uncertain, say that briefly and ask one concrete clarification.",
    "For fallback chat mode, do not pretend to have performed create/update/delete/switch actions.",
    "Do not provide long command lists unless the user explicitly asks for examples.",
    "Prefer short practical answers (1-4 lines) and keep focus on the user's intent."
  ].join(" ");

  const conversation = history
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.text || ""
    }))
    .filter((item) => item.content);

  const input = [
    { role: "system", content: systemPrompt },
    ...(workspaceHint ? [{ role: "system", content: workspaceHint }] : []),
    ...conversation,
    { role: "user", content: text }
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input,
        temperature: 0.2,
        max_output_tokens: 220
      })
    });

    if (!response.ok) {
      const quick = quickHumanReply(text);
      if (quick) return quick;
      return "I could not think clearly right now. Say it once more and I will help.";
    }

    const data = await response.json();
    const llmText = extractResponseText(data);
    if (llmText) return llmText;
    const quick = quickHumanReply(text);
    return quick || "Got it. Give me a bit more detail and I will answer exactly the way you need.";
  } catch (_error) {
    const quick = quickHumanReply(text);
    if (quick) return quick;
    return "Network lag happened on my side. Please send that again, I am with you.";
  }
};

const toMonthKey = (dateValue) => {
  const date = new Date(dateValue);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const toIsoDate = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const formatCurrency = (value) => `$${Number(value || 0).toFixed(2)}`;

const formatHumanDate = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
};

const toCountLabel = (value, singular, plural) => {
  const count = Number(value || 0);
  return `${count} ${count === 1 ? singular : plural}`;
};

const buildSummaryScopeText = ({ workspaceName, profile, parsedRange }) => {
  const parts = [];

  if (workspaceName) parts.push(`${workspaceName} workspace`);
  if (profile) parts.push(`${profile} profile`);
  if (parsedRange?.label) parts.push(parsedRange.label);

  if (!parts.length) return "for all available data";
  return `for ${parts.join(", ")}`;
};

const startOfUtcDay = (dateValue) => {
  const date = new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const addUtcDays = (dateValue, days) => {
  const start = startOfUtcDay(dateValue);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + days));
};

const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
};

const normalizeLocalizedText = (value) => {
  if (!value) return "";
  return value;
};

const normalizeCommandLikeText = (value) => {
  if (!value) return "";
  return value
    .trim()
    .replace(/^[,.;:!?()\[\]\s]+|[,.;:!?()\[\]\s]+$/g, "")
    .replace(/^(please|plz|kindly)\s+/i, "")
    .replace(/^(can you|could you|would you|will you)\s+/i, "")
    .replace(/^(please|plz|kindly)\s+/i, "")
    .trim();
};

const parseIsoDateText = (value) => {
  const iso = (value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseMonthContextBaseDate = (rawText) => {
  const text = normalizeLocalizedText(rawText.toLowerCase());
  const now = new Date();

  if (/last\s+month/.test(text)) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  }

  if (/this\s+month/.test(text)) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  const monthMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/
  );
  if (!monthMatch) return null;

  const monthIndex = MONTH_NAME_TO_INDEX[monthMatch[1]];
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? toSafeInt(yearMatch[1], now.getUTCFullYear()) : now.getUTCFullYear();

  return new Date(Date.UTC(year, monthIndex, 1));
};

const buildMonthRange = (baseDate) => {
  const start = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), 1));
  const endExclusive = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + 1, 1));
  return { start, endExclusive };
};

const parseIncomeDateRange = (rawText) => {
  if (!rawText) return null;
  const text = normalizeLocalizedText(rawText);
  const lower = text.toLowerCase();
  const now = new Date();

  const explicitRangeMatch = lower.match(
    /(?:from|between)?\s*(\d{4}-\d{2}-\d{2})\s*(?:to|and|-)\s*(\d{4}-\d{2}-\d{2})/
  );
  if (explicitRangeMatch) {
    const startDate = parseIsoDateText(explicitRangeMatch[1]);
    const endDate = parseIsoDateText(explicitRangeMatch[2]);
    if (startDate && endDate) {
      const start = startDate <= endDate ? startDate : endDate;
      const end = startDate <= endDate ? endDate : startDate;
      return {
        start,
        endExclusive: addUtcDays(end, 1),
        label: `${toIsoDate(start)} to ${toIsoDate(end)}`
      };
    }
  }

  const lastDaysMatch = lower.match(/(?:last|past)\s*(\d{1,3})\s*(?:day|days)/);
  if (lastDaysMatch) {
    const totalDays = Math.max(1, Math.min(365, toSafeInt(lastDaysMatch[1], 0)));
    const endExclusive = addUtcDays(now, 1);
    const start = addUtcDays(endExclusive, -totalDays);
    return {
      start,
      endExclusive,
      label: `last ${totalDays} day${totalDays > 1 ? "s" : ""}`
    };
  }

  const monthBase = parseMonthContextBaseDate(lower);
  const dayRangeMatch = lower.match(
    /(?:from|between)?\s*(\d{1,2})\s*(?:to|and|-)\s*(\d{1,2})\s*(?:date|dates|day|days)?/
  );
  if (dayRangeMatch) {
    const dayA = toSafeInt(dayRangeMatch[1], 0);
    const dayB = toSafeInt(dayRangeMatch[2], 0);
    if (dayA >= 1 && dayA <= 31 && dayB >= 1 && dayB <= 31) {
      const base = monthBase || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const year = base.getUTCFullYear();
      const month = base.getUTCMonth();
      const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const startDay = Math.min(dayA, dayB);
      const endDay = Math.max(dayA, dayB);
      const clampedStart = Math.min(startDay, maxDay);
      const clampedEnd = Math.min(endDay, maxDay);
      const start = new Date(Date.UTC(year, month, clampedStart));
      const endExclusive = new Date(Date.UTC(year, month, clampedEnd + 1));
      const monthLabel = base.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      return {
        start,
        endExclusive,
        label: `${clampedStart} to ${clampedEnd} ${monthLabel}`
      };
    }
  }

  if (monthBase) {
    const { start, endExclusive } = buildMonthRange(monthBase);
    const monthLabel = monthBase.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return {
      start,
      endExclusive,
      label: monthLabel
    };
  }

  return null;
};

const isIncomeListIntent = (text, normalizedText) => {
  const lowerRaw = (text || "").toLowerCase();
  const lower = normalizeLocalizedText(lowerRaw);

  const classicIntent =
    /^(list|show|get|view)\s+incomes?\b/i.test(text) ||
    /^(list|show|get|view)\s+income\s+(entries|history|summary)\b/i.test(text) ||
    /^income\s+summary\b/i.test(text);
  if (classicIntent) return true;

  const mentionsIncome = /\bincome\b/.test(lower);
  if (!mentionsIncome) return false;

  const asksForData =
    /\b(list|show|get|view|give|fetch)\b/.test(lower) ||
    /(last|past|month|from|between|to|date|day|days|\d{4}-\d{2}-\d{2})/.test(lower);

  if (!asksForData) return false;

  const addIntent = /^(add|create|record)\s+income\b/i.test(normalizedText || "");
  return !addIntent;
};

const normalizeIncomeType = (text) => {
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower.includes("recurring")) return "Recurring Income";
  if (lower.includes("variable")) return "Variable Income";
  if (lower.includes("fixed")) return "Recurring Income";
  if (lower.includes("irregular")) return "Variable Income";
  return "";
};

const normalizeExpenseType = (text) => {
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower.includes("recurring")) return "Recurring Expense";
  if (lower.includes("variable")) return "Variable Expense";
  if (lower.includes("fixed")) return "Recurring Expense";
  if (lower.includes("irregular")) return "Variable Expense";
  return "";
};

const normalizeProfile = (text) => {
  if (!text) return "";
  const lower = text.toLowerCase();
  if (/(^|\s)(company|business|professional)($|\s)/.test(lower)) return "Company";
  if (/(^|\s)(personal|private)($|\s)/.test(lower)) return "Personal";
  return "";
};

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const inferIncomeSourceNameFromKnownSources = async ({ userId, text, profile, incomeNature }) => {
  if (!userId || !text) return "";

  const strictFilter = {
    userId,
    ...(profile ? { profile } : {}),
    ...(incomeNature ? { type: incomeNature } : {})
  };

  let sources = await IncomeSource.find(strictFilter)
    .select("name normalizedName type profile")
    .lean();

  if (!sources.length) {
    sources = await IncomeSource.find({ userId }).select("name normalizedName type profile").lean();
  }

  if (!sources.length) return "";

  const lowerText = normalizeLocalizedText(text.toLowerCase());
  const exactWordMatches = sources.filter((item) => {
    const normalized = (item.normalizedName || "").trim();
    if (!normalized) return false;
    const pattern = new RegExp(`\\b${escapeRegex(normalized)}\\b`, "i");
    return pattern.test(lowerText);
  });

  const candidates = exactWordMatches.length
    ? exactWordMatches
    : sources.filter((item) => lowerText.includes((item.normalizedName || "").trim()));

  if (!candidates.length) return "";

  candidates.sort((a, b) => (b.normalizedName || "").length - (a.normalizedName || "").length);
  return candidates[0].name || "";
};

const isNaturalAddIncomeIntent = (text, normalizedText) => {
  const lower = normalizeLocalizedText((text || "").toLowerCase());
  const normalized = normalizeLocalizedText((normalizedText || "").toLowerCase());

  if (!lower) return false;
  if (/\bexpense\b/.test(lower)) return false;

  const hasAmount = /\b[0-9]+(?:,[0-9]{3})*(?:\.\d+)?\b/.test(lower);
  if (!hasAmount) return false;

  const incomeContext =
    /\bincome\b/.test(lower) ||
    /\b(got|received|receive|earned|earning|salary|bonus|rent|freelance|commission|profit|allowance)\b/.test(lower);

  if (!incomeContext) return false;

  const actionCue =
    /\b(add|record|save|store|log)\b/.test(lower) ||
    /\b(i got|we got|i received|we received|i earned|we earned)\b/.test(lower);

  if (!actionCue) return false;

  const reportingIntent =
    /\b(list|show|get|view|summary|total|history|report)\b/.test(normalized) &&
    !/\badd\b/.test(normalized);

  return !reportingIntent;
};

const inferExpenseCategoryNameFromKnownCategories = async ({
  userId,
  text,
  profile,
  expenseType
}) => {
  if (!userId || !text) return "";

  const strictFilter = {
    userId,
    ...(profile ? { profile } : {}),
    ...(expenseType ? { type: expenseType } : {})
  };

  let categories = await ExpenseCategory.find(strictFilter)
    .select("name normalizedName type profile")
    .lean();

  if (!categories.length) {
    categories = await ExpenseCategory.find({ userId })
      .select("name normalizedName type profile")
      .lean();
  }

  if (!categories.length) return "";

  const lowerText = normalizeLocalizedText(text.toLowerCase());
  const exactWordMatches = categories.filter((item) => {
    const normalized = (item.normalizedName || "").trim();
    if (!normalized) return false;
    const pattern = new RegExp(`\\b${escapeRegex(normalized)}\\b`, "i");
    return pattern.test(lowerText);
  });

  const candidates = exactWordMatches.length
    ? exactWordMatches
    : categories.filter((item) => lowerText.includes((item.normalizedName || "").trim()));

  if (!candidates.length) return "";

  candidates.sort((a, b) => (b.normalizedName || "").length - (a.normalizedName || "").length);
  return candidates[0].name || "";
};

const isNaturalAddExpenseIntent = (text, normalizedText) => {
  const lower = normalizeLocalizedText((text || "").toLowerCase());
  const normalized = normalizeLocalizedText((normalizedText || "").toLowerCase());

  if (!lower) return false;
  if (/\bincome\b/.test(lower)) return false;

  const hasAmount = /\b[0-9]+(?:,[0-9]{3})*(?:\.\d+)?\b/.test(lower);
  if (!hasAmount) return false;

  const expenseContext =
    /\bexpense\b/.test(lower) ||
    /\b(spent|spend|paid|pay|payment|rent|bill|groceries|fuel|food|transport|shopping)\b/.test(lower);

  if (!expenseContext) return false;

  const actionCue =
    /\b(add|record|save|store|log)\b/.test(lower) ||
    /\b(i spent|we spent|i paid|we paid)\b/.test(lower);

  if (!actionCue) return false;

  const reportingIntent =
    /\b(list|show|get|view|summary|total|history|report)\b/.test(normalized) &&
    !/\badd\b/.test(normalized);

  return !reportingIntent;
};

const isLikelyMutationRequest = (text) => {
  const lower = normalizeLocalizedText((text || "").toLowerCase());
  if (!lower) return false;

  const mutationWord = /\b(add|create|record|save|store|log|update|edit|delete|remove)\b/.test(lower);
  const domainWord = /\b(income|expense|company|workspace|category|source)\b/.test(lower);

  return mutationWord && domainWord;
};

const isFinanceDomainRequest = (text) => {
  const lower = normalizeLocalizedText((text || "").toLowerCase());
  if (!lower) return false;

  const domainWord =
    /\b(income|expense|balance|financial|money|summary|total|company|workspace|profile|category|source|recurring|variable)\b/.test(
      lower
    );
  if (!domainWord) return false;

  const intentWord =
    /\b(list|show|get|view|add|create|record|save|store|log|update|edit|delete|remove|switch|change|use|summary|total|history|report|last|past|from|between|today|month|date)\b/.test(
      lower
    );

  return intentWord;
};

const isAffirmativeOnlyText = (text) => {
  const lower = normalizeLocalizedText((text || "").toLowerCase()).replace(/[^\w\s]/g, "").trim();
  if (!lower) return false;

  return /^(yes|yeah|yep|ok|okay|sure|confirm|go ahead|do it|please do)$/.test(lower);
};

const assistantAskedForMutationConfirmation = (history = []) => {
  const recentAssistant = [...history]
    .reverse()
    .find((item) => item?.role === "assistant" && item?.text);
  if (!recentAssistant) return false;

  const lower = normalizeLocalizedText(recentAssistant.text.toLowerCase());
  const asksConfirm = /\b(confirm|would you like me to|do you want me to|should i)\b/.test(lower);
  const mutationContext = /\b(add|create|record|save|update|delete|remove)\b/.test(lower);
  const domainContext = /\b(income|expense|category|source|workspace|company)\b/.test(lower);

  return asksConfirm && mutationContext && domainContext;
};

const hasUnsafeExecutionClaim = (reply) => {
  const lower = normalizeLocalizedText((reply || "").toLowerCase());
  if (!lower) return false;

  return (
    /\b(i have|i've|i just|done|successfully)\b[\s\S]{0,48}\b(added|recorded|created|updated|deleted|removed|switched|linked|unlinked)\b/.test(lower) ||
    /\byour .* (is|are) now\b/.test(lower)
  );
};

const parseDateHint = (text) => {
  if (!text) return "";
  if (/\btoday\b/i.test(text)) {
    return new Date().toISOString().slice(0, 10);
  }

  const onDate = text.match(/(?:\bon\b|\bdate\b)\s*[:=]?\s*(\d{4}-\d{2}-\d{2})/i);
  if (onDate?.[1]) return onDate[1];

  const plainDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (plainDate?.[1]) return plainDate[1];

  return "";
};

const parseWorkspaceHint = (text) => {
  if (!text) return "";

  const patterns = [
    /\bworkspace\s*:\s*([a-z0-9][a-z0-9 _-]{1,79})/i,
    /\bcompany\s*:\s*([a-z0-9][a-z0-9 _-]{1,79})/i,
    /\bin\s+([a-z0-9][a-z0-9 _-]{1,79})\s+(?:workspace|company)\b/i,
    /\b(?:workspace|company)\s+([a-z0-9][a-z0-9 _-]{1,79})$/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
};

const findWorkspaceByHint = (workspaces, hint) => {
  const normalizedHint = (hint || "").trim().toLowerCase();
  if (!normalizedHint) return null;

  const exact = workspaces.find(
    (item) => item.normalizedName === normalizedHint || item.name.toLowerCase() === normalizedHint
  );
  if (exact) return exact;

  return workspaces.find((item) => item.name.toLowerCase().includes(normalizedHint)) || null;
};

const parseScaledAmount = (rawAmount) => {
  const cleaned = String(rawAmount || "")
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  const match = cleaned.match(/^([0-9]+(?:\.\d+)?)([km])?$/i);
  if (!match) return null;

  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  const suffix = (match[2] || "").toLowerCase();
  const multiplier = suffix === "k" ? 1000 : suffix === "m" ? 1000000 : 1;
  return base * multiplier;
};

const parseAmountHint = (text) => {
  if (!text) return null;

  const withLabel = text.match(
    /(?:\bamount\b|\btk\b|\bbdt\b|\busd\b|\$)\s*[:=]?\s*([0-9]+(?:,[0-9]{3})*(?:\.\d+)?(?:\s*[km])?)/i
  );
  if (withLabel?.[1]) {
    const value = parseScaledAmount(withLabel[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const plainNumber = text.match(/\b([0-9]+(?:,[0-9]{3})*(?:\.\d+)?(?:\s*[km])?)\b/i);
  if (plainNumber?.[1]) {
    const value = parseScaledAmount(plainNumber[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  return null;
};

const parseIncomeAddPayload = (rawPayload) => {
  const payload = rawPayload.trim();
  const typeFromWhole = normalizeIncomeType(payload);

  if (!typeFromWhole) {
    return { name: payload, type: "Recurring Income" };
  }

  const withoutAsType = payload
    .replace(/\bas\s+recurring(?:\s+income|\s+revenue)?\b/i, "")
    .replace(/\bas\s+variable(?:\s+(?:income|earnings))?\b/i, "")
    .replace(/\bas\s+fixed\b/i, "")
    .replace(/\bas\s+irregular\b/i, "")
    .replace(/\brecurring(?:\s+income|\s+revenue)?\b/i, "")
    .replace(/\bvariable(?:\s+(?:income|earnings))?\b/i, "")
    .replace(/\bfixed\b/i, "")
    .replace(/\birregular\b/i, "")
    .trim();

  return { name: withoutAsType || payload, type: typeFromWhole };
};

const parseExpenseAddPayload = (rawPayload) => {
  const payload = rawPayload.trim();
  const typeFromWhole = normalizeExpenseType(payload);

  if (!typeFromWhole) {
    return { name: payload, type: "Recurring Expense" };
  }

  const withoutAsType = payload
    .replace(/\bas\s+recurring(?:\s+expense)?\b/i, "")
    .replace(/\bas\s+variable(?:\s+expense)?\b/i, "")
    .replace(/\bas\s+fixed\b/i, "")
    .replace(/\bas\s+irregular\b/i, "")
    .replace(/\brecurring(?:\s+expense)?\b/i, "")
    .replace(/\bvariable(?:\s+expense)?\b/i, "")
    .replace(/\bfixed\b/i, "")
    .replace(/\birregular\b/i, "")
    .replace(/\bcost\b/i, "")
    .trim();

  return { name: withoutAsType || payload, type: typeFromWhole };
};

const extractSourceNameFromIncomePayload = (payload) => {
  const quoted = payload.match(/["']([^"']+)["']/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const cleaned = payload
    .replace(/\bfor\s+(personal|company)\b/gi, " ")
    .replace(/\bas\s+(recurring|variable)(?:\s+(?:income|earnings|revenue))?\b/gi, " ")
    .replace(/\b(recurring|variable|fixed|irregular)(?:\s+(?:income|earnings|revenue))?\b/gi, " ")
    .replace(/\bin\s+[a-z0-9][a-z0-9 _-]{1,79}\s+(?:workspace|company)\b/gi, " ")
    .replace(/\b(?:workspace|company)\s*:\s*[a-z0-9][a-z0-9 _-]{1,79}\b/gi, " ")
    .replace(/(?:\bon\b|\bdate\b)\s*[:=]?\s*\d{4}-\d{2}-\d{2}/gi, " ")
    .replace(/\b(?:amount|tk|bdt|usd|\$)\s*[:=]?\s*[0-9]+(?:,[0-9]{3})*(?:\.\d+)?\b/gi, " ")
    .replace(/\b[0-9]+(?:,[0-9]{3})*(?:\.\d+)?\b/g, " ")
    .replace(/\b(i|we|got|received|receive|earned|earning|please|add|save|store|log|this|that|my)\b/gi, " ")
    .replace(/\b(to|from|for|source|category|income|entry|record|into)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
};

const extractCategoryNameFromExpensePayload = (payload) => {
  const quoted = payload.match(/["']([^"']+)["']/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const cleaned = payload
    .replace(/\bfor\s+(personal|company)\b/gi, " ")
    .replace(/\bas\s+(recurring|variable)(?:\s+expense)?\b/gi, " ")
    .replace(/\b(recurring|variable|fixed|irregular)(?:\s+expense)?\b/gi, " ")
    .replace(/\bin\s+[a-z0-9][a-z0-9 _-]{1,79}\s+(?:workspace|company)\b/gi, " ")
    .replace(/\b(?:workspace|company)\s*:\s*[a-z0-9][a-z0-9 _-]{1,79}\b/gi, " ")
    .replace(/(?:\bon\b|\bdate\b)\s*[:=]?\s*\d{4}-\d{2}-\d{2}/gi, " ")
    .replace(/\b(?:amount|tk|bdt|usd|\$)\s*[:=]?\s*[0-9]+(?:,[0-9]{3})*(?:\.\d+)?\b/gi, " ")
    .replace(/\b[0-9]+(?:,[0-9]{3})*(?:\.\d+)?\b/g, " ")
    .replace(/\b(i|we|spent|spend|paid|pay|please|add|save|store|log|this|that|my)\b/gi, " ")
    .replace(/\b(to|from|for|category|expense|entry|record|into)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
};

const resolveWorkspaceForIncome = async ({ userId, workspaceHint, profile }) => {
  const workspaces = await Workspace.find({ userId }).sort({ createdAt: 1 }).select("name normalizedName").lean();

  if (!workspaces.length) {
    return {
      workspaceName: "",
      error: "You do not have any workspace yet. Add one first using: add company <name>."
    };
  }

  if (workspaceHint) {
    const matched = findWorkspaceByHint(workspaces, workspaceHint);
    if (matched) {
      return { workspaceName: matched.name, error: "" };
    }

    return {
      workspaceName: "",
      error: `I could not find workspace \"${workspaceHint}\". Please check the name.`
    };
  }

  if (profile) {
    const profileHint = profile.toLowerCase();
    const preferred = workspaces.find((item) => item.name.toLowerCase().includes(profileHint));
    if (preferred) {
      return { workspaceName: preferred.name, error: "" };
    }
  }

  return { workspaceName: workspaces[0].name, error: "" };
};

const resolveIncomeSourceForEntry = async ({ userId, sourceName, profile, incomeNature }) => {
  const normalizedName = sourceName.trim().toLowerCase();

  const strictFilter = {
    userId,
    normalizedName,
    ...(profile ? { profile } : {}),
    ...(incomeNature ? { type: incomeNature } : {})
  };

  let candidates = await IncomeSource.find(strictFilter).select("_id name type profile normalizedName").lean();

  if (!candidates.length) {
    candidates = await IncomeSource.find({ userId, normalizedName })
      .select("_id name type profile normalizedName")
      .lean();
  }

  if (!candidates.length) {
    const allByUser = await IncomeSource.find({ userId }).select("_id name type profile normalizedName").lean();
    candidates = allByUser.filter(
      (item) => item.normalizedName.includes(normalizedName) || normalizedName.includes(item.normalizedName)
    );
  }

  if (!candidates.length) {
    return {
      source: null,
      error: `I could not find income category \"${sourceName}\". Create it first from Settings or say: add income source ${sourceName} as Recurring Income.`
    };
  }

  if (profile) {
    const byProfile = candidates.filter((item) => item.profile === profile);
    if (byProfile.length) {
      candidates = byProfile;
    }
  }

  if (incomeNature) {
    const byType = candidates.filter((item) => item.type === incomeNature);
    if (byType.length) {
      candidates = byType;
    }
  }

  if (candidates.length > 1) {
    const options = candidates.map((item) => `${item.name} (${item.type}, ${item.profile})`).join("; ");
    return {
      source: null,
      error: `I found multiple matching income categories. Please be specific with profile/type. Matches: ${options}`
    };
  }

  return { source: candidates[0], error: "" };
};

const resolveExpenseCategoryForEntry = async ({ userId, categoryName, profile, expenseType }) => {
  const normalizedName = categoryName.trim().toLowerCase();

  const strictFilter = {
    userId,
    normalizedName,
    ...(profile ? { profile } : {}),
    ...(expenseType ? { type: expenseType } : {})
  };

  let candidates = await ExpenseCategory.find(strictFilter)
    .select("_id name type profile normalizedName")
    .lean();

  if (!candidates.length) {
    candidates = await ExpenseCategory.find({ userId, normalizedName })
      .select("_id name type profile normalizedName")
      .lean();
  }

  if (!candidates.length) {
    const allByUser = await ExpenseCategory.find({ userId })
      .select("_id name type profile normalizedName")
      .lean();
    candidates = allByUser.filter(
      (item) => item.normalizedName.includes(normalizedName) || normalizedName.includes(item.normalizedName)
    );
  }

  if (!candidates.length) {
    return {
      category: null,
      error: `I could not find expense category "${categoryName}". Create it first from Settings or say: add expense category ${categoryName} as Recurring Expense.`
    };
  }

  if (profile) {
    const byProfile = candidates.filter((item) => item.profile === profile);
    if (byProfile.length) {
      candidates = byProfile;
    }
  }

  if (expenseType) {
    const byType = candidates.filter((item) => item.type === expenseType);
    if (byType.length) {
      candidates = byType;
    }
  }

  if (candidates.length > 1) {
    const options = candidates.map((item) => `${item.name} (${item.type}, ${item.profile})`).join("; ");
    return {
      category: null,
      error: `I found multiple matching expense categories. Please be specific with profile/type. Matches: ${options}`
    };
  }

  return { category: candidates[0], error: "" };
};

const handleWorkspaceIntent = async ({ userId, text, normalizedText, context }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here. I will take care of the rest.";
  }

  const workspaces = await Workspace.find({ userId }).sort({ createdAt: 1 }).select("name normalizedName").lean();

  const isListIntent =
    normalizedText === "list company" ||
    normalizedText === "list companies" ||
    normalizedText === "list workspace" ||
    normalizedText === "list workspaces";

  if (isListIntent) {
    if (!workspaces.length) {
      return "You do not have any company yet. Send 'add company <name>' and I will create it for you.";
    }

    const lines = workspaces.map((workspace, index) => `${index + 1}. ${workspace.name}`);
    return `Your companies:\n${lines.join("\n")}`;
  }

  const isCurrentWorkspaceIntent =
    /^(my\s+)?current\s+(workspace|company|profile)\b/i.test(text) ||
    /^which\s+(workspace|company|profile)\b/i.test(text);
  if (isCurrentWorkspaceIntent) {
    const current = context?.activeWorkspaceName
      ? findWorkspaceByHint(workspaces, context.activeWorkspaceName)
      : workspaces[0] || null;

    if (!current) {
      return "You do not have any workspace yet. Add one first using: add company <name>.";
    }

    const profileLabel = context?.activeProfile ? ` (${context.activeProfile} profile)` : "";
    return `You're currently in the ${current.name} workspace${profileLabel}. What would you like to do next?`;
  }

  const isCompanyProfileSwitch =
    /\b(switch|change|use)\b[\s\S]*\b(company|business|professional)\b(?:[\s\S]*\b(profile|account)\b)?/i.test(text) ||
    /\b(company|business|professional)\b[\s\S]*\b(profile|account)\b/i.test(text);
  if (isCompanyProfileSwitch) {
    if (!workspaces.length) {
      return "You do not have any workspace yet. Add one first using: add company <name>.";
    }

    if (workspaces.length === 1) {
      await updateAgentContext(userId, {
        activeProfile: "Company",
        activeWorkspaceName: workspaces[0].name,
        pendingWorkspaceSwitch: false
      });
      return `Done. Company profile is active now. You're in ${workspaces[0].name} workspace.`;
    }

    await updateAgentContext(userId, {
      activeProfile: "Company",
      pendingWorkspaceSwitch: true
    });
    const options = workspaces.map((item) => `"${item.name}"`).join(" or ");
    return `Which company account would you like to switch to? Your options are ${options}.`;
  }

  const isPersonalProfileSwitch =
    /\b(switch|change|use)\b[\s\S]*\b(personal|private)\b(?:[\s\S]*\b(profile|account)\b)?/i.test(text) ||
    /\b(personal|private)\b[\s\S]*\b(profile|account)\b/i.test(text);
  if (isPersonalProfileSwitch) {
    if (!workspaces.length) {
      return "You do not have any workspace yet. Add one first using: add company <name>.";
    }

    if (workspaces.length === 1) {
      await updateAgentContext(userId, {
        activeProfile: "Personal",
        activeWorkspaceName: workspaces[0].name,
        pendingWorkspaceSwitch: false
      });
      return `Done. Personal profile is active now. You're in ${workspaces[0].name} workspace.`;
    }

    await updateAgentContext(userId, {
      activeProfile: "Personal",
      pendingWorkspaceSwitch: true
    });
    const options = workspaces.map((item) => `"${item.name}"`).join(" or ");
    return `Which personal account would you like to switch to? Your options are ${options}.`;
  }

  const switchWithNameMatch = text.match(
    /^(?:switch|change|use)\s+(?:to\s+)?([a-z0-9][a-z0-9 _-]{1,79})(?:\s+(?:workspace|company))?$/i
  );
  const pendingSwitch = Boolean(context?.pendingWorkspaceSwitch);
  const directNameCandidate = pendingSwitch ? text.trim() : "";
  const switchNameCandidate = switchWithNameMatch?.[1]?.trim() || directNameCandidate;

  if (switchNameCandidate) {
    const matched = findWorkspaceByHint(workspaces, switchNameCandidate);
    if (!matched) {
      if (pendingSwitch) {
        return `I could not find workspace "${switchNameCandidate}". Please send the exact company name.`;
      }
    } else {
      const profileFromText = normalizeProfile(text);
      const nextProfile = profileFromText || context?.activeProfile || null;

      await updateAgentContext(userId, {
        activeWorkspaceName: matched.name,
        activeProfile: nextProfile,
        pendingWorkspaceSwitch: false
      });

      const profileLabel = nextProfile ? ` (${nextProfile} profile)` : "";
      return `You're now switched to the ${matched.name} workspace${profileLabel}. How can I assist you further?`;
    }
  }

  const addMatch = text.match(/^(add|create)\s+(company|workspace)\s+(.+)$/i);
  if (addMatch) {
    const name = addMatch[3].trim();
    const normalizedName = name.toLowerCase();
    const exists = await Workspace.findOne({ userId, normalizedName });
    if (exists) {
      return `You already have this company: ${exists.name}. Want me to add another one?`;
    }

    const created = await Workspace.create({ userId, name, normalizedName });
    return `Done. I created \"${created.name}\" for you.`;
  }

  return null;
};

const handleIncomeSourceIntent = async ({ userId, text, normalizedText, context }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here.";
  }

  const isListSourceIntent =
    normalizedText === "list income source" ||
    normalizedText === "list income sources" ||
    normalizedText === "list income category" ||
    normalizedText === "list income categories";

  if (isListSourceIntent) {
    const profileFilter = normalizeProfile(text) || context?.activeProfile || "";
    const typeFilter = normalizeIncomeType(text);
    const sources = await IncomeSource.find({
      userId,
      ...(profileFilter ? { profile: profileFilter } : {}),
      ...(typeFilter ? { type: typeFilter } : {})
    })
      .sort({ createdAt: -1 })
      .select("name type profile");

    if (!sources.length) {
      return "You do not have any income source yet. Send: add income source Salary as Recurring Income for Personal";
    }

    const lines = sources.map(
      (item, index) => `${index + 1}. ${item.name} (${item.type}, ${item.profile})`
    );
    return `Your income categories:\n${lines.join("\n")}`;
  }

  const addSourceMatch = text.match(/^(add|create)\s+income\s+(source|category)\s+(.+)$/i);
  const naturalAddSourceIntent =
    /\b(add|create)\b/i.test(text) &&
    /\bincome\b/i.test(text) &&
    /\b(source|category)\b/i.test(text);
  if (addSourceMatch || naturalAddSourceIntent) {
    const rawPayload = addSourceMatch?.[3]?.trim() ||
      text
        .replace(/\b(add|create)\b/gi, " ")
        .replace(/\bincome\b/gi, " ")
        .replace(/\b(source|category)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    const profileMatch = rawPayload.match(/\bfor\s+(personal|company)\b/i);
    const payloadWithoutProfile = profileMatch
      ? rawPayload.replace(/\bfor\s+(personal|company)\b/i, "").trim()
      : rawPayload;

    const parsed = parseIncomeAddPayload(payloadWithoutProfile);
    const name = parsed.name.trim();
    const type = parsed.type;
    const profile = profileMatch?.[1]
      ? profileMatch[1].toLowerCase() === "company"
        ? "Company"
        : "Personal"
      : context?.activeProfile || "Personal";

    if (!name || name.length < 2) {
      return "Please provide a valid income source name. Example: add income source Salary as Recurring Income for Personal";
    }

    const normalizedName = name.toLowerCase();
    const normalizedProfile = profile.toLowerCase();
    const existing = await IncomeSource.findOne({ userId, normalizedName, normalizedProfile, type });
    if (existing) {
      return `You already have this income source: ${existing.name} (${existing.type}) in ${existing.profile}.`;
    }

    try {
      const created = await IncomeSource.create({
        userId,
        name,
        type,
        profile,
        normalizedProfile,
        normalizedName
      });
      return `Done. I added \"${created.name}\" as ${created.type} under ${created.profile}.`;
    } catch (error) {
      if (error?.code === 11000) {
        return `You already have this income source: ${name} (${type}) in ${profile}.`;
      }
      return "I could not create that income category due to a temporary server issue. Please try again.";
    }
  }

  return null;
};

const handleExpenseCategoryIntent = async ({ userId, text, normalizedText, context }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here.";
  }

  const isListCategoryIntent =
    /^(list|show|get|view)\s+expense\s+(source|sources|category|categories)\b/i.test(text) ||
    normalizedText === "expense categories";

  if (isListCategoryIntent) {
    const profileFilter = normalizeProfile(text) || context?.activeProfile || "";
    const typeFilter = normalizeExpenseType(text);
    const categories = await ExpenseCategory.find({
      userId,
      ...(profileFilter ? { profile: profileFilter } : {}),
      ...(typeFilter ? { type: typeFilter } : {})
    })
      .sort({ createdAt: -1 })
      .select("name type profile");

    if (!categories.length) {
      return "You do not have any expense category yet. Send: add expense category Rent as Recurring Expense for Personal";
    }

    const lines = categories.map(
      (item, index) => `${index + 1}. ${item.name} (${item.type}, ${item.profile})`
    );
    return `Your expense categories:\n${lines.join("\n")}`;
  }

  const addCategoryMatch = text.match(/^(add|create)\s+expense\s+(source|category)\s+(.+)$/i);
  const naturalAddCategoryIntent =
    /\b(add|create)\b/i.test(text) &&
    /\bexpense\b/i.test(text) &&
    /\b(source|category)\b/i.test(text);
  if (addCategoryMatch || naturalAddCategoryIntent) {
    const rawPayload = addCategoryMatch?.[3]?.trim() ||
      text
        .replace(/\b(add|create)\b/gi, " ")
        .replace(/\bexpense\b/gi, " ")
        .replace(/\b(source|category)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    const profileMatch = rawPayload.match(/\bfor\s+(personal|company)\b/i);
    const payloadWithoutProfile = profileMatch
      ? rawPayload.replace(/\bfor\s+(personal|company)\b/i, "").trim()
      : rawPayload;

    const parsed = parseExpenseAddPayload(payloadWithoutProfile);
    const name = parsed.name.trim();
    const type = parsed.type;
    const profile = profileMatch?.[1]
      ? profileMatch[1].toLowerCase() === "company"
        ? "Company"
        : "Personal"
      : context?.activeProfile || "Personal";

    if (!name || name.length < 2) {
      return "Please provide a valid expense category name. Example: add expense category Rent as Recurring Expense for Personal";
    }

    const normalizedName = name.toLowerCase();
    const normalizedProfile = profile.toLowerCase();
    const existing = await ExpenseCategory.findOne({ userId, normalizedName, normalizedProfile, type });
    if (existing) {
      return `You already have this expense category: ${existing.name} (${existing.type}) in ${existing.profile}.`;
    }

    try {
      const created = await ExpenseCategory.create({
        userId,
        name,
        type,
        profile,
        normalizedProfile,
        normalizedName
      });
      return `Done. I added "${created.name}" as ${created.type} under ${created.profile}.`;
    } catch (error) {
      if (error?.code === 11000) {
        return `You already have this expense category: ${name} (${type}) in ${profile}.`;
      }
      return "I could not create that expense category due to a temporary server issue. Please try again.";
    }
  }

  return null;
};

const handleIncomeEntryIntent = async ({ userId, text, normalizedText, context }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here.";
  }

  const mentionsSourceOrCategory = /income\s+(source|category)/i.test(text);

  const isListIncomeIntent =
    !mentionsSourceOrCategory && isIncomeListIntent(text, normalizedText);

  if (isListIncomeIntent) {
    const profile = normalizeProfile(text) || context?.activeProfile || "";
    const workspaceHint = parseWorkspaceHint(text) || context?.activeWorkspaceName || "";
    const parsedRange = parseIncomeDateRange(text);

    let workspaceName = "";
    if (workspaceHint) {
      const workspaceResult = await resolveWorkspaceForIncome({ userId, workspaceHint, profile });
      if (workspaceResult.error) return workspaceResult.error;
      workspaceName = workspaceResult.workspaceName;
    }

    await ensureRecurringEntriesForScope({
      userId,
      workspaceName: workspaceName || undefined,
      profile: profile || undefined
    });

    const filter = {
      userId,
      ...(workspaceName ? { workspaceName } : {}),
      ...(profile ? { profile } : {})
    };

    if (parsedRange) {
      filter.entryDate = { $gte: parsedRange.start, $lt: parsedRange.endExclusive };
    }

    const entries = await IncomeEntry.find(filter)
      .sort({ entryDate: -1, createdAt: -1 })
      .limit(parsedRange ? 120 : 20)
      .select("incomeSourceName incomeNature amount profile workspaceName entryDate")
      .lean();

    if (!entries.length) {
      return "I checked that filter, but I could not find any income entries.";
    }

    const total = entries.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const shownEntries = entries.slice(0, 10);
    const lines = shownEntries.map(
      (item, index) =>
        `${index + 1}) ${item.incomeSourceName} - ${item.incomeNature}, ${formatCurrency(item.amount)} on ${formatHumanDate(item.entryDate)} (${item.profile}, ${item.workspaceName})`
    );
    const hiddenCount = Math.max(0, entries.length - shownEntries.length);
    const scopeText = buildSummaryScopeText({ workspaceName, profile, parsedRange });

    return [
      `Here is your income summary ${scopeText}.`,
      `I found ${toCountLabel(entries.length, "entry", "entries")} with a total of ${formatCurrency(total)}.`,
      "Latest items:",
      ...lines,
      hiddenCount > 0 ? `...and ${hiddenCount} more entries.` : "",
      "If you want, I can also break this down by category."
    ]
      .filter(Boolean)
      .join("\n");
  }

  const strictAddIncomeIntent = /^(add|create|record)\s+income\b/i.test(text);
  const naturalAddIncomeIntent = isNaturalAddIncomeIntent(text, normalizedText);
  const isAddIncomeIntent =
    !mentionsSourceOrCategory && (strictAddIncomeIntent || naturalAddIncomeIntent);

  if (isAddIncomeIntent) {
    const addMatch = text.match(/^(add|create|record)\s+income(?:\s+entry)?\s+(.+)$/i);
    if (strictAddIncomeIntent && !addMatch?.[2]) {
      return "Please provide income details. Example: add income 50000 salary for personal in facebook workspace";
    }

    const payload = addMatch?.[2]?.trim() || text.trim();
    const profile = normalizeProfile(payload) || context?.activeProfile || "";
    const incomeNature = normalizeIncomeType(payload);
    const workspaceHint = parseWorkspaceHint(payload) || context?.activeWorkspaceName || "";
    const entryDate = parseDateHint(payload) || new Date().toISOString().slice(0, 10);

    const payloadWithoutDate = payload
      .replace(/(?:\bon\b|\bdate\b)\s*[:=]?\s*\d{4}-\d{2}-\d{2}/gi, " ")
      .replace(/\btoday\b/gi, " ")
      .replace(/\b(?:add|create|record|save|store|log)\b/gi, " ")
      .replace(/\b(?:this|that|my)\b/gi, " ");

    const amount = parseAmountHint(payloadWithoutDate);
    if (!amount) {
      return "Please provide a valid income amount. Example: add income 50000 salary";
    }

    const inferredSource = await inferIncomeSourceNameFromKnownSources({
      userId,
      text: payloadWithoutDate,
      profile,
      incomeNature
    });
    const sourceName = inferredSource || extractSourceNameFromIncomePayload(payloadWithoutDate);
    if (!sourceName || sourceName.length < 2) {
      return "Please provide the income category name. Example: add income 50000 salary";
    }

    const workspaceResult = await resolveWorkspaceForIncome({ userId, workspaceHint, profile });
    if (workspaceResult.error) {
      return workspaceResult.error;
    }

    const sourceResult = await resolveIncomeSourceForEntry({
      userId,
      sourceName,
      profile,
      incomeNature
    });
    if (sourceResult.error) {
      return sourceResult.error;
    }

    const source = sourceResult.source;
    const finalProfile = source.profile;
    const finalNature = incomeNature || source.type;

    if (incomeNature && source.type !== incomeNature) {
      return `The income category \"${source.name}\" is ${source.type}. Please pick a ${incomeNature} category or use ${source.type}.`;
    }

    const dateObj = new Date(entryDate);
    if (Number.isNaN(dateObj.getTime())) {
      return "Please provide date in YYYY-MM-DD format.";
    }

    const monthKey = toMonthKey(dateObj);

    let entry = null;
    if (finalNature === "Recurring Income") {
      entry = await IncomeEntry.findOneAndUpdate(
        {
          userId,
          workspaceName: workspaceResult.workspaceName,
          profile: finalProfile,
          incomeSourceId: source._id,
          incomeNature: "Recurring Income",
          monthKey
        },
        {
          $set: {
            incomeSourceName: source.name,
            amount,
            entryDate: dateObj,
            monthKey
          }
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true
        }
      );
    } else {
      entry = await IncomeEntry.create({
        userId,
        workspaceName: workspaceResult.workspaceName,
        profile: finalProfile,
        incomeSourceId: source._id,
        incomeSourceName: source.name,
        incomeNature: finalNature,
        amount,
        entryDate: dateObj,
        monthKey
      });
    }

    await updateAgentContext(userId, {
      activeWorkspaceName: entry.workspaceName,
      activeProfile: entry.profile,
      pendingWorkspaceSwitch: false
    });

    return `Done. Added $${Number(entry.amount).toFixed(2)} for \"${entry.incomeSourceName}\" (${entry.incomeNature}) in ${entry.workspaceName} (${entry.profile}) on ${toIsoDate(entry.entryDate)}.`;
  }

  return null;
};

const isExpenseListIntent = (text, normalizedText) => {
  const lowerRaw = (text || "").toLowerCase();
  const lower = normalizeLocalizedText(lowerRaw);

  const classicIntent =
    /^(list|show|get|view)\s+expenses?\b/i.test(text) ||
    /^(list|show|get|view)\s+expense\s+(entries|history|summary)\b/i.test(text) ||
    /^expense\s+summary\b/i.test(text);
  if (classicIntent) return true;

  const mentionsExpense = /\bexpense\b/.test(lower);
  if (!mentionsExpense) return false;

  const asksForData =
    /\b(list|show|get|view|give|fetch)\b/.test(lower) ||
    /(last|past|month|from|between|to|date|day|days|\d{4}-\d{2}-\d{2})/.test(lower);

  if (!asksForData) return false;

  const addIntent = /^(add|create|record)\s+expense\b/i.test(normalizedText || "");
  return !addIntent;
};

const handleExpenseEntryIntent = async ({ userId, text, normalizedText, context }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here.";
  }

  const mentionsSourceOrCategory = /expense\s+(source|category)/i.test(text);

  const isListExpenseIntent =
    !mentionsSourceOrCategory && isExpenseListIntent(text, normalizedText);

  if (isListExpenseIntent) {
    const profile = normalizeProfile(text) || context?.activeProfile || "";
    const workspaceHint = parseWorkspaceHint(text) || context?.activeWorkspaceName || "";
    const parsedRange = parseIncomeDateRange(text);

    let workspaceName = "";
    if (workspaceHint) {
      const workspaceResult = await resolveWorkspaceForIncome({ userId, workspaceHint, profile });
      if (workspaceResult.error) return workspaceResult.error;
      workspaceName = workspaceResult.workspaceName;
    }

    const filter = {
      userId,
      ...(workspaceName ? { workspaceName } : {}),
      ...(profile ? { profile } : {})
    };

    if (parsedRange) {
      filter.entryDate = { $gte: parsedRange.start, $lt: parsedRange.endExclusive };
    }

    const entries = await ExpenseEntry.find(filter)
      .sort({ entryDate: -1, createdAt: -1 })
      .limit(parsedRange ? 120 : 20)
      .select("category expenseType amount profile workspaceName entryDate")
      .lean();

    if (!entries.length) {
      return "I checked that filter, but I could not find any expense entries.";
    }

    const total = entries.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const shownEntries = entries.slice(0, 10);
    const lines = shownEntries.map(
      (item, index) =>
        `${index + 1}) ${item.category} - ${item.expenseType}, ${formatCurrency(item.amount)} on ${formatHumanDate(item.entryDate)} (${item.profile}, ${item.workspaceName})`
    );
    const hiddenCount = Math.max(0, entries.length - shownEntries.length);
    const scopeText = buildSummaryScopeText({ workspaceName, profile, parsedRange });

    return [
      `Here is your expense summary ${scopeText}.`,
      `I found ${toCountLabel(entries.length, "entry", "entries")} with a total of ${formatCurrency(total)}.`,
      "Latest items:",
      ...lines,
      hiddenCount > 0 ? `...and ${hiddenCount} more entries.` : "",
      "If you want, I can group this by category or date."
    ]
      .filter(Boolean)
      .join("\n");
  }

  const strictAddExpenseIntent = /^(add|create|record)\s+expense\b/i.test(text);
  const naturalAddExpenseIntent = isNaturalAddExpenseIntent(text, normalizedText);
  const isAddExpenseIntent =
    !mentionsSourceOrCategory && (strictAddExpenseIntent || naturalAddExpenseIntent);

  if (isAddExpenseIntent) {
    const addMatch = text.match(/^(add|create|record)\s+expense(?:\s+entry)?\s+(.+)$/i);
    if (strictAddExpenseIntent && !addMatch?.[2]) {
      return "Please provide expense details. Example: add expense 1200 rent for personal in facebook workspace";
    }

    const payload = addMatch?.[2]?.trim() || text.trim();
    const profile = normalizeProfile(payload) || context?.activeProfile || "";
    const expenseType = normalizeExpenseType(payload);
    const workspaceHint = parseWorkspaceHint(payload) || context?.activeWorkspaceName || "";
    const entryDate = parseDateHint(payload) || new Date().toISOString().slice(0, 10);

    const payloadWithoutDate = payload
      .replace(/(?:\bon\b|\bdate\b)\s*[:=]?\s*\d{4}-\d{2}-\d{2}/gi, " ")
      .replace(/\btoday\b/gi, " ")
      .replace(/\b(?:add|create|record|save|store|log)\b/gi, " ")
      .replace(/\b(?:this|that|my)\b/gi, " ");

    const amount = parseAmountHint(payloadWithoutDate);
    if (!amount) {
      return "Please provide a valid expense amount. Example: add expense 1200 rent";
    }

    const inferredCategory = await inferExpenseCategoryNameFromKnownCategories({
      userId,
      text: payloadWithoutDate,
      profile,
      expenseType
    });
    const categoryName = inferredCategory || extractCategoryNameFromExpensePayload(payloadWithoutDate);
    if (!categoryName || categoryName.length < 2) {
      return "Please provide the expense category name. Example: add expense 1200 rent";
    }

    const workspaceResult = await resolveWorkspaceForIncome({ userId, workspaceHint, profile });
    if (workspaceResult.error) {
      return workspaceResult.error;
    }

    const categoryResult = await resolveExpenseCategoryForEntry({
      userId,
      categoryName,
      profile,
      expenseType
    });
    if (categoryResult.error) {
      return categoryResult.error;
    }

    const category = categoryResult.category;
    const finalProfile = category.profile;
    const finalType = expenseType || category.type;

    if (expenseType && category.type !== expenseType) {
      return `The expense category "${category.name}" is ${category.type}. Please pick a ${expenseType} category or use ${category.type}.`;
    }

    const dateObj = new Date(entryDate);
    if (Number.isNaN(dateObj.getTime())) {
      return "Please provide date in YYYY-MM-DD format.";
    }

    const monthKey = toMonthKey(dateObj);
    let entry = null;
    if (finalType === "Recurring Expense") {
      entry = await ExpenseEntry.findOneAndUpdate(
        {
          userId,
          workspaceName: workspaceResult.workspaceName,
          profile: finalProfile,
          expenseCategoryId: category._id,
          expenseType: "Recurring Expense",
          monthKey
        },
        {
          $set: {
            category: category.name,
            normalizedCategory: category.name.toLowerCase(),
            amount,
            entryDate: dateObj,
            monthKey
          }
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true
        }
      );
    } else {
      entry = await ExpenseEntry.create({
        userId,
        workspaceName: workspaceResult.workspaceName,
        profile: finalProfile,
        expenseCategoryId: category._id,
        expenseType: finalType,
        category: category.name,
        normalizedCategory: category.name.toLowerCase(),
        amount,
        entryDate: dateObj,
        monthKey
      });
    }

    await updateAgentContext(userId, {
      activeWorkspaceName: entry.workspaceName,
      activeProfile: entry.profile,
      pendingWorkspaceSwitch: false
    });

    return `Done. Added $${Number(entry.amount).toFixed(2)} expense for "${entry.category}" (${entry.expenseType}) in ${entry.workspaceName} (${entry.profile}) on ${toIsoDate(entry.entryDate)}.`;
  }

  return null;
};

const isFinancialSummaryIntent = (text) => {
  const lower = normalizeLocalizedText((text || "").toLowerCase());
  if (!lower) return false;

  if (/\b(financial|finance|money)\s+summary\b/.test(lower)) return true;
  if (/\b(total\s+income|income\s+total)\b/.test(lower) && /\b(total\s+expense|expense\s+total)\b/.test(lower)) {
    return true;
  }
  if (/\b(total\s+balance|net\s+balance|balance)\b/.test(lower)) {
    return true;
  }
  if (/\b(total\s+income|income\s+total|total\s+expense|expense\s+total)\b/.test(lower)) {
    return true;
  }
  if (/\b(total\s+income|total\s+expense|total\s+balance|balance)\b/.test(lower) && /\b(summary|overview|report|show|get|give)\b/.test(lower)) {
    return true;
  }

  return false;
};

const wantsCombinedIncomeAndFinancialSummary = (text) => {
  const lower = normalizeLocalizedText((text || "").toLowerCase());
  if (!lower) return false;

  const hasIncomeSummary =
    /\bincome\s+summary\b/.test(lower) || (/\bincome\b/.test(lower) && /\bsummary\b/.test(lower));
  const hasFinancialSummary = /\b(financial|finance|money)\s+summary\b/.test(lower);
  const isMutation = /\b(add|create|record|save|store|log|update|edit|delete|remove)\b/.test(lower);

  return hasIncomeSummary && hasFinancialSummary && !isMutation;
};

const resolveFinancialMetricIntent = (text) => {
  const lower = normalizeLocalizedText((text || "").toLowerCase());
  const asksIncome = /\b(total\s+income|income\s+total)\b/.test(lower);
  const asksExpense = /\b(total\s+expense|expense\s+total|total\s+expenses|expenses\s+total)\b/.test(lower);
  const asksBalance = /\b(total\s+balance|net\s+balance|balance)\b/.test(lower);

  const metricCount = Number(asksIncome) + Number(asksExpense) + Number(asksBalance);
  if (metricCount === 1) {
    if (asksIncome) return "income";
    if (asksExpense) return "expense";
    return "balance";
  }

  return "all";
};

const handleFinancialSummaryIntent = async ({ userId, text, context }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here.";
  }

  if (!isFinancialSummaryIntent(text)) {
    return null;
  }

  const profile = normalizeProfile(text) || context?.activeProfile || "";
  const workspaceHint = parseWorkspaceHint(text) || context?.activeWorkspaceName || "";
  const parsedRange = parseIncomeDateRange(text);

  let workspaceName = "";
  if (workspaceHint) {
    const workspaceResult = await resolveWorkspaceForIncome({ userId, workspaceHint, profile });
    if (workspaceResult.error) return workspaceResult.error;
    workspaceName = workspaceResult.workspaceName;
  }

  await ensureRecurringEntriesForScope({
    userId,
    workspaceName: workspaceName || undefined,
    profile: profile || undefined
  });

  const filter = {
    userId,
    ...(workspaceName ? { workspaceName } : {}),
    ...(profile ? { profile } : {})
  };

  if (parsedRange) {
    filter.entryDate = { $gte: parsedRange.start, $lt: parsedRange.endExclusive };
  }

  const [incomeAgg, expenseAgg] = await Promise.all([
    IncomeEntry.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]),
    ExpenseEntry.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ])
  ]);

  const totalIncome = Number(incomeAgg?.[0]?.total || 0);
  const incomeCount = Number(incomeAgg?.[0]?.count || 0);
  const totalExpense = Number(expenseAgg?.[0]?.total || 0);
  const expenseCount = Number(expenseAgg?.[0]?.count || 0);
  const balance = totalIncome - totalExpense;
  const metricIntent = resolveFinancialMetricIntent(text);
  const scopeText = buildSummaryScopeText({ workspaceName, profile, parsedRange });

  if (metricIntent === "income") {
    return `Your total income ${scopeText} is ${formatCurrency(totalIncome)} from ${toCountLabel(incomeCount, "entry", "entries")}.`;
  }

  if (metricIntent === "expense") {
    return `Your total expense ${scopeText} is ${formatCurrency(totalExpense)} from ${toCountLabel(expenseCount, "entry", "entries")}.`;
  }

  if (metricIntent === "balance") {
    const balanceTone =
      balance > 0
        ? "You are currently in a positive balance."
        : balance < 0
          ? "Right now your expenses are higher than your income."
          : "Right now your income and expense are balanced.";

    return [
      `Your net balance ${scopeText} is ${formatCurrency(balance)}.`,
      balanceTone
    ].join("\n");
  }

  const balanceTone =
    balance > 0
      ? "You are in a positive balance."
      : balance < 0
        ? "Expenses are currently higher than income."
        : "Income and expense are currently balanced.";

  return [
    `Here is your financial snapshot ${scopeText}:`,
    `Income: ${formatCurrency(totalIncome)} from ${toCountLabel(incomeCount, "entry", "entries")}.`,
    `Expense: ${formatCurrency(totalExpense)} from ${toCountLabel(expenseCount, "entry", "entries")}.`,
    `Net balance: ${formatCurrency(balance)}.`,
    balanceTone
  ].join("\n");
};

export const runAgentWorkflow = async ({ channel, userId, channelUserId, text, voiceFileId }) => {
  const normalizedText = (text || "").trim();
  const parserText = normalizeCommandLikeText(normalizedText);
  const lowerText = parserText.toLowerCase();
  const context = await getAgentContext(userId);

  await persistMessage({
    userId,
    channel,
    channelUserId,
    role: "user",
    text: normalizedText,
    voiceFileId,
    metadata: { source: channel }
  });

  let reply = "";

  if (!parserText && !voiceFileId) {
    reply = "I did not receive any message. Please send text or voice input.";
  } else if (hasBengaliText(parserText)) {
    reply = "Please send your message in English. I respond in English only.";
  } else if (!parserText && voiceFileId) {
    reply =
      "Voice message received. I can reply now, and you can later attach a speech-to-text provider to process full voice transcripts.";
  } else if (lowerText === "help" || parserText === "/help") {
    reply = helpText;
  } else {
    const combinedSummaryIntent = wantsCombinedIncomeAndFinancialSummary(parserText);
    if (combinedSummaryIntent) {
      const [incomeSummaryReply, financialSummaryReply] = await Promise.all([
        handleIncomeEntryIntent({
          userId,
          text: parserText,
          normalizedText: lowerText,
          context
        }),
        handleFinancialSummaryIntent({
          userId,
          text: parserText,
          context
        })
      ]);

      if (incomeSummaryReply && financialSummaryReply) {
        reply = `${incomeSummaryReply}\n\n${financialSummaryReply}`;
      } else {
        reply =
          incomeSummaryReply ||
          financialSummaryReply ||
          "I could not generate that combined summary. Please send: income summary, or financial summary.";
      }
    } else {
    const workspaceReply = await handleWorkspaceIntent({
      userId,
      text: parserText,
      normalizedText: lowerText,
      context
    });

    const incomeSourceReply = workspaceReply
      ? null
      : await handleIncomeSourceIntent({
          userId,
          text: parserText,
          normalizedText: lowerText,
          context
        });

    const financialSummaryReply = workspaceReply || incomeSourceReply
      ? null
      : await handleFinancialSummaryIntent({
          userId,
          text: parserText,
          context
        });

    const incomeEntryReply = workspaceReply || incomeSourceReply || financialSummaryReply
      ? null
      : await handleIncomeEntryIntent({
          userId,
          text: parserText,
          normalizedText: lowerText,
          context
        });

    const expenseCategoryReply = workspaceReply || incomeSourceReply || incomeEntryReply
      ? null
      : await handleExpenseCategoryIntent({
          userId,
          text: parserText,
          normalizedText: lowerText,
          context
        });

    const expenseEntryReply = workspaceReply || incomeSourceReply || incomeEntryReply || expenseCategoryReply
      ? null
      : await handleExpenseEntryIntent({
          userId,
          text: parserText,
          normalizedText: lowerText,
          context
        });

    const mutationHandled = Boolean(
      incomeSourceReply || incomeEntryReply || expenseCategoryReply || expenseEntryReply
    );

    if (workspaceReply) {
      reply = workspaceReply;
    } else if (incomeSourceReply) {
      reply = incomeSourceReply;
    } else if (financialSummaryReply) {
      reply = financialSummaryReply;
    } else if (incomeEntryReply) {
      reply = incomeEntryReply;
    } else if (expenseCategoryReply) {
      reply = expenseCategoryReply;
    } else if (expenseEntryReply) {
      reply = expenseEntryReply;
    } else {
      if (isLikelyMutationRequest(parserText)) {
        reply =
          "I could not safely execute that data change from this sentence. Please resend with amount + category clearly, for example: add income 3000 bonus for personal in facebook workspace.";
      } else {
        const history = await getRecentConversation({ userId, channelUserId });
        if (isAffirmativeOnlyText(parserText) && assistantAskedForMutationConfirmation(history)) {
          reply =
            "Thanks for confirming. To avoid mistakes, please send the full command in one line. Example: add expense category labour cost as Variable Expense.";
        } else if (isFinanceDomainRequest(parserText)) {
          reply =
            "I could not confidently map that finance request to a safe backend action. Please resend with clear fields like amount, type, category, profile, and workspace.";
        } else {
          const workspaces = userId ? await Workspace.find({ userId }).select("name").limit(10).lean() : [];
          const incomeSources = userId
            ? await IncomeSource.find({ userId }).select("name type profile").limit(10).lean()
            : [];
          const expenseCategories = userId
            ? await ExpenseCategory.find({ userId }).select("name type profile").limit(10).lean()
            : [];
          const workspaceHint = workspaces.length
            ? `User workspaces: ${workspaces.map((item) => item.name).join(", ")}.`
            : "User has no workspace data yet.";
          const incomeHint = incomeSources.length
            ? `Income categories: ${incomeSources.map((item) => `${item.name}(${item.type}, ${item.profile})`).join(", ")}.`
            : "User has no income category yet.";
          const expenseHint = expenseCategories.length
            ? `Expense categories: ${expenseCategories.map((item) => `${item.name}(${item.type}, ${item.profile})`).join(", ")}.`
            : "User has no expense category yet.";
          reply = await callLlmReply({
            text: parserText,
            history,
            workspaceHint: `${workspaceHint} ${incomeHint} ${expenseHint}`
          });

          if (!mutationHandled && hasUnsafeExecutionClaim(reply)) {
            reply =
              "I have not executed any database change from that message yet. Please send the action in one clear command with amount, type, and category.";
          }
        }
      }
    }
    }
  }

  if (hasBengaliText(reply)) {
    reply = "Please send your message in English. I respond in English only.";
  }

  await persistMessage({
    userId,
    channel,
    channelUserId,
    role: "assistant",
    text: reply,
    metadata: { source: channel }
  });

  return {
    reply,
    metadata: { channel, userId, channelUserId }
  };
};

export const getAgentHelpText = () => helpText;

