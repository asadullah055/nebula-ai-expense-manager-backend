import app from "./app.js";
import { startRecurringEntriesScheduler } from "./services/recurringEntriesScheduler.js";
import { ensureTelegramWebhookConfigured } from "./services/telegramWebhookService.js";

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startRecurringEntriesScheduler();
  void ensureTelegramWebhookConfigured();
});
