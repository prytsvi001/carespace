// server/src/telegram.ts
// Thin wrapper around the Telegram Bot API. This is the only place
// TELEGRAM_BOT_TOKEN is read — every notification hook and the webhook's
// confirmation reply go through sendTelegramMessage().
const API_BASE = 'https://api.telegram.org';

// A Telegram outage (or a missing token in an environment that hasn't been
// configured yet) must never break the primary action it's attached to
// (sending a QA report, creating a Peak Request, etc.) — every call here
// swallows its own errors and just logs them.
export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN not set — skipping Telegram notification');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      console.error(`Telegram sendMessage to ${chatId} failed:`, res.status, await res.text());
    } else {
      console.log(`Telegram sendMessage to ${chatId} succeeded (status ${res.status})`);
    }
  } catch (err) {
    console.error(`Telegram sendMessage to ${chatId} error:`, err);
  }
}

export const CARESPACE_URL = 'https://carespace.struktura.io';
