// server/src/routes/boostRequests.ts
// Peekviewer Team — "Boost" tab. Any team member can create a request;
// peekviewerAdmin users (Yana Fedorova, Sandra Moore, Victoria Davis) see the
// full queue and can complete/edit/delete any request. Completing a request
// is what drops it off the admin worklist (status: 'complete') — the
// requester keeps seeing their own request (now green) regardless of status,
// so there's no separate archived flag.
import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth, requirePeekviewerTeam } from '../middleware/auth';
import { sendTelegramMessage, CARESPACE_URL } from '../telegram';

const router = Router();
router.use(requireAuth);
router.use(requirePeekviewerTeam);

const BOOST_TYPES = ['likes', 'followers', 'comments'] as const;
// Sandra Moore/Victoria Davis are also peekviewerAdmin (and still get the
// InboxMessage, same as before), but only Yana gets the Telegram push for a
// new request — she's the one actually processing the Boost queue day to day.
const YANA_EMAIL = 'yana_fedorova@struktura.io';

function isAdmin(user: Express.User): boolean {
  return user.peekviewerAdmin === true;
}

// GET /api/boost-requests — admins see the full active queue (+ their own
// completed history via ?includeCompleted=1); everyone else sees only their
// own requests, at every status.
router.get('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const admin = isAdmin(me);

    const where = admin
      ? (req.query.includeCompleted ? {} : { status: 'in_progress' })
      : { requesterId: me.id };

    const requests = await prisma.boostRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(requests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch boost requests' });
  }
});

// GET /api/boost-requests/sent — the caller's own boost requests at every
// status, regardless of admin status (used by Inbox's "Boost Requests" view
// so an admin creating one from Inbox sees their own, not the full queue).
router.get('/sent', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const requests = await prisma.boostRequest.findMany({
      where: { requesterId: me.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(requests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sent boost requests' });
  }
});

const MAX_BULK_ITEMS = 50;

// POST /api/boost-requests/bulk — create one or several boost requests (any
// mix of types/quantities) in one submission, e.g. 3 likes links + 2
// comments links + 5 followers links at once, all sharing a fresh batchId.
// Body: { items: {boostType, link, quantity}[] }. One combined Telegram/
// Inbox notification is sent for the whole batch on creation; the
// "processed" notification back to the requester (see /:id/complete) waits
// until every row in the batch is complete, not one per row.
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { items } = req.body as { items?: { boostType?: string; link?: string; quantity?: number }[] };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }
    if (items.length > MAX_BULK_ITEMS) {
      return res.status(400).json({ error: `Too many requests at once (max ${MAX_BULK_ITEMS})` });
    }

    const cleaned: { boostType: string; link: string; quantity: number }[] = [];
    for (let i = 0; i < items.length; i++) {
      const { boostType, link, quantity } = items[i];
      if (!boostType || !BOOST_TYPES.includes(boostType as (typeof BOOST_TYPES)[number])) {
        return res.status(400).json({ error: `Row ${i + 1}: boostType must be likes, followers, or comments` });
      }
      if (!link?.trim()) {
        return res.status(400).json({ error: `Row ${i + 1}: link is required` });
      }
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: `Row ${i + 1}: quantity must be a positive number` });
      }
      cleaned.push({ boostType, link: link.trim(), quantity: Math.round(qty) });
    }

    const batchId = randomUUID();
    const created = await prisma.$transaction(
      cleaned.map((item) => prisma.boostRequest.create({
        data: { requesterId: me.id, requesterName: me.name, batchId, ...item },
      }))
    );

    const admins = await prisma.user.findMany({
      where: { peekviewerAdmin: true, id: { not: me.id } },
      select: { id: true, email: true, telegramChatId: true },
    });

    const countsByType: Record<string, number> = {};
    for (const item of cleaned) countsByType[item.boostType] = (countsByType[item.boostType] ?? 0) + 1;
    const breakdown = Object.entries(countsByType).map(([type, count]) => `${count} ${type}`).join(', ');

    const subject = `New Boost requests — ${cleaned.length}`;
    const content = `${me.name} requested ${cleaned.length} boosts (${breakdown})`;
    const telegramText = `Вам залишили ${cleaned.length} нових boost requests від ${me.name} (${breakdown}). Перегляньте деталі в CareSpace: ${CARESPACE_URL}`;

    await Promise.all(admins.map(async (admin) => {
      await prisma.inboxMessage.create({
        data: { senderId: me.id, receiverId: admin.id, type: 'general', subject, content },
      });
      if (admin.telegramChatId && admin.email === YANA_EMAIL) {
        await sendTelegramMessage(admin.telegramChatId, telegramText);
      }
    }));

    return res.status(201).json(created);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create boost requests' });
  }
});

// PATCH /api/boost-requests/:id/complete — admin only. Re-completing an
// already-complete request (e.g. a double-click) is a no-op. The requester's
// Telegram is notified only once ALL requests sharing this row's batchId are
// complete — completing one of several rows submitted together doesn't
// notify by itself; completing the last one does, for the whole batch. Rows
// with no batchId (created before that field existed) notify immediately,
// same as the old one-row-at-a-time behavior.
router.patch('/:id/complete', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const existing = await prisma.boostRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const alreadyComplete = existing.status === 'complete';
    const updated = alreadyComplete
      ? existing
      : await prisma.boostRequest.update({
          where: { id: req.params.id },
          data: { status: 'complete', completedAt: new Date(), completedByName: me.name },
        });

    if (!alreadyComplete && existing.requesterId !== me.id) {
      const batchItems = existing.batchId
        ? await prisma.boostRequest.findMany({ where: { batchId: existing.batchId } })
        : [updated];
      const batchDone = batchItems.every((r) => r.status === 'complete');

      if (batchDone) {
        const requester = await prisma.user.findUnique({ where: { id: existing.requesterId } });
        if (requester?.telegramChatId) {
          const text = batchItems.length > 1
            ? `Усі ваші boost requests (${batchItems.length}) виконано! Перегляньте деталі в CareSpace: ${CARESPACE_URL}`
            : `Ваш boost request вже виконаний. Перегляньте деталі в CareSpace: ${CARESPACE_URL}`;
          await sendTelegramMessage(requester.telegramChatId, text);
        }
      }
    }

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to complete boost request' });
  }
});

// PATCH /api/boost-requests/:id — admin only
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { boostType, link, quantity } = req.body as { boostType?: string; link?: string; quantity?: number };
    if (boostType && !BOOST_TYPES.includes(boostType as (typeof BOOST_TYPES)[number])) {
      return res.status(400).json({ error: 'boostType must be likes, followers, or comments' });
    }

    const result = await prisma.boostRequest.updateMany({
      where: { id: req.params.id },
      data: {
        ...(boostType ? { boostType } : {}),
        ...(typeof link === 'string' ? { link: link.trim() } : {}),
        ...(quantity !== undefined ? { quantity: Math.round(Number(quantity)) } : {}),
      },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.boostRequest.findUnique({ where: { id: req.params.id } });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update boost request' });
  }
});

// DELETE /api/boost-requests/:id — admin only
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    await prisma.boostRequest.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete boost request' });
  }
});

export default router;
