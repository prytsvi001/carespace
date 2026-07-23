// scripts/set-telegram-webhook.ts
//
// One-off script to register (or re-register) the Telegram bot's webhook URL.
// Only needs to be run once the /api/telegram/webhook endpoint is live in
// production (Telegram requires a reachable public HTTPS URL) — re-run it
// only if the domain or TELEGRAM_WEBHOOK_SECRET ever changes.
//
// Usage: npx tsx scripts/set-telegram-webhook.ts
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const URL = process.env.CARESPACE_URL || 'https://carespace.struktura.io';

async function main() {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  if (!SECRET) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set');

  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${URL}/api/telegram/webhook`,
      secret_token: SECRET,
    }),
  });

  const body = await res.json();
  console.log(body);
  if (!body.ok) process.exitCode = 1;
}

main();
