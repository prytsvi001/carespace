// server/src/routes/requestSchedule.ts
// Peekviewer Team — "Request Schedule" tab. Two independent, code-defined
// rotations (no spreadsheet, confirmed with the user) that happen to share
// the same 4 agents but are NOT the same schedule:
//   - The calendar: who's on duty to submit ("throw") new-profile requests
//     each day. Order: Tetyana - Iryna - Victoria Horopeka - Yana.
//   - "Перерозподіл активних профілів": a separate reference list of which
//     day-numbers each agent owns. Order: Tetyana - Yana - Victoria Horopeka
//     - Iryna (matches the original tool's static lists).
// Both use the same day%4 remainder formula, just with a different agent
// order plugged in. Only the calendar has persisted overrides — swaps
// (drag-and-drop) or direct reassignment (click a day's chip) layer on top
// of the calendar formula for that one date.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth, requirePeekviewerTeam } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePeekviewerTeam);

const CALENDAR_ROTATION_EMAILS = [
  'tetiana_veremeenko@struktura.io',
  'iryna_kolodienko@struktura.io',
  'victoria_horopeka@struktura.io',
  'yana_fedorova@struktura.io',
];

const REDISTRIBUTION_ROTATION_EMAILS = [
  'tetiana_veremeenko@struktura.io',
  'yana_fedorova@struktura.io',
  'victoria_horopeka@struktura.io',
  'iryna_kolodienko@struktura.io',
];

function rotationIndexForDay(dayOfMonth: number): number {
  const r = dayOfMonth % 4;
  return r === 1 ? 0 : r === 2 ? 1 : r === 3 ? 2 : 3;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

async function getRotationUsers(emails: string[]) {
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, name: true, email: true },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  return emails.map((email) => byEmail.get(email)).filter(
    (u): u is NonNullable<typeof u> => !!u
  );
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

    const [calendarRotation, redistributionRotation] = await Promise.all([
      getRotationUsers(CALENDAR_ROTATION_EMAILS),
      getRotationUsers(REDISTRIBUTION_ROTATION_EMAILS),
    ]);
    if (calendarRotation.length === 0 || redistributionRotation.length === 0) {
      return res.status(500).json({ error: 'Rotation roster not found — check that the 4 agent accounts exist' });
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
      const base = calendarRotation[rotationIndexForDay(day)];
      days.push({
        date,
        userId: override ? override.userId : base.id,
        userName: override ? override.userName : base.name,
        isOverride: !!override,
      });
    }

    // Reference list only — independent of the calendar above, unaffected by
    // swaps/reassignments, and not limited to the displayed month.
    const redistribution = redistributionRotation.map((u, idx) => ({
      userId: u.id,
      userName: u.name,
      days: Array.from({ length: 31 }, (_, i) => i + 1).filter((d) => rotationIndexForDay(d) === idx),
    }));

    res.json({
      days,
      redistribution,
      calendarAgents: calendarRotation.map((u) => ({ userId: u.id, userName: u.name })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch request schedule' });
  }
});

async function resolveCurrentAssignee(d: string, calendarRotation: { id: string; name: string }[]) {
  const existing = await prisma.requestScheduleOverride.findUnique({ where: { date: d } });
  if (existing) return { userId: existing.userId, userName: existing.userName };
  const [, , day] = d.split('-').map(Number);
  const base = calendarRotation[rotationIndexForDay(day)];
  return { userId: base.id, userName: base.name };
}

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

    const calendarRotation = await getRotationUsers(CALENDAR_ROTATION_EMAILS);
    if (calendarRotation.length === 0) {
      return res.status(500).json({ error: 'Rotation roster not found' });
    }

    const isRotationMember = calendarRotation.some((u) => u.id === me.id);
    if (!isAdmin(me) && !isRotationMember) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    const [current, target] = await Promise.all([
      resolveCurrentAssignee(date, calendarRotation),
      resolveCurrentAssignee(targetDate, calendarRotation),
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
// day). userId must be one of the 4 calendar-rotation agents. Permitted for
// any calendar-rotation agent or a peekviewerAdmin.
router.patch('/assign', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { date, userId } = req.body as { date?: string; userId?: string };
    if (!date || !userId) {
      return res.status(400).json({ error: 'date and userId are required' });
    }

    const calendarRotation = await getRotationUsers(CALENDAR_ROTATION_EMAILS);
    if (calendarRotation.length === 0) {
      return res.status(500).json({ error: 'Rotation roster not found' });
    }

    const isRotationMember = calendarRotation.some((u) => u.id === me.id);
    if (!isAdmin(me) && !isRotationMember) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    const target = calendarRotation.find((u) => u.id === userId);
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
