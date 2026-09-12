// server/src/routes/accountRequests.ts
// Peekviewer Team — "New account request" (created from Inbox's "Requests
// sent to Anna" view). Anna is the sole recipient — there's no receiverId
// param, this always resolves to her account. Creates a structured
// AccountRequest (status + comment thread, shown in the References tab)
// plus a companion InboxMessage so it also lands in her regular Inbox —
// same split QAAgentReport/SalaryRecord use elsewhere in this app. Anna and
// Sandra Moore/Victoria Davis (role head/lead) can all set status and add
// comments; everyone else with References visible sees it read-only.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth, requirePeekviewerTeam } from '../middleware/auth';
import { sendTelegramMessage, CARESPACE_URL } from '../telegram';

const router = Router();
router.use(requireAuth);
router.use(requirePeekviewerTeam);

const STATUSES = ['open', 'in_progress', 'done'] as const;
const ANNA_EMAIL = 'anna_bilous@struktura.io';

type Comment = { id: string; authorName: string; text: string; createdAt: string };

function parseComments(raw: string): Comment[] {
  try { return JSON.parse(raw); } catch { return []; }
}

async function getAnna() {
  return prisma.user.findUnique({ where: { email: ANNA_EMAIL } });
}

function isAnnaOrAdmin(me: Express.User, annaId: string): boolean {
  return me.id === annaId || me.peekviewerAdmin === true;
}

// Same rights as Anna herself: set status, comment, archive, delete.
function canManage(me: Express.User, annaId: string): boolean {
  return me.id === annaId || me.role === 'head' || me.role === 'lead';
}

function formatRequest(r: {
  id: string; requesterId: string; requesterName: string; content: string; status: string;
  comments: string; archived: boolean; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: r.id,
    requesterId: r.requesterId,
    requesterName: r.requesterName,
    content: r.content,
    status: r.status,
    comments: parseComments(r.comments),
    archived: r.archived,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// GET /api/account-requests — Anna's full queue. Anna or peekviewerAdmin only.
router.get('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const anna = await getAnna();
    if (!anna) return res.status(500).json({ error: 'Anna Bilous account not found' });
    if (!isAnnaOrAdmin(me, anna.id)) return res.status(403).json({ error: 'Not permitted' });

    const requests = await prisma.accountRequest.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(requests.map(formatRequest));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch account requests' });
  }
});

// GET /api/account-requests/sent — requests the caller themselves sent to Anna
router.get('/sent', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const requests = await prisma.accountRequest.findMany({
      where: { requesterId: me.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(requests.map(formatRequest));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sent account requests' });
  }
});

// POST /api/account-requests — any Peekviewer team member, always targets Anna
router.post('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { content } = req.body as { content?: string };
    if (!content?.trim()) return res.status(400).json({ error: 'content is required' });

    const anna = await getAnna();
    if (!anna) return res.status(500).json({ error: 'Anna Bilous account not found' });

    const request = await prisma.accountRequest.create({
      data: { requesterId: me.id, requesterName: me.name, content: content.trim() },
    });

    let messageId: string | undefined;
    if (anna.id !== me.id) {
      const message = await prisma.inboxMessage.create({
        data: {
          senderId: me.id, receiverId: anna.id, type: 'account_request',
          subject: 'New account request', content: content.trim(),
        },
      });
      messageId = message.id;
      if (anna.telegramChatId) {
        await sendTelegramMessage(
          anna.telegramChatId,
          `Вам залишили новий запит на створення акаунту від ${me.name}. Перегляньте деталі в CareSpace: ${CARESPACE_URL}`
        );
      }
    }

    if (messageId) {
      await prisma.accountRequest.update({ where: { id: request.id }, data: { inboxMessageId: messageId } });
    }

    return res.status(201).json(formatRequest(request));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create account request' });
  }
});

// PATCH /api/account-requests/:id — Anna, or Sandra Moore/Victoria Davis
// (role head/lead), same as Anna. Body: { status?, comment?, archived? }
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const anna = await getAnna();
    if (!anna || !canManage(me, anna.id)) return res.status(403).json({ error: 'Not permitted' });

    const { status, comment, archived } = req.body as { status?: string; comment?: string; archived?: boolean };
    if (status !== undefined && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return res.status(400).json({ error: 'status must be open, in_progress, or done' });
    }

    const existing = await prisma.accountRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const comments = parseComments(existing.comments);
    if (comment?.trim()) {
      comments.push({ id: `${Date.now()}`, authorName: me.name, text: comment.trim(), createdAt: new Date().toISOString() });
    }

    const updated = await prisma.accountRequest.update({
      where: { id: req.params.id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(archived !== undefined ? { archived } : {}),
        comments: JSON.stringify(comments),
      },
    });

    // Notify the requester exactly once, on the transition into "done" —
    // not on every subsequent comment/archive edit to an already-done request.
    if (status === 'done' && existing.status !== 'done' && existing.requesterId !== me.id) {
      const requester = await prisma.user.findUnique({ where: { id: existing.requesterId } });
      if (requester?.telegramChatId) {
        await sendTelegramMessage(
          requester.telegramChatId,
          `Ваш запит на створення акаунту (New Account Request) вже виконаний. Перегляньте деталі в CareSpace: ${CARESPACE_URL}`
        );
      }
    }

    res.json(formatRequest(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update account request' });
  }
});

// DELETE /api/account-requests/:id — Anna, or Sandra Moore/Victoria Davis
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const anna = await getAnna();
    if (!anna || !canManage(me, anna.id)) return res.status(403).json({ error: 'Not permitted' });

    await prisma.accountRequest.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete account request' });
  }
});

export default router;
