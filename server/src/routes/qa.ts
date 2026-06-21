// server/src/routes/qa.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';

const router = Router();

// GET /api/qa?channel=LIVE_CHAT&dateFrom=...&dateTo=...
router.get('/', async (req: Request, res: Response) => {
  try {
    const { channel, dateFrom, dateTo, limit = '50', offset = '0', includeArchived } = req.query;

    const where: Record<string, unknown> = includeArchived === 'true' ? {} : { archived: false };

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

// DELETE (archive) /api/qa/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.aIChatQA.update({
      where: { id },
      data: { archived: true },
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to archive QA entry' });
  }
});

router.delete('/delete/:id', async (req: Request, res: Response) => {
  try {
    await prisma.aIChatQA.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete QA entry' });
  }
});

export default router;
