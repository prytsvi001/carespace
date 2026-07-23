// server/src/routes/telegram.ts
import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';
import { sendTelegramMessage } from '../telegram';

const router = Router();

// Ambiguous characters (0/O, 1/I) excluded so codes are easy to read/type in a Telegram DM.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

// POST /api/telegram/link-code — generate a fresh code for the logged-in user
router.post('/link-code', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const code = generateCode();
    await prisma.user.update({
      where: { id: userId },
      data: { telegramLinkCode: code, telegramLinkExpiry: new Date(Date.now() + LINK_CODE_TTL_MS) },
    });
    res.json({ code, botUsername: process.env.TELEGRAM_BOT_USERNAME || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate link code' });
  }
});

// GET /api/telegram/status — whether the logged-in user has connected Telegram
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
    res.json({ connected: !!user?.telegramChatId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch Telegram status' });
  }
});

// POST /api/telegram/webhook — called by Telegram itself, not a logged-in user.
// All work happens before responding (never after) since Vercel serverless
// functions aren't guaranteed to keep running once a response has been sent.
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const secret = req.header('X-Telegram-Bot-Api-Secret-Token');
    if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      console.warn('Telegram webhook: secret mismatch, ignoring');
      return res.status(200).json({ ok: true });
    }

    const chatId = req.body?.message?.chat?.id;
    const text = req.body?.message?.text;
    if (!chatId || typeof text !== 'string') {
      return res.status(200).json({ ok: true });
    }

    const code = text.trim().toUpperCase();
    const user = await prisma.user.findFirst({
      where: { telegramLinkCode: code, telegramLinkExpiry: { gt: new Date() } },
    });

    if (!user) {
      await sendTelegramMessage(String(chatId), 'Code not recognized or expired — generate a new one from CareSpace and send it here.');
      return res.status(200).json({ ok: true });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: String(chatId), telegramLinkCode: null, telegramLinkExpiry: null },
    });
    await sendTelegramMessage(String(chatId), `Connected! You'll now receive CareSpace notifications here, ${user.name}.`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Telegram webhook error:', err);
    return res.status(200).json({ ok: true });
  }
});

export default router;
