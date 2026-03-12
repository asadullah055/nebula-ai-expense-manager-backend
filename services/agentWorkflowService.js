import AgentMessage from "../models/AgentMessage.js";
import Workspace from "../models/Workspace.js";

const helpText = [
  "Available commands:",
  "1) help",
  "2) list companies",
  "3) add company <name>",
  "4) list workspaces",
  "5) add workspace <name>"
].join("\n");

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
  const rows = await AgentMessage.find(query).sort({ createdAt: -1 }).limit(8).lean();
  return rows.reverse();
};

const callLlmReply = async ({ text, history, workspaceHint }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return "I received your message. LLM is not configured yet. Set OPENAI_API_KEY to get human-like answers.";
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const systemPrompt =
    "You are a helpful finance assistant inside an expense tracker app. Reply naturally like a human, concise and practical.";

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
      return "I could not generate a smart answer right now. Please try again.";
    }

    const data = await response.json();
    return (data.output_text || "").trim() || "I understood. Please share a little more detail so I can help better.";
  } catch (_error) {
    return "I could not reach the AI service. Please try again in a moment.";
  }
};

const handleWorkspaceIntent = async ({ userId, normalizedText }) => {
  if (!userId) {
    return "Your Telegram chat is not linked with any app account yet. Use /link <code> first.";
  }

  const isListIntent =
    normalizedText === "list company" ||
    normalizedText === "list companies" ||
    normalizedText === "list workspace" ||
    normalizedText === "list workspaces";

  if (isListIntent) {
    const workspaces = await Workspace.find({ userId }).sort({ createdAt: 1 }).select("name");
    if (!workspaces.length) {
      return "You have no company yet. Use: add company <name>";
    }

    const lines = workspaces.map((workspace, index) => `${index + 1}. ${workspace.name}`);
    return `Your companies:\n${lines.join("\n")}`;
  }

  const addMatch = normalizedText.match(/^(add|create)\s+(company|workspace)\s+(.+)$/i);
  if (addMatch) {
    const name = addMatch[3].trim();
    const normalizedName = name.toLowerCase();
    const exists = await Workspace.findOne({ userId, normalizedName });
    if (exists) {
      return `Company already exists: ${exists.name}`;
    }

    const created = await Workspace.create({ userId, name, normalizedName });
    return `Company created: ${created.name}`;
  }

  return null;
};

export const runAgentWorkflow = async ({ channel, userId, channelUserId, text, voiceFileId }) => {
  const normalizedText = (text || "").trim();

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
  } else if (voiceFileId) {
    reply =
      "Voice message received. I can reply now, and you can later attach a speech-to-text provider to process full voice transcripts.";
  } else if (normalizedText.toLowerCase() === "help" || normalizedText === "/help") {
    reply = helpText;
  } else {
    const workspaceReply = await handleWorkspaceIntent({
      userId,
      normalizedText: normalizedText.toLowerCase()
    });

    if (workspaceReply) {
      reply = workspaceReply;
    } else {
      const workspaces = userId ? await Workspace.find({ userId }).select("name").limit(10).lean() : [];
      const workspaceHint = workspaces.length
        ? `User workspaces: ${workspaces.map((item) => item.name).join(", ")}`
        : "User has no workspace data yet.";
      const history = await getRecentConversation({ userId, channelUserId });
      reply = await callLlmReply({
        text: normalizedText,
        history,
        workspaceHint
      });
    }
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
