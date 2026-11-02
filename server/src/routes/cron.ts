// server/src/routes/cron.ts
import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../prisma';
import { sendTelegramMessage } from '../telegram';
import {
  loadRosters, resolveCurrentAssignee, todayKyivDateStr,
  WAVE_EPOCH, WAVE_EPOCH_UTC_MS_EXPORT, MS_PER_DAY_EXPORT,
  waveDayIndex, waveFirstAgentIndex, waveOwnerIndex,
  loadWaveRoster,
  getRedistribForNotification, REDISTRIB_EPOCH,
} from './requestSchedule';

// ─── Wave reminder helpers ────────────────────────────────────────────────────

const UA_MONTHS = [
  'січня','лютого','березня','квітня','травня','червня',
  'липня','серпня','вересня','жовтня','листопада','грудня',
];

function waveDateFromIndex(dayIdx: number): Date {
  return new Date(WAVE_EPOCH_UTC_MS_EXPORT + dayIdx * MS_PER_DAY_EXPORT);
}

function formatWaveRange(startIdx: number, endIdx: number): string {
  const s = waveDateFromIndex(startIdx);
  const e = waveDateFromIndex(endIdx);
  const sd = s.getUTCDate(), ed = e.getUTCDate();
  const sm = UA_MONTHS[s.getUTCMonth()], em = UA_MONTHS[e.getUTCMonth()];
  return s.getUTCMonth() === e.getUTCMonth()
    ? `${sd}–${ed} ${sm}`
    : `${sd} ${sm} – ${ed} ${em}`;
}

function groupConsecutive(indices: number[]): { start: number; end: number }[] {
  if (!indices.length) return [];
  const result: { start: number; end: number }[] = [];
  let start = indices[0], prev = indices[0];
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === prev + 1) { prev = indices[i]; continue; }
    result.push({ start, end: prev });
    start = prev = indices[i];
  }
  result.push({ start, end: prev });
  return result;
}

function buildWaveMessage(agentWaveIndices: number[], todayIdx: number): string {
  const ranges = groupConsecutive(agentWaveIndices);
  const rangeLines = ranges.map(({ start, end }) => `• ${formatWaveRange(start, end)}`).join('\n');
  const todayDate = waveDateFromIndex(todayIdx);
  const todayLabel = `${todayDate.getUTCDate()} ${UA_MONTHS[todayDate.getUTCMonth()]}`;
  const cycleNum = Math.floor(todayIdx / 9) + 1;
  const header = cycleNum > 1
    ? `📋 Сьогодні (${todayLabel}) починається твоя нова хвиля — це вже цикл №${cycleNum}.`
    : `📋 Сьогодні (${todayLabel}) починається твоя нова хвиля!`;
  return `${header}\nТи зараз опрацьовуєш:\n${rangeLines}`;
}

// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  const secret = req.header('X-Cron-Secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
router.use(requireCronSecret);

type ReminderType =
  | 'MORNING_LOGIN' | 'MORNING_PROXY_1' | 'MORNING_PROXY_2' | 'MORNING_PROXY_3' | 'MORNING_LOGOUT'
  | 'NIGHT_LOGIN' | 'NIGHT_PROXY_1' | 'NIGHT_PROXY_2' | 'NIGHT_PROXY_3' | 'NIGHT_LOGOUT';

interface ReminderDef {
  type: ReminderType;
  targetMinutes: number; // minutes since Kyiv-local midnight
  shiftType: 'MORNING' | 'NIGHT';
  dayOffset: 0 | -1; // which Kyiv-calendar-day's CalendarEvent.eventDate to look up, relative to "today"
  message: string;
}

// Reminders fire in [targetMinutes, targetMinutes + TOLERANCE_MINUTES) rather than at an exact
// instant, because the external scheduler (GitHub Actions) that hits this endpoint makes no timing
// guarantee. Correctness (exactly once, never silently forever-missed within the window) comes
// from this window combined with the TelegramReminderLog unique constraint below.
//
// This was originally 5 minutes on the assumption GitHub Actions' */5 schedule would land roughly
// on time. In production it doesn't: checking the actual workflow run history (GitHub Actions API)
// shows real invocations spaced 1-3.5 HOURS apart, not 5 minutes — GitHub silently throttles
// frequent `schedule` triggers under platform load, and there is no configuration fix for this on
// our end. Confirmed via TelegramReminderLog: in this feature's entire history, exactly one
// reminder (a single MORNING_START) had ever actually fired before this window was widened — every
// PROXY_* reminder had silently never landed inside its old 5-minute window at all.
// 240 minutes comfortably exceeds the worst observed gap (~3.5h) with margin, while still keeping
// a reminder same-day relevant. This does NOT affect task-reminders below, which intentionally
// keeps its own much narrower window (see TASK_REMINDER_WINDOW_MS) since a stale "due tomorrow"
// message hours late would be actively misleading in a way a shift/proxy nudge would not be.
const TOLERANCE_MINUTES = 240;

const LOGIN_MESSAGE = 'бро, ти вже на зміні? залогуйся в CareSpace, будь ласка 🙏';
const LOGOUT_MESSAGE = 'бро, зміна майже закінчилась! не забудь заповнити звіт і натиснути End Shift в CareSpace ✅';
const PROXY_MESSAGE = '🔒 Не забудь увімкнути Структура Проксі';

const REMINDERS: ReminderDef[] = [
  // Morning shift (09:00–17:00 Kyiv)
  { type: 'MORNING_LOGIN', targetMinutes: 9 * 60 + 20, shiftType: 'MORNING', dayOffset: 0, message: LOGIN_MESSAGE },
  { type: 'MORNING_PROXY_1', targetMinutes: 9 * 60 + 20, shiftType: 'MORNING', dayOffset: 0, message: PROXY_MESSAGE },
  { type: 'MORNING_PROXY_2', targetMinutes: 13 * 60, shiftType: 'MORNING', dayOffset: 0, message: PROXY_MESSAGE },
  { type: 'MORNING_PROXY_3', targetMinutes: 16 * 60 + 50, shiftType: 'MORNING', dayOffset: 0, message: PROXY_MESSAGE },
  { type: 'MORNING_LOGOUT', targetMinutes: 16 * 60 + 40, shiftType: 'MORNING', dayOffset: 0, message: LOGOUT_MESSAGE },
  // Night shift (17:00–01:00 Kyiv)
  { type: 'NIGHT_LOGIN', targetMinutes: 17 * 60 + 20, shiftType: 'NIGHT', dayOffset: 0, message: LOGIN_MESSAGE },
  { type: 'NIGHT_PROXY_1', targetMinutes: 17 * 60 + 20, shiftType: 'NIGHT', dayOffset: 0, message: PROXY_MESSAGE },
  { type: 'NIGHT_PROXY_2', targetMinutes: 21 * 60, shiftType: 'NIGHT', dayOffset: 0, message: PROXY_MESSAGE },
  // 00:40/00:50 — by the time these fire, the Kyiv calendar day has already rolled over past
  // midnight, but the night shift ending "now" was scheduled against YESTERDAY's
  // CalendarEvent.eventDate, not today's. These are the reminder types that look a day back.
  { type: 'NIGHT_LOGOUT', targetMinutes: 0 * 60 + 40, shiftType: 'NIGHT', dayOffset: -1, message: LOGOUT_MESSAGE },
  { type: 'NIGHT_PROXY_3', targetMinutes: 0 * 60 + 50, shiftType: 'NIGHT', dayOffset: -1, message: PROXY_MESSAGE },
];

function getKyivParts(date: Date): { minutesSinceMidnight: number; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  let hour = get('hour');
  if (hour === 24) hour = 0; // some ICU builds emit "24" for midnight with hour12:false
  return { year: get('year'), month: get('month'), day: get('day'), minutesSinceMidnight: hour * 60 + get('minute') };
}

// Builds the Kyiv-calendar date as a plain UTC-midnight marker, matching how CalendarEvent.eventDate
// is stored/queried everywhere else in the app (a day marker, not a real instant).
function kyivDateBoundary(year: number, month: number, day: number, offsetDays: number): { dateStr: string; start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, day));
  start.setUTCDate(start.getUTCDate() + offsetDays);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + 1;
  const d = start.getUTCDate();
  return { dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, start, end };
}

function getKyivDateTimeParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  let hour = get('hour');
  if (hour === 24) hour = 0; // some ICU builds emit "24" for midnight with hour12:false
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute') };
}

// Converts a Kyiv-local wall-clock date/time into the UTC instant it represents, via
// fixed-point iteration: guess the instant assuming 0 offset, check what Kyiv wall time
// that guess actually maps to, and correct by the difference. Converges in 1-2 passes
// since Kyiv's UTC+2/+3 offset doesn't change within that small a gap (DST transition
// weekends are the one edge case worth a manual spot-check, same caveat as the shift
// reminders above).
function kyivLocalToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const targetMs = Date.UTC(year, month - 1, day, hour, minute);
  let guessMs = targetMs;
  for (let i = 0; i < 3; i++) {
    const got = getKyivDateTimeParts(new Date(guessMs));
    const gotMs = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
    const diff = targetMs - gotMs;
    if (diff === 0) break;
    guessMs += diff;
  }
  return guessMs;
}

// My Plans tasks with a due date but no due time are treated as due at this Kyiv hour.
const DEFAULT_DUE_HOUR = 9;
const TASK_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
// Deliberately its own (narrow) constant, decoupled from the shift/proxy TOLERANCE_MINUTES above —
// widening this one would mean a "due tomorrow" nudge could arrive hours late, past the point of
// being useful. NOTE: this narrow window likely suffers from the exact same GitHub Actions
// scheduling gap documented above, meaning task-reminders may also be rarely firing in practice —
// flagged but intentionally left unchanged pending an explicit decision on that tradeoff.
const TASK_REMINDER_TOLERANCE_MINUTES = 5;
const TASK_REMINDER_WINDOW_MS = TASK_REMINDER_TOLERANCE_MINUTES * 60 * 1000;

// GET /api/cron/task-reminders — 24h-before-due Telegram reminder for My Plans tasks.
// One-shot per task (guarded by Plan.reminderSent, reset if the due date/time is edited)
// rather than a recurring dedup log like shift reminders, since a task only ever needs
// one "due tomorrow" nudge. If the window is missed entirely (e.g. the scheduler was
// down), it's intentionally never sent late — a stale "due tomorrow" message once the
// task is due sooner (or overdue) would be actively misleading.
router.get('/task-reminders', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    const sent: string[] = [];

    const candidates = await prisma.plan.findMany({
      where: { completed: false, reminderSent: false, date: { not: null } },
    });

    // Batch-resolve every candidate's owner in one query instead of one findUnique
    // per plan — the per-row work below is now a Map lookup, not a DB round-trip.
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(candidates.map((p) => p.userId))] }, active: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    for (const plan of candidates) {
      // Legacy "YYYY-MM" (month-only) values from the old monthly-goals view have no day component.
      if (!plan.date || plan.date.length < 10) continue;

      const [y, m, d] = plan.date.split('-').map(Number);
      let hour = DEFAULT_DUE_HOUR;
      let minute = 0;
      if (plan.dueTime) {
        const [hh, mm] = plan.dueTime.split(':').map(Number);
        if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
          hour = hh;
          minute = mm;
        }
      }

      const dueMs = kyivLocalToUtcMs(y, m, d, hour, minute);
      const reminderAt = dueMs - TASK_REMINDER_LEAD_MS;
      if (now < reminderAt || now >= reminderAt + TASK_REMINDER_WINDOW_MS) continue;

      const user = userById.get(plan.userId);
      if (!user?.telegramChatId) continue;

      const claim = await prisma.plan.updateMany({
        where: { id: plan.id, reminderSent: false },
        data: { reminderSent: true },
      });
      if (claim.count === 0) continue; // already claimed by a concurrent invocation

      await sendTelegramMessage(user.telegramChatId, `⏰ Reminder: Task due tomorrow — '${plan.title}' · carespace.struktura.io`);
      sent.push(plan.id);
    }

    res.json({ ok: true, sent });
  } catch (err) {
    console.error('Task reminder cron error:', err);
    res.status(500).json({ error: 'Failed to process task reminders' });
  }
});

// GET /api/cron/shift-reminders — hit by an external scheduler (see .github/workflows/shift-reminders.yml).
// Covers login, logout, and proxy-enable nudges for both shifts — all sourced from the Shift
// Calendar (CalendarEvent), since proxy reminders are no longer tied to an active Daily Log entry:
// they go to whoever is *scheduled* for a shift that day, same as the login/logout reminders.
router.get('/shift-reminders', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const kyiv = getKyivParts(now);
    const kyivHH = String(Math.floor(kyiv.minutesSinceMidnight / 60)).padStart(2, '0');
    const kyivMM = String(kyiv.minutesSinceMidnight % 60).padStart(2, '0');
    console.log(`[shift-reminders] fired at ${now.toISOString()} (UTC) = ${kyivHH}:${kyivMM} Kyiv, ${kyiv.year}-${kyiv.month}-${kyiv.day}`);
    const sent: string[] = [];

    for (const reminder of REMINDERS) {
      const diff = kyiv.minutesSinceMidnight - reminder.targetMinutes;
      const inWindow = diff >= 0 && diff < TOLERANCE_MINUTES;
      console.log(`[shift-reminders] ${reminder.type}: target ${Math.floor(reminder.targetMinutes / 60)}:${String(reminder.targetMinutes % 60).padStart(2, '0')} Kyiv, diff=${diff}min, inWindow=${inWindow}`);
      if (!inWindow) continue;

      const { dateStr, start, end } = kyivDateBoundary(kyiv.year, kyiv.month, kyiv.day, reminder.dayOffset);

      const events = await prisma.calendarEvent.findMany({
        where: {
          leaveType: 'SHIFT',
          shiftType: reminder.shiftType,
          archived: false,
          eventDate: { gte: start, lt: end },
        },
      });
      console.log(`[shift-reminders] ${reminder.type}: ${events.length} scheduled ${reminder.shiftType} shift(s) found for ${dateStr}`);

      // Batch-resolve all scheduled agents' users in one query instead of one
      // findFirst per calendar event.
      const eventAgentUsers = await prisma.user.findMany({
        where: { agentId: { in: [...new Set(events.map((e) => e.agentId))] }, active: true },
      });
      const eventUserByAgentId = new Map(eventAgentUsers.map((u) => [u.agentId as string, u]));

      for (const event of events) {
        const agentUser = eventUserByAgentId.get(event.agentId);
        if (!agentUser?.telegramChatId) continue;
        if (agentUser.role === 'peek_handler') continue; // support-agent reminders only

        try {
          await prisma.telegramReminderLog.create({
            data: { agentId: event.agentId, reminderType: reminder.type, shiftDate: dateStr },
          });
        } catch (err: unknown) {
          if ((err as { code?: string })?.code === 'P2002') continue; // already sent for this agent/type/day
          throw err;
        }

        await sendTelegramMessage(agentUser.telegramChatId, reminder.message);
        sent.push(`${event.agentId}:${reminder.type}:${dateStr}`);
      }
    }

    res.json({ ok: true, sent });
  } catch (err) {
    console.error('Shift reminder cron error:', err);
    res.status(500).json({ error: 'Failed to process shift reminders' });
  }
});

const REQUEST_SCHEDULE_REMINDER_TARGET_MINUTES = 10 * 60;

// GET /api/cron/request-schedule-reminder — 10:00 Kyiv.
// Wave era (Nov 2026+): sent to the agent whose new wave starts today;
//   message lists every wave range they're currently managing.
// Legacy era: sent to whoever is on duty today; simple nudge.
router.get('/request-schedule-reminder', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const kyiv = getKyivParts(now);
    const diff = kyiv.minutesSinceMidnight - REQUEST_SCHEDULE_REMINDER_TARGET_MINUTES;
    const inWindow = diff >= 0 && diff < TOLERANCE_MINUTES;
    if (!inWindow) return res.json({ ok: true, sent: [], reason: 'out of window' });

    const dateStr = todayKyivDateStr();
    const sent: string[] = [];

    if (dateStr >= WAVE_EPOCH) {
      // ── Wave era ────────────────────────────────────────────────────────
      const waveRoster = await loadWaveRoster();
      if (!waveRoster) return res.json({ ok: true, sent: [] });

      const todayIdx = waveDayIndex(dateStr);
      const firstIdx = waveFirstAgentIndex(todayIdx); // agent receiving new clients today

      // Collect all wave day indices this agent currently manages
      const managed: number[] = [];
      for (let c = 0; c <= todayIdx; c++) {
        if (waveOwnerIndex(c, todayIdx) === firstIdx) managed.push(c);
      }

      const agent = waveRoster[firstIdx];
      const user = await prisma.user.findUnique({ where: { id: agent.id } });
      if (!user?.active || !user.telegramChatId) return res.json({ ok: true, sent: [] });

      try {
        await prisma.requestScheduleReminderLog.create({ data: { userId: user.id, date: dateStr } });
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'P2002') return res.json({ ok: true, sent: [] });
        throw err;
      }

      await sendTelegramMessage(user.telegramChatId, buildWaveMessage(managed, todayIdx));
      sent.push(`${user.id}:${dateStr}`);
    } else {
      // ── Legacy era ──────────────────────────────────────────────────────
      const rosters = await loadRosters();
      if (!rosters) return res.json({ ok: true, sent: [] });

      const assignee = await resolveCurrentAssignee(dateStr, rosters);
      const user = await prisma.user.findUnique({ where: { id: assignee.userId } });
      if (!user?.active || !user.telegramChatId) return res.json({ ok: true, sent: [] });

      try {
        await prisma.requestScheduleReminderLog.create({ data: { userId: user.id, date: dateStr } });
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'P2002') return res.json({ ok: true, sent: [] });
        throw err;
      }

      await sendTelegramMessage(user.telegramChatId, 'Твоя черга кидати запити на нові профілі! 📋');
      sent.push(`${user.id}:${dateStr}`);
    }

    res.json({ ok: true, sent });
  } catch (err) {
    console.error('Request schedule reminder cron error:', err);
    res.status(500).json({ error: 'Failed to process request schedule reminder' });
  }
});

// GET /api/cron/redistribution-reminder — 10:00 Kyiv on the 1st of each month.
// Sends each of the 3 wave agents their personal redistribution dates for the month.
// Dedups via RequestScheduleReminderLog with key "redistrib:YYYY-MM".
router.get('/redistribution-reminder', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const kyiv = getKyivParts(now);
    const diff = kyiv.minutesSinceMidnight - REQUEST_SCHEDULE_REMINDER_TARGET_MINUTES;
    const inWindow = diff >= 0 && diff < TOLERANCE_MINUTES;
    if (!inWindow) return res.json({ ok: true, sent: [], reason: 'out of window' });

    // Only fires on the 1st of the month in the redistribution era
    if (kyiv.day !== 1) return res.json({ ok: true, sent: [], reason: 'not 1st of month' });
    if (kyiv.year < REDISTRIB_EPOCH.year || (kyiv.year === REDISTRIB_EPOCH.year && kyiv.month < REDISTRIB_EPOCH.month)) {
      return res.json({ ok: true, sent: [], reason: 'before redistribution era' });
    }

    const rows = await getRedistribForNotification(kyiv.year, kyiv.month);
    if (!rows) return res.json({ ok: true, sent: [] });

    const ua_month_names = [
      'січень','лютий','березень','квітень','травень','червень',
      'липень','серпень','вересень','жовтень','листопад','грудень',
    ];
    const monthLabel = `${ua_month_names[kyiv.month - 1]} ${kyiv.year}`;
    const dedupKey = `redistrib:${kyiv.year}-${String(kyiv.month).padStart(2, '0')}`;

    const userIds = rows.map((r) => r.userId);
    const users = await prisma.user.findMany({ where: { id: { in: userIds }, active: true } });
    const userById = new Map(users.map((u) => [u.id, u]));

    const sent: string[] = [];
    for (const row of rows) {
      const user = userById.get(row.userId);
      if (!user?.telegramChatId) continue;

      try {
        await prisma.requestScheduleReminderLog.create({ data: { userId: user.id, date: dedupKey } });
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'P2002') continue; // already sent this month
        throw err;
      }

      const daysStr = row.days.join(' · ');
      const message = `📊 Перерозподіл активних і неактивних профілів на ${monthLabel}:\nТвої числа: ${daysStr}`;
      await sendTelegramMessage(user.telegramChatId, message);
      sent.push(`${user.id}:${dedupKey}`);
    }

    res.json({ ok: true, sent });
  } catch (err) {
    console.error('Redistribution reminder cron error:', err);
    res.status(500).json({ error: 'Failed to process redistribution reminder' });
  }
});

export default router;
