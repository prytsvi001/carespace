// server/src/routes/shiftLogs.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';

const router = Router();

// GET /api/shift-logs?date=YYYY-MM-DD&agentId=...
router.get('/', async (req: Request, res: Response) => {
  try {
    const { date, dateFrom, dateTo, month, year, agentId, limit = '50', offset = '0', includeArchived } = req.query;

    const where: Record<string, unknown> = includeArchived === 'true' ? {} : { archived: false };

    if (date) {
      const start = new Date(date as string);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      where.shiftDate = { gte: start, lt: end };
    } else if (dateFrom || dateTo) {
      const start = dateFrom ? new Date(dateFrom as string) : new Date('1970-01-01');
      start.setUTCHours(0, 0, 0, 0);
      const end = dateTo ? new Date(dateTo as string) : new Date();
      end.setUTCHours(23, 59, 59, 999);
      where.shiftDate = { gte: start, lte: end };
    } else if (month || year) {
      const targetYear = Number(year || new Date().getFullYear());
      const targetMonth = Number(month || new Date().getMonth() + 1);
      const start = new Date(Date.UTC(targetYear, targetMonth - 1, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999));
      where.shiftDate = { gte: start, lte: end };
    }

    if (agentId) {
      where.agentId = agentId as string;
    }

    const [logs, total] = await Promise.all([
      prisma.shiftLog.findMany({
        where,
        include: { agent: true },
        orderBy: { shiftDate: 'desc' },
        take: Number(limit),
        skip: Number(offset),
      }),
      prisma.shiftLog.count({ where }),
    ]);

    res.json({ logs, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch shift logs' });
  }
});

// GET /api/shift-logs/today
router.get('/today', async (_req, res: Response) => {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const logs = await prisma.shiftLog.findMany({
      where: {
        archived: false,
        shiftDate: { gte: today, lt: tomorrow },
      },
      include: { agent: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json(logs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch today logs' });
  }
});

// POST /api/shift-logs
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      agentId,
      shiftType,
      shiftDate,
      chatsCount,
      ticketsCount,
      callsCount,
      refundRequestsCount,
      comments,
    } = req.body;

    if (!agentId || !shiftType || !shiftDate) {
      return res.status(400).json({ error: 'agentId, shiftType, and shiftDate are required' });
    }

    const hoursWorked = shiftType === 'MORNING' ? 11 : 8;

    const log = await prisma.shiftLog.create({
      data: {
        agentId,
        shiftType,
        shiftDate: new Date(shiftDate),
        hoursWorked,
        chatsCount: Number(chatsCount) || 0,
        ticketsCount: Number(ticketsCount) || 0,
        callsCount: Number(callsCount) || 0,
        refundRequestsCount: Number(refundRequestsCount) || 0,
        comments: comments || null,
      },
      include: { agent: true },
    });

    return res.status(201).json(log);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create shift log' });
  }
});

// PUT /api/shift-logs/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      chatsCount,
      ticketsCount,
      callsCount,
      refundRequestsCount,
      comments,
    } = req.body;

    const log = await prisma.shiftLog.update({
      where: { id },
      data: {
        chatsCount: Number(chatsCount) || 0,
        ticketsCount: Number(ticketsCount) || 0,
        callsCount: Number(callsCount) || 0,
        refundRequestsCount: Number(refundRequestsCount) || 0,
        comments: comments || null,
      },
      include: { agent: true },
    });

    res.json(log);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update shift log' });
  }
});

// DELETE (archive) /api/shift-logs/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.shiftLog.update({
      where: { id },
      data: { archived: true },
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to archive shift log' });
  }
});

router.delete('/delete/:id', async (req: Request, res: Response) => {
  try {
    await prisma.shiftLog.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete shift log' });
  }
});

export default router;
