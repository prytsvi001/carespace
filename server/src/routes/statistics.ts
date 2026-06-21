// server/src/routes/statistics.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';

const router = Router();

// Rotation schedule — must stay in sync with ShiftCalendar.tsx
const ROTATION_BLOCKS = [
  { morning: 'Nicky Brown', night: 'Julia Manson' },
  { morning: 'Jonathan Lewis', night: 'Victoria Davis' },
  { morning: 'Julia Manson', night: 'Nicky Brown' },
  { morning: 'Victoria Davis', night: 'Jonathan Lewis' },
] as const;

function getRotationPair(date: Date): { morning: string; night: string } | null {
  const ROTATION_START_UTC = Date.UTC(2026, 5, 1); // 2026-06-01
  const dayUTC = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceStart = Math.round((dayUTC - ROTATION_START_UTC) / (24 * 60 * 60 * 1000));
  if (daysSinceStart < 0) return null;
  const block = Math.floor(daysSinceStart / 4) % ROTATION_BLOCKS.length;
  return ROTATION_BLOCKS[block];
}

function utcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

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

    const agents = await prisma.agent.findMany({
      where: { archived: false },
      orderBy: { name: 'asc' },
    });

    const [logs, calendarEvents] = await Promise.all([
      prisma.shiftLog.findMany({
        where: { shiftDate: { gte: start, lt: end } },
        include: { agent: true },
      }),
      prisma.calendarEvent.findMany({
        where: { archived: false, eventDate: { gte: start, lt: end } },
        include: { agent: true },
      }),
    ]);

    type StatsEntry = {
      agentId: string;
      agentName: string;
      totalHours: number;
      totalShifts: number;
      morningShifts: number;
      nightShifts: number;
      totalChats: number;
      totalTickets: number;
      totalCalls: number;
      totalRefunds: number;
    };

    const statsMap: Record<string, StatsEntry> = {};
    for (const agent of agents) {
      statsMap[agent.id] = {
        agentId: agent.id, agentName: agent.name,
        totalHours: 0, totalShifts: 0, morningShifts: 0, nightShifts: 0,
        totalChats: 0, totalTickets: 0, totalCalls: 0, totalRefunds: 0,
      };
    }

    // Chats / tickets / calls / refunds come from shift logs
    for (const log of logs) {
      const s = statsMap[log.agentId];
      if (!s) continue;
      s.totalChats += log.chatsCount;
      s.totalTickets += log.ticketsCount;
      s.totalCalls += log.callsCount;
      s.totalRefunds += log.refundRequestsCount;
    }

    // Hours and shift counts come from calendar events + rotation schedule
    const storedByDateAgent: Record<string, Record<string, typeof calendarEvents[number]>> = {};
    for (const ev of calendarEvents) {
      const key = utcDateKey(ev.eventDate);
      if (!storedByDateAgent[key]) storedByDateAgent[key] = {};
      storedByDateAgent[key][ev.agentId] = ev;
    }

    const agentByName: Record<string, typeof agents[number]> = {};
    for (const a of agents) agentByName[a.name] = a;

    const totalDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));

    for (let d = 0; d < totalDays; d++) {
      const dayDate = new Date(start.getTime() + d * 24 * 60 * 60 * 1000);
      const dateKey = utcDateKey(dayDate);
      const storedForDay = storedByDateAgent[dateKey] || {};
      const rotationAgentIds = new Set<string>();

      const pair = getRotationPair(dayDate);
      if (pair) {
        const slots: Array<[string, 'MORNING' | 'NIGHT']> = [
          [pair.morning, 'MORNING'],
          [pair.night, 'NIGHT'],
        ];

        for (const [agentName, rotShiftType] of slots) {
          const agent = agentByName[agentName];
          if (!agent) continue;
          const s = statsMap[agent.id];
          if (!s) continue;
          rotationAgentIds.add(agent.id);

          const storedEv = storedForDay[agent.id];

          if (storedEv && storedEv.leaveType !== 'SHIFT') {
            // Leave day: always 8h; morning/night attribution follows rotation
            s.totalHours += 8;
            s.totalShifts += 1;
            if (rotShiftType === 'MORNING') s.morningShifts += 1;
            else s.nightShifts += 1;
          } else {
            // Regular rotation shift (stored SHIFT events for rotation agents are ignored per calendar display rules)
            s.totalHours += rotShiftType === 'MORNING' ? 11 : 8;
            s.totalShifts += 1;
            if (rotShiftType === 'MORNING') s.morningShifts += 1;
            else s.nightShifts += 1;
          }
        }
      }

      // Non-rotation agents: process their stored events directly
      for (const [agentId, ev] of Object.entries(storedForDay)) {
        if (rotationAgentIds.has(agentId)) continue;
        const s = statsMap[agentId];
        if (!s) continue;

        const shiftType = ev.shiftType as 'MORNING' | 'NIGHT' | null;
        if (ev.leaveType === 'SHIFT') {
          s.totalHours += shiftType === 'MORNING' ? 11 : 8;
          s.totalShifts += 1;
          if (shiftType === 'MORNING') s.morningShifts += 1;
          else s.nightShifts += 1;
        } else {
          // Leave event: always 8h; shiftType may be null for non-rotation agents
          s.totalHours += 8;
          s.totalShifts += 1;
          if (shiftType === 'MORNING') s.morningShifts += 1;
          else if (shiftType === 'NIGHT') s.nightShifts += 1;
        }
      }
    }

    const stats = Object.values(statsMap);

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
