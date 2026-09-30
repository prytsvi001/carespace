// server/src/routes/requestSchedule.ts
// Peekviewer Team — "Request Schedule" tab. Code-defined rotation (no
// spreadsheet, confirmed with the user).
//
// From 2026-10-01 there is ONE schedule for everything: the calendar (who's
// on duty to submit ("throw") new-profile requests each day), "Перерозподіл
// активних профілів" and "Розподіл неактивних профілів" all use the same
// day-number ownership. Each of the 5 agents owns one day-of-month class
// mod 5 (e.g. 1 · 6 · 11 · 16 · 21 · 26 · 31) for a 14-day period, applied to
// every month (for the profile lists: every month back to 30.09.2022; for the
// calendar: the date's own day-of-month). Every 14 days the classes rotate —
// each agent moves one class down (1 → 5 → 4 → 3 → 2 → 1) — so nobody keeps
// the same numbers for more than one period and each class comes back only
// every 5 periods (70 days). Shifting down (not up) also means the agent on
// the last day of a period is never on the first day of the next one.
//
// The first period's classes were picked to overlap as little as possible
// with September 2026's "Перерозподіл активних профілів" (mod-4 order Iryna -
// Tetyana - Yana - Tetyana Fomyuk): each existing agent keeps exactly one day
// number from September, which is the minimum possible. Diana Semeniuk joined
// the rotation on 2026-10-01.
//
// Dates before 2026-10-01 keep the legacy 4-agent continuous calendar formula
// (and September itself is pinned via explicit historical overrides).
// Calendar overrides — swaps (drag-and-drop) or direct reassignment (click a
// day's chip) — layer on top of the formula for that one date.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth, requirePeekviewerTeam } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePeekviewerTeam);

// Index i owns day class i+1 (mod 5) in period 0 (01.10.2026 – 14.10.2026):
//   Tetyana Fomyuk 1 · 6 · 11…, Diana 2 · 7…, Iryna 3 · 8…, Tetyana 4 · 9…,
//   Yana 5 · 10…
export const ROTATION_EMAILS = [
  'tetyana_fomyuk@struktura.io',
  'diana_semenuk@struktura.io',
  'iryna_kolodienko@struktura.io',
  'tetiana_veremeenko@struktura.io',
  'yana_fedorova@struktura.io',
];

// Pre-October calendar order, only for dates before ROTATION_START.
const LEGACY_CALENDAR_EMAILS = [
  'tetiana_veremeenko@struktura.io',
  'iryna_kolodienko@struktura.io',
  'tetyana_fomyuk@struktura.io',
  'yana_fedorova@struktura.io',
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ROTATION_START_UTC_MS = Date.UTC(2026, 9, 1); // 1 Oct 2026, period 0
const ROTATION_START = '2026-10-01';
const PERIOD_DAYS = 14;
// Legacy continuous formula anchor: 30 Sept 2026 is index 0 (Tetyana).
const LEGACY_ANCHOR_UTC_MS = Date.UTC(2026, 8, 30);

const mod = (n: number, m: number) => ((n % m) + m) % m;

function utcMsForDate(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function periodIndexForDate(dateStr: string): number {
  return Math.floor((utcMsForDate(dateStr) - ROTATION_START_UTC_MS) / MS_PER_DAY / PERIOD_DAYS);
}

// Which ROTATION_EMAILS index owns `dayOfMonth` during `period`.
function ownerIndex(dayOfMonth: number, period: number): number {
  return mod(dayOfMonth - 1 + period, ROTATION_EMAILS.length);
}

function legacyCalendarIndexForDate(dateStr: string): number {
  const diffDays = Math.round((utcMsForDate(dateStr) - LEGACY_ANCHOR_UTC_MS) / MS_PER_DAY);
  return mod(diffDays, LEGACY_CALENDAR_EMAILS.length);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function dateKeyFromUtcMs(ms: number): string {
  const d = new Date(ms);
  return dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

type RosterUser = { id: string; name: string; email: string };
export type Rosters = { current: RosterUser[]; legacy: RosterUser[] };

async function getRotationUsers(emails: string[]): Promise<RosterUser[]> {
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, name: true, email: true },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  return emails.map((email) => byEmail.get(email)).filter(
    (u): u is NonNullable<typeof u> => !!u
  );
}

// Loads both rosters; returns null (with the missing emails logged) if any
// agent account is missing, since a gap would shift every index after it.
export async function loadRosters(): Promise<Rosters | null> {
  const [current, legacy] = await Promise.all([
    getRotationUsers(ROTATION_EMAILS),
    getRotationUsers(LEGACY_CALENDAR_EMAILS),
  ]);
  if (current.length !== ROTATION_EMAILS.length || legacy.length !== LEGACY_CALENDAR_EMAILS.length) {
    const found = new Set([...current, ...legacy].map((u) => u.email));
    console.error('Request schedule roster incomplete, missing:',
      [...ROTATION_EMAILS, ...LEGACY_CALENDAR_EMAILS].filter((e) => !found.has(e)));
    return null;
  }
  return { current, legacy };
}

function baseAssigneeForDate(dateStr: string, rosters: Rosters): RosterUser {
  if (dateStr < ROTATION_START) return rosters.legacy[legacyCalendarIndexForDate(dateStr)];
  const day = Number(dateStr.slice(8, 10));
  return rosters.current[ownerIndex(day, periodIndexForDate(dateStr))];
}

function isAdmin(user: Express.User): boolean {
  return user.peekviewerAdmin === true;
}

// GET /api/request-schedule?year=&month=  (month is 1-12)
router.get('/', async (req: Request, res: Response) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    const rosters = await loadRosters();
    if (!rosters) {
      return res.status(500).json({ error: 'Rotation roster not found — check that all 5 agent accounts exist' });
    }

    const total = daysInMonth(year, month);
    const from = dateKey(year, month, 1);
    const to = dateKey(year, month, total);

    const overrides = await prisma.requestScheduleOverride.findMany({
      where: { date: { gte: from, lte: to } },
    });
    const overrideByDate = new Map(overrides.map((o) => [o.date, o]));

    const days = [];
    for (let day = 1; day <= total; day++) {
      const date = dateKey(year, month, day);
      const override = overrideByDate.get(date);
      const base = baseAssigneeForDate(date, rosters);
      days.push({
        date,
        userId: override ? override.userId : base.id,
        userName: override ? override.userName : base.name,
        isOverride: !!override,
      });
    }

    // Day-number ownership for the period containing today (Kyiv), shared by
    // both profile lists. Before the rotation starts, show its first period.
    const period = Math.max(0, periodIndexForDate(todayKyivDateStr()));
    const periodStartMs = ROTATION_START_UTC_MS + period * PERIOD_DAYS * MS_PER_DAY;
    const redistribution = rosters.current.map((u, idx) => ({
      userId: u.id,
      userName: u.name,
      days: Array.from({ length: 31 }, (_, i) => i + 1).filter((d) => ownerIndex(d, period) === idx),
    }));

    res.json({
      days,
      redistribution,
      redistributionPeriod: {
        start: dateKeyFromUtcMs(periodStartMs),
        end: dateKeyFromUtcMs(periodStartMs + (PERIOD_DAYS - 1) * MS_PER_DAY),
        next: dateKeyFromUtcMs(periodStartMs + PERIOD_DAYS * MS_PER_DAY),
      },
      calendarAgents: rosters.current.map((u) => ({ userId: u.id, userName: u.name })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch request schedule' });
  }
});

export async function resolveCurrentAssignee(d: string, rosters: Rosters) {
  const existing = await prisma.requestScheduleOverride.findUnique({ where: { date: d } });
  if (existing) return { userId: existing.userId, userName: existing.userName };
  const base = baseAssigneeForDate(d, rosters);
  return { userId: base.id, userName: base.name };
}

// Kyiv-local "today" as "YYYY-MM-DD" — matches how every date in this file is
// keyed (RequestScheduleOverride.date, dateKey()), so this must agree with
// Kyiv wall-clock time rather than the server's UTC clock or a browser's
// local time (same reasoning as cron.ts's getKyivParts, duplicated here in
// miniature to avoid a cross-file dependency for eight lines of formatting).
export function todayKyivDateStr(): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// GET /api/request-schedule/today — who's on duty today (Kyiv-local date),
// for the "your turn" banner. Any Peekviewer team member can check this
// (not just admins) — it's their own reminder, not a management action.
router.get('/today', async (_req: Request, res: Response) => {
  try {
    const rosters = await loadRosters();
    if (!rosters) {
      return res.status(500).json({ error: 'Rotation roster not found' });
    }
    const date = todayKyivDateStr();
    const assignee = await resolveCurrentAssignee(date, rosters);
    res.json({ date, ...assignee });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch today's request schedule assignee" });
  }
});

// POST /api/request-schedule/swap — body: { date, targetDate } both "YYYY-MM-DD".
// Swaps the two dates' assignees. Permitted for whoever is currently assigned
// to either date, any calendar-rotation agent, or a peekviewerAdmin.
router.post('/swap', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { date, targetDate } = req.body as { date?: string; targetDate?: string };
    if (!date || !targetDate || date === targetDate) {
      return res.status(400).json({ error: 'date and targetDate are required and must differ' });
    }

    const rosters = await loadRosters();
    if (!rosters) {
      return res.status(500).json({ error: 'Rotation roster not found' });
    }

    const isRotationMember = rosters.current.some((u) => u.id === me.id);
    if (!isAdmin(me) && !isRotationMember) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    const [current, target] = await Promise.all([
      resolveCurrentAssignee(date, rosters),
      resolveCurrentAssignee(targetDate, rosters),
    ]);

    await prisma.$transaction([
      prisma.requestScheduleOverride.upsert({
        where: { date },
        update: { userId: target.userId, userName: target.userName, setByName: me.name },
        create: { date, userId: target.userId, userName: target.userName, setByName: me.name },
      }),
      prisma.requestScheduleOverride.upsert({
        where: { date: targetDate },
        update: { userId: current.userId, userName: current.userName, setByName: me.name },
        create: { date: targetDate, userId: current.userId, userName: current.userName, setByName: me.name },
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to swap days' });
  }
});

// PATCH /api/request-schedule/assign — body: { date, userId }. Directly sets
// a day's assignee (no swap — clicking an agent chip to change who's on that
// day). userId must be one of the 5 rotation agents. Permitted for
// any calendar-rotation agent or a peekviewerAdmin.
router.patch('/assign', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { date, userId } = req.body as { date?: string; userId?: string };
    if (!date || !userId) {
      return res.status(400).json({ error: 'date and userId are required' });
    }

    const rosters = await loadRosters();
    if (!rosters) {
      return res.status(500).json({ error: 'Rotation roster not found' });
    }

    const isRotationMember = rosters.current.some((u) => u.id === me.id);
    if (!isAdmin(me) && !isRotationMember) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    const target = rosters.current.find((u) => u.id === userId);
    if (!target) {
      return res.status(400).json({ error: 'userId must be one of the rotation agents' });
    }

    await prisma.requestScheduleOverride.upsert({
      where: { date },
      update: { userId: target.id, userName: target.name, setByName: me.name },
      create: { date, userId: target.id, userName: target.name, setByName: me.name },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reassign day' });
  }
});

export default router;
