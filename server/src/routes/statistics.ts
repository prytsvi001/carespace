// server/src/routes/statistics.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { computeAgentStatsForRange, utcDateKey } from '../statsHelpers';

const router = Router();

// GET /api/statistics?year=2024&month=3
// GET /api/statistics?dateFrom=2024-06-01&dateTo=2024-06-30
router.get('/', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    let start: Date;
    let end: Date;
    let year: number | undefined;
    let month: number | undefined;

    if (req.query.dateFrom && req.query.dateTo) {
      const [fy, fm, fd] = (req.query.dateFrom as string).split('-').map(Number);
      const [ty, tm, td] = (req.query.dateTo as string).split('-').map(Number);
      start = new Date(Date.UTC(fy, fm - 1, fd));
      end = new Date(Date.UTC(ty, tm - 1, td + 1)); // exclusive: day after last
    } else {
      year = Number(req.query.year) || now.getUTCFullYear();
      month = Number(req.query.month) || (now.getUTCMonth() + 1);
      start = new Date(Date.UTC(year, month - 1, 1));
      end = new Date(Date.UTC(year, month, 1));
    }

    const dateFrom = utcDateKey(start);
    const dateTo = utcDateKey(new Date(end.getTime() - 24 * 60 * 60 * 1000));

    const stats = await computeAgentStatsForRange(start, end);

    // Team totals
    const totals = stats.reduce(
      (acc, s) => ({
        totalHours: acc.totalHours + s.totalHours,
        totalShifts: acc.totalShifts + s.totalShifts,
        totalChats: acc.totalChats + s.totalChats,
        totalTickets: acc.totalTickets + s.totalTickets,
        totalCalls: acc.totalCalls + s.totalCalls,
        totalRefunds: acc.totalRefunds + s.totalRefunds,
      }),
      { totalHours: 0, totalShifts: 0, totalChats: 0, totalTickets: 0, totalCalls: 0, totalRefunds: 0 }
    );

    res.json({ year, month, dateFrom, dateTo, stats, totals });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// GET /api/statistics/agent/:agentId?months=6
// Returns last N months trend for one agent
router.get('/agent/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const months = Number(req.query.months) || 6;

    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));

    const logs = await prisma.shiftLog.findMany({
      where: {
        archived: false,
        agentId,
        shiftDate: { gte: start },
      },
      orderBy: { shiftDate: 'asc' },
    });

    // Group by month
    const byMonth: Record<string, {
      month: string;
      totalHours: number;
      totalChats: number;
      totalTickets: number;
      totalCalls: number;
      totalRefunds: number;
      totalShifts: number;
    }> = {};

    for (const log of logs) {
      const key = `${log.shiftDate.getUTCFullYear()}-${String(log.shiftDate.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) {
        byMonth[key] = {
          month: key,
          totalHours: 0,
          totalChats: 0,
          totalTickets: 0,
          totalCalls: 0,
          totalRefunds: 0,
          totalShifts: 0,
        };
      }
      byMonth[key].totalHours += log.hoursWorked;
      byMonth[key].totalChats += log.chatsCount;
      byMonth[key].totalTickets += log.ticketsCount;
      byMonth[key].totalCalls += log.callsCount;
      byMonth[key].totalRefunds += log.refundRequestsCount;
      byMonth[key].totalShifts += 1;
    }

    res.json({ agentId, trend: Object.values(byMonth) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch agent statistics' });
  }
});

export default router;
