// server/src/statsHelpers.ts
// Shared per-agent monthly hours/shifts/metrics computation, used by both
// GET /api/statistics (the Statistics tab) and GET /api/salary (hours worked
// auto-pull) — kept in one place so the two never silently diverge.
import prisma from './prisma';
import { getRotationPair, SHIFT_REASSIGNED } from './rotationSchedule';

export function utcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

// Categorized hours breakdown for a month — every category's hours sum to
// exactly totalHours below, since each branch of the day loop that adds to
// totalHours also adds the same amount to one (and only one) category here.
export interface HoursBreakdown {
  morningShifts: number; morningHours: number;
  nightShifts: number; nightHours: number;
  vacationDays: number; vacationHours: number;
  sickWithNoteDays: number; sickWithNoteHours: number;
  sickWithoutNoteDays: number; sickWithoutNoteHours: number;
  birthdayOffDays: number; birthdayOffHours: number;
  extraShifts: number; extraHours: number;
}

function emptyBreakdown(): HoursBreakdown {
  return {
    morningShifts: 0, morningHours: 0,
    nightShifts: 0, nightHours: 0,
    vacationDays: 0, vacationHours: 0,
    sickWithNoteDays: 0, sickWithNoteHours: 0,
    sickWithoutNoteDays: 0, sickWithoutNoteHours: 0,
    birthdayOffDays: 0, birthdayOffHours: 0,
    extraShifts: 0, extraHours: 0,
  };
}

function addLeaveToBreakdown(b: HoursBreakdown, leaveType: string, hours: number): void {
  if (leaveType === 'VACATION') { b.vacationDays += 1; b.vacationHours += hours; }
  else if (leaveType === 'SICK_LEAVE_WITH_NOTE') { b.sickWithNoteDays += 1; b.sickWithNoteHours += hours; }
  else if (leaveType === 'SICK_LEAVE_WITHOUT_NOTE') { b.sickWithoutNoteDays += 1; b.sickWithoutNoteHours += hours; }
  else if (leaveType === 'BIRTHDAY_OFF') { b.birthdayOffDays += 1; b.birthdayOffHours += hours; }
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
  breakdown: HoursBreakdown;
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
      breakdown: emptyBreakdown(),
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

        if (storedEv && storedEv.leaveType === SHIFT_REASSIGNED) {
          // This native rotation shift was dragged away to another day (see
          // calendar.ts's PATCH /:id/reschedule) — it's now counted as an
          // extra shift on whichever day it landed on instead, so crediting
          // it again here would double-count it.
          continue;
        } else if (storedEv && storedEv.leaveType !== 'SHIFT') {
          // Leave day: always 8h; morning/night attribution follows rotation
          s.totalHours += 8;
          s.totalShifts += 1;
          if (rotShiftType === 'MORNING') s.morningShifts += 1;
          else s.nightShifts += 1;
          addLeaveToBreakdown(s.breakdown, storedEv.leaveType, 8);
        } else {
          // Regular rotation shift (stored SHIFT events for rotation agents are ignored per calendar display rules)
          const hrs = rotShiftType === 'MORNING' ? 11 : 8;
          s.totalHours += hrs;
          s.totalShifts += 1;
          if (rotShiftType === 'MORNING') { s.morningShifts += 1; s.breakdown.morningShifts += 1; s.breakdown.morningHours += hrs; }
          else { s.nightShifts += 1; s.breakdown.nightShifts += 1; s.breakdown.nightHours += hrs; }
        }
      }
    }

    // Non-rotation agents: process their stored events directly
    for (const [agentId, ev] of Object.entries(storedForDay)) {
      if (rotationAgentIds.has(agentId)) continue;
      const s = statsMap[agentId];
      if (!s) continue;

      if (ev.leaveType === SHIFT_REASSIGNED) continue; // only ever stamped on a native rotation day — defensive

      const shiftType = ev.shiftType as 'MORNING' | 'NIGHT' | null;
      if (ev.leaveType === 'SHIFT') {
        // A stored SHIFT event for a day this agent isn't natively in the
        // rotation for is, by definition, them covering an extra shift.
        const hrs = shiftType === 'MORNING' ? 11 : 8;
        s.totalHours += hrs;
        s.totalShifts += 1;
        if (shiftType === 'MORNING') s.morningShifts += 1;
        else s.nightShifts += 1;
        s.breakdown.extraShifts += 1;
        s.breakdown.extraHours += hrs;
      } else {
        // Leave event: always 8h; shiftType may be null for non-rotation agents
        s.totalHours += 8;
        s.totalShifts += 1;
        if (shiftType === 'MORNING') s.morningShifts += 1;
        else if (shiftType === 'NIGHT') s.nightShifts += 1;
        addLeaveToBreakdown(s.breakdown, ev.leaveType, 8);
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
