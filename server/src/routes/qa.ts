// server/src/routes/qa.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';

const router = Router();

// GET /api/qa?channel=LIVE_CHAT&dateFrom=...&dateTo=...
router.get('/', async (req: Request, res: Response) => {
  try {
    const { channel, dateFrom, dateTo, limit = '50', offset = '0' } = req.query;

    const where: Record<string, unknown> = {};

    if (channel) {
      where.channel = channel as string;
    }

    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom as string);
      if (dateTo) {
        const end = new Date(dateTo as string);
        end.setUTCHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.issueDate = dateFilter;
    }

    const [entries, total] = await Promise.all([
      prisma.aIChatQA.findMany({
        where,
        orderBy: { issueDate: 'desc' },
        take: Number(limit),
        skip: Number(offset),
      }),
      prisma.aIChatQA.count({ where }),
    ]);

    res.json({ entries, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch QA entries' });
  }
});

// POST /api/qa
router.post('/', async (req: Request, res: Response) => {
  try {
    const { channel, status = 'OPEN', chatText, issueDate, comment } = req.body;

    if (!channel || !chatText || !issueDate || !comment) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const entry = await prisma.aIChatQA.create({
      data: {
        channel,
        status,
        chatText,
        issueDate: new Date(issueDate),
        comment,
      },
    });

    return res.status(201).json(entry);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create QA entry' });
  }
});

// PUT /api/qa/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { channel, status, chatText, issueDate, comment } = req.body;

    const entry = await prisma.aIChatQA.update({
      where: { id },
      data: {
        ...(channel && { channel }),
        ...(status && { status }),
        ...(chatText && { chatText }),
        ...(issueDate && { issueDate: new Date(issueDate) }),
        ...(comment && { comment }),
      },
    });

    res.json(entry);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update QA entry' });
  }
});

// DELETE /api/qa/delete/:id — permanent. The archive feature is gone
// (request from Victoria Davis), so this is the only removal path left —
// used by the manual Delete button; the client also calls it directly when
// a status change lands on DONE, instead of persisting that status at all.
router.delete('/delete/:id', async (req: Request, res: Response) => {
  try {
    await prisma.aIChatQA.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete QA entry' });
  }
});

// POST /api/qa/purge-archived — head/lead only, one-off cleanup. Removes the
// archive feature's leftover data: every entry still flagged archived=true
// from before the feature was removed. Returns what was deleted (not just a
// count) since this is permanent and irreversible. Delete this route once
// the cleanup is confirmed; no ongoing purpose (nothing sets archived=true anymore).
router.post('/purge-archived', async (req: Request, res: Response) => {
  try {
    const role = (req.user as Express.User).role;
    if (role !== 'head' && role !== 'lead') return res.status(403).json({ error: 'Not allowed' });

    const toDelete = await prisma.aIChatQA.findMany({
      where: { archived: true },
      orderBy: { issueDate: 'desc' },
    });

    if (toDelete.length > 0) {
      await prisma.aIChatQA.deleteMany({ where: { id: { in: toDelete.map((e) => e.id) } } });
    }

    return res.json({
      deletedCount: toDelete.length,
      deleted: toDelete.map((e) => ({
        id: e.id, channel: e.channel, issueDate: e.issueDate, comment: e.comment.slice(0, 80),
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to purge archived QA entries' });
  }
});

export default router;
