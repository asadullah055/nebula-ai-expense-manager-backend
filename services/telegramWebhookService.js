const TELEGRAM_API_BASE = "https://api.telegram.org";

const isPlaceholderSecret = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "your_webhook_secret" || normalized === "changeme";
};

const shouldUseSecret = (value) => {
  const trimmed = String(value || "").trim();
  return Boolean(trimmed) && !isPlaceholderSecret(trimmed);
};

export const ensureTelegramWebhookConfigured = async () => {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const webhookUrl = String(process.env.TELEGRAM_WEBHOOK_URL || "").trim();
  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();

  if (!token || !webhookUrl) {
    return;
  }

  try {
    const payload = { url: webhookUrl };
    if (shouldUseSecret(secret)) {
      payload.secret_token = secret;
    }

    const setWebhookResponse = await fetch(`${TELEGRAM_API_BASE}/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!setWebhookResponse.ok) {
      const bodyText = await setWebhookResponse.text();
      console.error("[Telegram] setWebhook failed:", setWebhookResponse.status, bodyText);
      return;
    }

    const infoResponse = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getWebhookInfo`);
    if (!infoResponse.ok) {
      const bodyText = await infoResponse.text();
      console.error("[Telegram] getWebhookInfo failed:", infoResponse.status, bodyText);
      return;
    }

    const infoJson = await infoResponse.json();
    const result = infoJson?.result || {};
    const webhookPath = result.url || webhookUrl;
    const pendingUpdates = Number(result.pending_update_count || 0);
    console.log(`[Telegram] Webhook ready: ${webhookPath} (pending updates: ${pendingUpdates})`);
  } catch (error) {
    console.error("[Telegram] Failed to ensure webhook:", error?.message || error);
  }
};

