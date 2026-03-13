import AgentMessage from "../models/AgentMessage.js";
import ExpenseCategory from "../models/ExpenseCategory.js";
import ExpenseEntry from "../models/ExpenseEntry.js";
import IncomeEntry from "../models/IncomeEntry.js";
import IncomeSource from "../models/IncomeSource.js";
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

const callLlmReply = async ({ text, history, workspaceHint }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const quick = quickHumanReply(text);
    if (quick) return quick;
    return "I got your message. I can still help with app actions now. Try: list incomes, list expenses, add income <amount> <category>, or add expense <amount> <category>.";
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const systemPrompt = [
    "You are Nebula AI, a warm and natural assistant inside an expense manager.",
    "Reply like a real human teammate, not like a bot.",
    "Keep answers concise (2-5 lines), practical, and context-aware.",
    "Always respond only in English, even if the user writes in another language.",
    "Understand casual natural-language chat and respond conversationally.",
    "Do not show command lists unless asked. Prefer conversational style.",
    "You can mention app actions when useful (list/add company/workspace/income/expense)."
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
        temperature: 0.6,
        max_output_tokens: 280
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

const parseAmountHint = (text) => {
  if (!text) return null;

  const withLabel = text.match(/(?:\bamount\b|\btk\b|\bbdt\b|\busd\b|\$)\s*[:=]?\s*([0-9]+(?:,[0-9]{3})*(?:\.\d+)?)/i);
  if (withLabel?.[1]) {
    const value = Number(withLabel[1].replace(/,/g, ""));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const plainNumber = text.match(/\b([0-9]+(?:,[0-9]{3})*(?:\.\d+)?)\b/);
  if (plainNumber?.[1]) {
    const value = Number(plainNumber[1].replace(/,/g, ""));
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
    const hint = workspaceHint.trim().toLowerCase();
    const exact = workspaces.find(
      (item) => item.normalizedName === hint || item.name.toLowerCase() === hint
    );
    if (exact) {
      return { workspaceName: exact.name, error: "" };
    }

    const partial = workspaces.find((item) => item.name.toLowerCase().includes(hint));
    if (partial) {
      return { workspaceName: partial.name, error: "" };
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

const handleWorkspaceIntent = async ({ userId, text, normalizedText }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here. I will take care of the rest.";
  }

  const isListIntent =
    normalizedText === "list company" ||
    normalizedText === "list companies" ||
    normalizedText === "list workspace" ||
    normalizedText === "list workspaces";

  if (isListIntent) {
    const workspaces = await Workspace.find({ userId }).sort({ createdAt: 1 }).select("name");
    if (!workspaces.length) {
      return "You do not have any company yet. Send 'add company <name>' and I will create it for you.";
    }

    const lines = workspaces.map((workspace, index) => `${index + 1}. ${workspace.name}`);
    return `Your companies:\n${lines.join("\n")}`;
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

const handleIncomeSourceIntent = async ({ userId, text, normalizedText }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here.";
  }

  const isListSourceIntent =
    normalizedText === "list income source" ||
    normalizedText === "list income sources" ||
    normalizedText === "list income category" ||
    normalizedText === "list income categories";

  if (isListSourceIntent) {
    const profileFilter = normalizeProfile(text);
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
  if (addSourceMatch) {
    const rawPayload = addSourceMatch[3].trim();
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
      : "Personal";

    if (!name || name.length < 2) {
      return "Please provide a valid income source name. Example: add income source Salary as Recurring Income for Personal";
    }

    const normalizedName = name.toLowerCase();
    const normalizedProfile = profile.toLowerCase();
    const existing = await IncomeSource.findOne({ userId, normalizedName, normalizedProfile, type });
    if (existing) {
      return `You already have this income source: ${existing.name} (${existing.type}) in ${existing.profile}.`;
    }

    const created = await IncomeSource.create({ userId, name, type, profile, normalizedProfile, normalizedName });
    return `Done. I added \"${created.name}\" as ${created.type} under ${created.profile}.`;
  }

  return null;
};

const handleExpenseCategoryIntent = async ({ userId, text, normalizedText }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here.";
  }

  const isListCategoryIntent =
    /^(list|show|get|view)\s+expense\s+(source|sources|category|categories)\b/i.test(text) ||
    normalizedText === "expense categories";

  if (isListCategoryIntent) {
    const profileFilter = normalizeProfile(text);
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
  if (addCategoryMatch) {
    const rawPayload = addCategoryMatch[3].trim();
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
      : "Personal";

    if (!name || name.length < 2) {
      return "Please provide a valid expense category name. Example: add expense category Rent as Recurring Expense for Personal";
    }

    const normalizedName = name.toLowerCase();
    const normalizedProfile = profile.toLowerCase();
    const existing = await ExpenseCategory.findOne({ userId, normalizedName, normalizedProfile, type });
    if (existing) {
      return `You already have this expense category: ${existing.name} (${existing.type}) in ${existing.profile}.`;
    }

    const created = await ExpenseCategory.create({ userId, name, type, profile, normalizedProfile, normalizedName });
    return `Done. I added "${created.name}" as ${created.type} under ${created.profile}.`;
  }

  return null;
};

const handleIncomeEntryIntent = async ({ userId, text, normalizedText }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here.";
  }

  const mentionsSourceOrCategory = /income\s+(source|category)/i.test(text);

  const isListIncomeIntent =
    !mentionsSourceOrCategory && isIncomeListIntent(text, normalizedText);

  if (isListIncomeIntent) {
    const profile = normalizeProfile(text);
    const workspaceHint = parseWorkspaceHint(text);
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
      return "No income entries found for this filter.";
    }

    const total = entries.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const lines = entries.map(
      (item, index) =>
        `${index + 1}. ${item.incomeSourceName} | ${item.incomeNature} | $${Number(item.amount).toFixed(2)} | ${item.profile} | ${item.workspaceName} | ${toIsoDate(item.entryDate)}`
    );
    const periodText = parsedRange ? `Period: ${parsedRange.label}\n` : "";

    return `${periodText}Income entries (showing ${entries.length}):\n${lines.join("\n")}\nTotal: $${total.toFixed(2)}`;
  }

  const isAddIncomeIntent =
    !mentionsSourceOrCategory && /^(add|create|record)\s+income\b/i.test(text);

  if (isAddIncomeIntent) {
    const addMatch = text.match(/^(add|create|record)\s+income(?:\s+entry)?\s+(.+)$/i);
    if (!addMatch?.[2]) {
      return "Please provide income details. Example: add income 50000 salary for personal in facebook workspace";
    }

    const payload = addMatch[2].trim();
    const profile = normalizeProfile(payload);
    const incomeNature = normalizeIncomeType(payload);
    const workspaceHint = parseWorkspaceHint(payload);
    const entryDate = parseDateHint(payload) || new Date().toISOString().slice(0, 10);

    const payloadWithoutDate = payload
      .replace(/(?:\bon\b|\bdate\b)\s*[:=]?\s*\d{4}-\d{2}-\d{2}/gi, " ")
      .replace(/\btoday\b/gi, " ");

    const amount = parseAmountHint(payloadWithoutDate);
    if (!amount) {
      return "Please provide a valid income amount. Example: add income 50000 salary";
    }

    const sourceName = extractSourceNameFromIncomePayload(payloadWithoutDate);
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

const handleExpenseEntryIntent = async ({ userId, text, normalizedText }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here.";
  }

  const mentionsSourceOrCategory = /expense\s+(source|category)/i.test(text);

  const isListExpenseIntent =
    !mentionsSourceOrCategory && isExpenseListIntent(text, normalizedText);

  if (isListExpenseIntent) {
    const profile = normalizeProfile(text);
    const workspaceHint = parseWorkspaceHint(text);
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
      return "No expense entries found for this filter.";
    }

    const total = entries.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const lines = entries.map(
      (item, index) =>
        `${index + 1}. ${item.category} | ${item.expenseType} | $${Number(item.amount).toFixed(2)} | ${item.profile} | ${item.workspaceName} | ${toIsoDate(item.entryDate)}`
    );
    const periodText = parsedRange ? `Period: ${parsedRange.label}\n` : "";

    return `${periodText}Expense entries (showing ${entries.length}):\n${lines.join("\n")}\nTotal: $${total.toFixed(2)}`;
  }

  const isAddExpenseIntent =
    !mentionsSourceOrCategory && /^(add|create|record)\s+expense\b/i.test(text);

  if (isAddExpenseIntent) {
    const addMatch = text.match(/^(add|create|record)\s+expense(?:\s+entry)?\s+(.+)$/i);
    if (!addMatch?.[2]) {
      return "Please provide expense details. Example: add expense 1200 rent for personal in facebook workspace";
    }

    const payload = addMatch[2].trim();
    const profile = normalizeProfile(payload);
    const expenseType = normalizeExpenseType(payload);
    const workspaceHint = parseWorkspaceHint(payload);
    const entryDate = parseDateHint(payload) || new Date().toISOString().slice(0, 10);

    const payloadWithoutDate = payload
      .replace(/(?:\bon\b|\bdate\b)\s*[:=]?\s*\d{4}-\d{2}-\d{2}/gi, " ")
      .replace(/\btoday\b/gi, " ");

    const amount = parseAmountHint(payloadWithoutDate);
    if (!amount) {
      return "Please provide a valid expense amount. Example: add expense 1200 rent";
    }

    const categoryName = extractCategoryNameFromExpensePayload(payloadWithoutDate);
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

    return `Done. Added $${Number(entry.amount).toFixed(2)} expense for "${entry.category}" (${entry.expenseType}) in ${entry.workspaceName} (${entry.profile}) on ${toIsoDate(entry.entryDate)}.`;
  }

  return null;
};

const isFinancialSummaryIntent = (text) => {
  const lower = normalizeLocalizedText((text || "").toLowerCase());
  if (!lower) return false;

  if (/^(financial|finance|money)\s+summary\b/.test(lower)) return true;
  if (/\b(total\s+income|income\s+total)\b/.test(lower) && /\b(total\s+expense|expense\s+total)\b/.test(lower)) {
    return true;
  }
  if (/\b(total\s+income|total\s+expense|total\s+balance|balance)\b/.test(lower) && /\b(summary|overview|report|show|get|give)\b/.test(lower)) {
    return true;
  }

  return false;
};

const handleFinancialSummaryIntent = async ({ userId, text }) => {
  if (!userId) {
    return "Your Telegram is not linked yet. Please generate a link code from Settings, then send /link <code> here.";
  }

  if (!isFinancialSummaryIntent(text)) {
    return null;
  }

  const profile = normalizeProfile(text);
  const workspaceHint = parseWorkspaceHint(text);
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

  const scope = [
    workspaceName ? `workspace: ${workspaceName}` : "",
    profile ? `profile: ${profile}` : "",
    parsedRange ? `period: ${parsedRange.label}` : "period: all time"
  ]
    .filter(Boolean)
    .join(" | ");

  return [
    `Financial summary (${scope})`,
    `- Total Income: $${totalIncome.toFixed(2)} (${incomeCount} entries)`,
    `- Total Expense: $${totalExpense.toFixed(2)} (${expenseCount} entries)`,
    `- Net Balance: $${balance.toFixed(2)}`
  ].join("\n");
};

export const runAgentWorkflow = async ({ channel, userId, channelUserId, text, voiceFileId }) => {
  const normalizedText = (text || "").trim();
  const lowerText = normalizedText.toLowerCase();

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

  if (!normalizedText && !voiceFileId) {
    reply = "I did not receive any message. Please send text or voice input.";
  } else if (hasBengaliText(normalizedText)) {
    reply = "Please send your message in English. I respond in English only.";
  } else if (!normalizedText && voiceFileId) {
    reply =
      "Voice message received. I can reply now, and you can later attach a speech-to-text provider to process full voice transcripts.";
  } else if (lowerText === "help" || normalizedText === "/help") {
    reply = helpText;
  } else {
    const workspaceReply = await handleWorkspaceIntent({
      userId,
      text: normalizedText,
      normalizedText: lowerText
    });

    const incomeSourceReply = workspaceReply
      ? null
      : await handleIncomeSourceIntent({
          userId,
          text: normalizedText,
          normalizedText: lowerText
        });

    const financialSummaryReply = workspaceReply || incomeSourceReply
      ? null
      : await handleFinancialSummaryIntent({
          userId,
          text: normalizedText
        });

    const incomeEntryReply = workspaceReply || incomeSourceReply || financialSummaryReply
      ? null
      : await handleIncomeEntryIntent({
          userId,
          text: normalizedText,
          normalizedText: lowerText
        });

    const expenseCategoryReply = workspaceReply || incomeSourceReply || incomeEntryReply
      ? null
      : await handleExpenseCategoryIntent({
          userId,
          text: normalizedText,
          normalizedText: lowerText
        });

    const expenseEntryReply = workspaceReply || incomeSourceReply || incomeEntryReply || expenseCategoryReply
      ? null
      : await handleExpenseEntryIntent({
          userId,
          text: normalizedText,
          normalizedText: lowerText
        });

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
      const history = await getRecentConversation({ userId, channelUserId });
      reply = await callLlmReply({
        text: normalizedText,
        history,
        workspaceHint: `${workspaceHint} ${incomeHint} ${expenseHint}`
      });
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

