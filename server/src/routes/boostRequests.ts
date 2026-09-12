// server/src/routes/boostRequests.ts
// Peekviewer Team — "Boost" tab. Any team member can create a request;
// peekviewerAdmin users (Yana Fedorova, Sandra Moore, Victoria Davis) see the
// full queue and can complete/edit/delete any request. Completing a request
// is what drops it off the admin worklist (status: 'complete') — the
// requester keeps seeing their own request (now green) regardless of status,
// so there's no separate archived flag.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth, requirePeekviewerTeam } from '../middleware/auth';
import { sendTelegramMessage, CARESPACE_URL } from '../telegram';

const router = Router();
router.use(requireAuth);
router.use(requirePeekviewerTeam);

const BOOST_TYPES = ['likes', 'followers', 'comments'] as const;

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

// POST /api/boost-requests
router.post('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { boostType, link, quantity } = req.body as { boostType?: string; link?: string; quantity?: number };

    if (!boostType || !BOOST_TYPES.includes(boostType as (typeof BOOST_TYPES)[number])) {
      return res.status(400).json({ error: 'boostType must be likes, followers, or comments' });
    }
    if (!link?.trim()) {
      return res.status(400).json({ error: 'link is required' });
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const request = await prisma.boostRequest.create({
      data: {
        requesterId: me.id,
        requesterName: me.name,
        boostType,
        link: link.trim(),
        quantity: Math.round(qty),
      },
    });

    const admins = await prisma.user.findMany({
      where: { peekviewerAdmin: true, id: { not: me.id } },
      select: { id: true, telegramChatId: true },
    });

    const subject = `New Boost request — ${boostType}`;
    const content = `${me.name} requested a ${boostType} boost (${qty}): ${link.trim()}`;
    const telegramText = `Вам залишили новий boost request від ${me.name} (${boostType}, ${qty}). Перегляньте деталі в CareSpace: ${CARESPACE_URL}`;
    await Promise.all(admins.map(async (admin) => {
      await prisma.inboxMessage.create({
        data: { senderId: me.id, receiverId: admin.id, type: 'general', subject, content },
      });
      if (admin.telegramChatId) {
        await sendTelegramMessage(admin.telegramChatId, telegramText);
      }
    }));

    return res.status(201).json(request);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create boost request' });
  }
});

// PATCH /api/boost-requests/:id/complete — admin only. Notifies the
// requester's Telegram exactly once, on the transition into "complete" —
// re-completing an already-complete request (e.g. a double-click) is a
// no-op rather than a duplicate notification.
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
      const requester = await prisma.user.findUnique({ where: { id: existing.requesterId } });
      if (requester?.telegramChatId) {
        await sendTelegramMessage(
          requester.telegramChatId,
          `Ваш boost request вже виконаний. Перегляньте деталі в CareSpace: ${CARESPACE_URL}`
        );
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
