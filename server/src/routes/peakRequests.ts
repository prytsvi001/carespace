// server/src/routes/peakRequests.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { sendTelegramMessage, CARESPACE_URL } from '../telegram';

const router = Router();

type PeakComment = { authorId: string | null; authorName: string; text: string; createdAt: string };

function parseComments(raw: string): PeakComment[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function formatRequest(r: { comments: string; [key: string]: unknown }) {
  return { ...r, comments: parseComments(r.comments) };
}

const DONE_ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;

// Runs on every board load/poll — no separate cron process needed (production
// runs as Vercel serverless functions, which can't host a long-lived timer).
// Rows that were already DONE before this feature shipped have no doneAt yet;
// stamping them with "now" here means their 24h timer effectively starts at
// first-check-after-deploy, matching the "start the timer at deploy time" spec.
async function autoArchiveStaleDone() {
  const now = new Date();
  await prisma.peakRequest.updateMany({
    where: { status: 'DONE', archived: false, doneAt: null },
    data: { doneAt: now },
  });
  await prisma.peakRequest.updateMany({
    where: { status: 'DONE', archived: false, doneAt: { lte: new Date(now.getTime() - DONE_ARCHIVE_AFTER_MS) } },
    data: { archived: true },
  });
}

// GET /api/peak-requests?status=NEW&agentId=...
router.get('/', async (req: Request, res: Response) => {
  try {
    await autoArchiveStaleDone();
    const { status, agentId, limit = '50', offset = '0', includeArchived, search } = req.query;

    const where: Record<string, unknown> = includeArchived === 'true' ? {} : { archived: false };
    if (search) {
      where.OR = [
        { requestText: { contains: search as string } },
        { contactEmail: { contains: search as string } },
        { comments: { contains: search as string } },
      ];
    }
    if (status) where.status = status as string;
    if (agentId) where.agentId = agentId as string;

    const [requests, total] = await Promise.all([
      prisma.peakRequest.findMany({
        where,
        include: { agent: true },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: Number(offset),
      }),
      prisma.peakRequest.count({ where }),
    ]);

    res.json({ requests: requests.map(formatRequest), total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch peak requests' });
  }
});

// GET /api/peak-requests/new-count
router.get('/new-count', async (req: Request, res: Response) => {
  try {
    await autoArchiveStaleDone();
    const count = await prisma.peakRequest.count({
      where: { archived: false, status: 'NEW' },
    });
    res.json({ count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch new requests count' });
  }
});

// POST /api/peak-requests
router.post('/', async (req: Request, res: Response) => {
  try {
    const { agentId, contactEmail, profileNickname, requestText } = req.body;

    if (!agentId || !requestText) {
      return res.status(400).json({ error: 'agentId and requestText are required' });
    }

    const request = await prisma.peakRequest.create({
      data: {
        agentId,
        contactEmail: contactEmail || null,
        profileNickname: profileNickname || null,
        requestText,
        status: 'NEW',
      },
      include: { agent: true },
    });

    const peekHandlers = await prisma.user.findMany({
      where: { OR: [{ role: 'peek_handler' }, { peekOnDuty: true }], telegramChatId: { not: null } },
    });
    const notifyText = `New Peak Request from ${request.agent.name}: ${requestText.trim().slice(0, 120)} ${CARESPACE_URL}`;
    await Promise.allSettled(
      peekHandlers.map((u) => sendTelegramMessage(u.telegramChatId as string, notifyText)),
    );

    return res.status(201).json(formatRequest(request));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create peak request' });
  }
});

// PUT /api/peak-requests/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { agentId, contactEmail, profileNickname, requestText } = req.body;

    if (!agentId || !requestText) {
      return res.status(400).json({ error: 'agentId and requestText are required' });
    }

    const request = await prisma.peakRequest.update({
      where: { id },
      data: {
        agentId,
        contactEmail: contactEmail || null,
        profileNickname: profileNickname || null,
        requestText,
      },
      include: { agent: true },
    });

    return res.json(formatRequest(request));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update peak request' });
  }
});

// PATCH /api/peak-requests/:id/fields  — lightweight inline update (tags)
router.patch('/:id/fields', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tags } = req.body;

    const data: Record<string, unknown> = {};
    if (tags !== undefined) data.tags = tags;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const request = await prisma.peakRequest.update({
      where: { id },
      data,
      include: { agent: true },
    });

    return res.json(formatRequest(request));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update fields' });
  }
});

// POST /api/peak-requests/:id/comments — append a comment
router.post('/:id/comments', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const { id } = req.params;
    const { text } = req.body as { text?: string };

    if (!text?.trim()) return res.status(400).json({ error: 'Comment text is required' });

    const existing = await prisma.peakRequest.findUnique({ where: { id }, select: { comments: true } });
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    const comments = parseComments(existing.comments);
    comments.push({
      authorId: user.id,
      authorName: user.name,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    });

    const request = await prisma.peakRequest.update({
      where: { id },
      data: { comments: JSON.stringify(comments) },
      include: { agent: true },
    });

    const originalRequester = await prisma.user.findFirst({ where: { agentId: request.agentId } });
    if (originalRequester && originalRequester.id !== user.id && originalRequester.telegramChatId) {
      const notifyText = `${user.name} commented on your Peek Request: ${text.trim().slice(0, 120)} ${CARESPACE_URL}`;
      await sendTelegramMessage(originalRequester.telegramChatId, notifyText);
    }

    return res.json(formatRequest(request));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to add comment' });
  }
});

// PATCH /api/peak-requests/:id/status
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['NEW', 'IN_PROGRESS', 'DONE'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const existing = await prisma.peakRequest.findUnique({ where: { id }, select: { status: true } });
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    const request = await prisma.peakRequest.update({
      where: { id },
      data: {
        status,
        doneAt: status === 'DONE' ? (existing.status === 'DONE' ? undefined : new Date()) : null,
      },
      include: { agent: true },
    });

    return res.json(formatRequest(request));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE (archive) /api/peak-requests/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.peakRequest.update({
      where: { id },
      data: { archived: true },
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to archive peak request' });
  }
});

router.delete('/delete/:id', async (req: Request, res: Response) => {
  try {
    await prisma.peakRequest.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete peak request' });
  }
});

export default router;
