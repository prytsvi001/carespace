// server/src/statsHelpers.ts
// Shared per-agent monthly hours/shifts/metrics computation, used by both
// GET /api/statistics (the Statistics tab) and GET /api/salary (hours worked
// auto-pull) — kept in one place so the two never silently diverge.
import prisma from './prisma';
import { getRotationPair } from './rotationSchedule';

export function utcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export interface AgentMonthStats {
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
}

// [start, end) — same half-open UTC range convention used across the app.
export async function computeAgentStatsForRange(start: Date, end: Date): Promise<AgentMonthStats[]> {
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

  const statsMap: Record<string, AgentMonthStats> = {};
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

  return Object.values(statsMap);
}

// Convenience wrapper for callers (e.g. Salary) that only ever deal in
// calendar months, not custom date ranges.
export async function computeMonthlyAgentStats(year: number, month: number): Promise<AgentMonthStats[]> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return computeAgentStatsForRange(start, end);
}
