// server/src/routes/requestSchedule.ts
// Peekviewer Team — "Request Schedule" tab. Code-defined rotation (no
// spreadsheet, confirmed with the user).
//
// From 2026-10-01 there is ONE schedule for everything: the calendar (who's
// on duty to submit ("throw") new-profile requests each day), "Перерозподіл
// активних профілів" and "Розподіл неактивних профілів" all use the same
// day-number ownership. Each rotation agent owns one day-of-month class
// (mod roster size, e.g. 1 · 6 · 11 · … with 5 agents) for a 14-day period, applied to
// every month (for the profile lists: every month back to 30.09.2022; for the
// calendar: the date's own day-of-month). Every 14 days the classes rotate —
// each agent moves one class down (1 → 5 → 4 → 3 → 2 → 1) — so nobody keeps
// the same numbers for more than one period and each class comes back only
// every N periods. Shifting down (not up) also means the agent on
// the last day of a period is never on the first day of the next one.
//
// The first period's classes were picked to overlap as little as possible
// with September 2026's "Перерозподіл активних профілів" (mod-4 order Iryna -
// Tetyana - Yana - Tetyana Fomyuk): each existing agent keeps exactly one day
// number from September, which is the minimum possible. Diana Semeniuk joined
// the rotation on 2026-10-01; Iryna left in October 2026, so from 2026-11-01
// a 4-agent era takes over (see ERAS below).
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

// Rotation eras. Each era has its own roster and its own 14-day period
// anchor; index i owns day class i+1 (mod roster size) in the era's period 0.
//
// October 2026 (5 agents, period 0 = 01.10–14.10):
//   Tetyana Fomyuk 1 · 6 · 11…, Diana 2 · 7…, Iryna 3 · 8…, Tetyana 4 · 9…,
//   Yana 5 · 10…
// Iryna Kolodienko left the company in October 2026 — she stays on her
// October days (requested), and from 01.11.2026 the rotation runs with the
// remaining 4 (period 0 = 01.11–14.11): Tetyana Fomyuk 1 · 5 · 9…,
// Diana 2 · 6…, Tetyana 3 · 7…, Yana 4 · 8…
type Era = { start: string; startMs: number; emails: string[] };
const ERAS: Era[] = [
  {
    start: '2026-10-01',
    startMs: Date.UTC(2026, 9, 1),
    emails: [
      'tetyana_fomyuk@struktura.io',
      'diana_semenuk@struktura.io',
      'iryna_kolodienko@struktura.io',
      'tetiana_veremeenko@struktura.io',
      'yana_fedorova@struktura.io',
    ],
  },
  {
    start: '2026-11-01',
    startMs: Date.UTC(2026, 10, 1),
    emails: [
      'tetyana_fomyuk@struktura.io',
      'diana_semenuk@struktura.io',
      'tetiana_veremeenko@struktura.io',
      'yana_fedorova@struktura.io',
    ],
  },
];

// Pre-October calendar order, only for dates before the first era.
const LEGACY_CALENDAR_EMAILS = [
  'tetiana_veremeenko@struktura.io',
  'iryna_kolodienko@struktura.io',
  'tetyana_fomyuk@struktura.io',
  'yana_fedorova@struktura.io',
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ROTATION_START = ERAS[0].start;
const PERIOD_DAYS = 14;
// Legacy continuous formula anchor: 30 Sept 2026 is index 0 (Tetyana).
const LEGACY_ANCHOR_UTC_MS = Date.UTC(2026, 8, 30);

const mod = (n: number, m: number) => ((n % m) + m) % m;

// ─── Wave rotation era (from 2026-11-01) ────────────────────────────────
// New clients arriving on a given day form a "wave" for that day.
// Waves are assigned in 3-day blocks, blocks rotate across 9-day cycles:
//   Diana (0) → Tetyana (1) → Yana (2) → Diana …
// Every 9 days all existing waves pass to the next agent.
export const WAVE_EPOCH = '2026-11-01';
const WAVE_EPOCH_UTC_MS = Date.UTC(2026, 10, 1);
const WAVE_AGENT_EMAILS = [
  'diana_semenuk@struktura.io',      // index 0 — Diana Semeniuk
  'tetiana_veremeenko@struktura.io', // index 1 — Tetyana Veremeyenko
  'yana_fedorova@struktura.io',      // index 2 — Yana Fedorova
];

function waveDayIndex(dateStr: string): number {
  return Math.round((utcMsForDate(dateStr) - WAVE_EPOCH_UTC_MS) / MS_PER_DAY);
}

// Which agent (0/1/2) is first assigned to the wave born on dayIdx.
export function waveFirstAgentIndex(dayIdx: number): number {
  return mod(Math.floor(dayIdx / 3), 3);
}

// Who currently owns the wave born on waveDayIdx, viewed on viewDayIdx.
export function waveOwnerIndex(waveDayIdx: number, viewDayIdx: number): number {
  const first = waveFirstAgentIndex(waveDayIdx);
  return mod(first + Math.floor(viewDayIdx / 9) - Math.floor(waveDayIdx / 9), 3);
}

function utcMsForDate(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

// Index into ERAS for a date on/after the first era (latest era started by then).
function eraIndexForDate(dateStr: string): number {
  let idx = 0;
  ERAS.forEach((e, i) => { if (dateStr >= e.start) idx = i; });
  return idx;
}

function periodIndexForDate(dateStr: string, era: Era): number {
  return Math.floor((utcMsForDate(dateStr) - era.startMs) / MS_PER_DAY / PERIOD_DAYS);
}

// Which roster index owns `dayOfMonth` during `period` of a `size`-agent era.
function ownerIndex(dayOfMonth: number, period: number, size: number): number {
  return mod(dayOfMonth - 1 + period, size);
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
// eras[i] is ERAS[i]'s roster; current is the latest era's (today's team).
export type Rosters = { eras: RosterUser[][]; current: RosterUser[]; legacy: RosterUser[] };

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

// Loads every roster; returns null (with the missing emails logged) if any
// agent account is missing, since a gap would shift every index after it.
export async function loadRosters(): Promise<Rosters | null> {
  const lists = [...ERAS.map((e) => e.emails), LEGACY_CALENDAR_EMAILS];
  const loaded = await Promise.all(lists.map(getRotationUsers));
  if (loaded.some((users, i) => users.length !== lists[i].length)) {
    const found = new Set(loaded.flat().map((u) => u.email));
    console.error('Request schedule roster incomplete, missing:', lists.flat().filter((e) => !found.has(e)));
    return null;
  }
  const eras = loaded.slice(0, ERAS.length);
  return { eras, current: eras[eras.length - 1], legacy: loaded[ERAS.length] };
}

async function loadWaveRoster(): Promise<RosterUser[] | null> {
  const users = await getRotationUsers(WAVE_AGENT_EMAILS);
  if (users.length !== WAVE_AGENT_EMAILS.length) {
    const found = new Set(users.map((u) => u.email));
    console.error('Wave roster incomplete, missing:', WAVE_AGENT_EMAILS.filter((e) => !found.has(e)));
    return null;
  }
  return users;
}

function baseAssigneeForDate(dateStr: string, rosters: Rosters): RosterUser {
  if (dateStr < ROTATION_START) return rosters.legacy[legacyCalendarIndexForDate(dateStr)];
  const eraIdx = eraIndexForDate(dateStr);
  const roster = rosters.eras[eraIdx];
  const day = Number(dateStr.slice(8, 10));
  return roster[ownerIndex(day, periodIndexForDate(dateStr, ERAS[eraIdx]), roster.length)];
}

// Agents who can be put on `dateStr` — that date's era roster.
function rosterForDate(dateStr: string, rosters: Rosters): RosterUser[] {
  return dateStr < ROTATION_START ? rosters.legacy : rosters.eras[eraIndexForDate(dateStr)];
}

// Anyone in any era roster may swap/reassign days (admins always may).
function isRotationMember(userId: string, rosters: Rosters): boolean {
  return rosters.eras.some((roster) => roster.some((u) => u.id === userId));
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

    const firstDayOfMonth = dateKey(year, month, 1);
    const isWaveMonth = firstDayOfMonth >= WAVE_EPOCH;

    // Load rosters needed for this month
    const rosters = isWaveMonth ? null : await loadRosters();
    if (!isWaveMonth && !rosters) {
      return res.status(500).json({ error: 'Rotation roster not found — check that every rotation agent account exists' });
    }

    const waveRoster = isWaveMonth ? await loadWaveRoster() : null;
    if (isWaveMonth && !waveRoster) {
      return res.status(500).json({ error: 'Wave roster incomplete — check that Diana, Tetyana and Yana accounts exist' });
    }

    // For mixed months (Oct 2026 straddles no boundary since wave starts Nov 1),
    // load both if the month contains both legacy and wave days.
    const total = daysInMonth(year, month);
    const lastDayOfMonth = dateKey(year, month, total);
    const hasLegacyDays = firstDayOfMonth < WAVE_EPOCH;
    const hasWaveDays = lastDayOfMonth >= WAVE_EPOCH;

    const rostersForLegacy = hasLegacyDays ? (rosters ?? await loadRosters()) : null;
    const waveRosterForMonth = hasWaveDays ? (waveRoster ?? await loadWaveRoster()) : null;

    if (hasLegacyDays && !rostersForLegacy) {
      return res.status(500).json({ error: 'Rotation roster not found' });
    }
    if (hasWaveDays && !waveRosterForMonth) {
      return res.status(500).json({ error: 'Wave roster incomplete' });
    }

    const from = dateKey(year, month, 1);
    const to = dateKey(year, month, total);

    const overrides = hasLegacyDays
      ? await prisma.requestScheduleOverride.findMany({ where: { date: { gte: from, lte: to } } })
      : [];
    const overrideByDate = new Map(overrides.map((o) => [o.date, o]));

    const days = [];
    for (let day = 1; day <= total; day++) {
      const date = dateKey(year, month, day);
      if (date >= WAVE_EPOCH) {
        const dayIdx = waveDayIndex(date);
        days.push({
          date,
          firstAgentIndex: waveFirstAgentIndex(dayIdx),
          waveDayIndex: dayIdx,
          // Keep legacy fields empty so old clients don't break
          userId: '',
          userName: '',
          isOverride: false,
        });
      } else {
        const override = overrideByDate.get(date);
        const base = baseAssigneeForDate(date, rostersForLegacy!);
        days.push({
          date,
          userId: override ? override.userId : base.id,
          userName: override ? override.userName : base.name,
          isOverride: !!override,
        });
      }
    }

    // ── Legacy redistribution (only for months before the wave era) ──────
    let redistribution: object[] = [];
    let redistributionPeriod: object | null = null;
    if (hasLegacyDays && rostersForLegacy) {
      const today = todayKyivDateStr();
      const eraIdx = today < ROTATION_START ? 0 : eraIndexForDate(today);
      const era = ERAS[eraIdx];
      const eraRoster = rostersForLegacy.eras[eraIdx];
      const period = Math.max(0, periodIndexForDate(today, era));
      const periodStartMs = era.startMs + period * PERIOD_DAYS * MS_PER_DAY;
      const nextEraMs = ERAS[eraIdx + 1]?.startMs ?? Infinity;
      const nextPeriodMs = Math.min(periodStartMs + PERIOD_DAYS * MS_PER_DAY, nextEraMs);
      redistribution = eraRoster.map((u, idx) => ({
        userId: u.id,
        userName: u.name,
        days: Array.from({ length: 31 }, (_, i) => i + 1).filter((d) => ownerIndex(d, period, eraRoster.length) === idx),
      }));
      redistributionPeriod = {
        start: dateKeyFromUtcMs(periodStartMs),
        end: dateKeyFromUtcMs(nextPeriodMs - MS_PER_DAY),
        next: dateKeyFromUtcMs(nextPeriodMs),
      };
    }

    // ── Calendar agents ──────────────────────────────────────────────────────
    // For wave months: the 3 wave agents in rotation order.
    // For legacy months: every roster in effect on any day of the month.
    let calendarAgentsMap = new Map<string, RosterUser>();
    if (hasWaveDays && waveRosterForMonth) {
      for (const u of waveRosterForMonth) calendarAgentsMap.set(u.id, u);
    }
    if (hasLegacyDays && rostersForLegacy) {
      for (let day = 1; day <= total; day++) {
        const date = dateKey(year, month, day);
        if (date < WAVE_EPOCH) {
          for (const u of rosterForDate(date, rostersForLegacy)) calendarAgentsMap.set(u.id, u);
        }
      }
    }

    res.json({
      days,
      redistribution,
      redistributionPeriod,
      calendarAgents: [...calendarAgentsMap.values()].map((u) => ({ userId: u.id, userName: u.name })),
      waveEpoch: WAVE_EPOCH,
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

// For the wave era: who is the first agent for a given date's wave
// (i.e. who submits new requests that day). No override concept — the formula
// is pure and deterministic.
async function resolveWaveTodayAssignee(d: string): Promise<{ userId: string; userName: string } | null> {
  const waveRoster = await loadWaveRoster();
  if (!waveRoster) return null;
  const idx = waveDayIndex(d);
  const agentIdx = waveFirstAgentIndex(idx);
  const agent = waveRoster[agentIdx];
  return { userId: agent.id, userName: agent.name };
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
// for the "your turn" banner. In the wave era "on duty" = first agent for
// today's wave (who submits new-profile requests for today's new clients).
router.get('/today', async (_req: Request, res: Response) => {
  try {
    const date = todayKyivDateStr();
    if (date >= WAVE_EPOCH) {
      const assignee = await resolveWaveTodayAssignee(date);
      if (!assignee) return res.status(500).json({ error: 'Wave roster incomplete' });
      return res.json({ date, ...assignee });
    }
    const rosters = await loadRosters();
    if (!rosters) {
      return res.status(500).json({ error: 'Rotation roster not found' });
    }
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

    const isMember = isRotationMember(me.id, rosters);
    if (!isAdmin(me) && !isMember) {
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

    const isMember = isRotationMember(me.id, rosters);
    if (!isAdmin(me) && !isMember) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    const target = rosterForDate(date, rosters).find((u) => u.id === userId);
    if (!target) {
      return res.status(400).json({ error: 'userId must be one of the rotation agents for that date' });
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
