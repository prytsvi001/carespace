// server/src/routes/requestSchedule.ts
// Peekviewer Team — "Request Schedule" tab. Who processes new profiles each
// day, among the 4 rotating agents. The base assignment is a fixed
// day-of-month rotation formula (no spreadsheet, no external data source —
// confirmed with the user: the logic just lives in code). Swaps agents make
// via drag-and-drop are the only thing persisted (RequestScheduleOverride),
// layered on top of the formula for that one date.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth, requirePeekviewerTeam } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePeekviewerTeam);

// Fixed rotation roster, in day-of-month-remainder order (remainder 1,2,3,0).
// Matches the pattern this replaces: Tetyana on 1,5,9.../ Yana on 2,6,10.../
// Victoria Horopeka on 3,7,11.../ Iryna on 4,8,12...
const ROTATION_EMAILS = [
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

async function getRotationUsers() {
  const users = await prisma.user.findMany({
    where: { email: { in: ROTATION_EMAILS } },
    select: { id: true, name: true, email: true },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  return ROTATION_EMAILS.map((email) => byEmail.get(email)).filter(
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

    const rotation = await getRotationUsers();
    if (rotation.length === 0) {
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
      const base = rotation[rotationIndexForDay(day)];
      days.push({
        date,
        userId: override ? override.userId : base.id,
        userName: override ? override.userName : base.name,
        isOverride: !!override,
      });
    }

    // Redistribution panel — the pure formula, independent of the displayed
    // month and unaffected by swaps (same behavior as the tool this replaces).
    const redistribution = rotation.map((u, idx) => ({
      userId: u.id,
      userName: u.name,
      days: Array.from({ length: 31 }, (_, i) => i + 1).filter((d) => rotationIndexForDay(d) === idx),
    }));

    res.json({ days, redistribution });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch request schedule' });
  }
});

// POST /api/request-schedule/swap — body: { date, targetDate } both "YYYY-MM-DD".
// Swaps the two dates' assignees. Permitted for whoever is currently assigned
// to either date, or a peekviewerAdmin.
router.post('/swap', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { date, targetDate } = req.body as { date?: string; targetDate?: string };
    if (!date || !targetDate || date === targetDate) {
      return res.status(400).json({ error: 'date and targetDate are required and must differ' });
    }

    const rotation = await getRotationUsers();
    if (rotation.length === 0) {
      return res.status(500).json({ error: 'Rotation roster not found' });
    }

    const resolve = async (d: string) => {
      const existing = await prisma.requestScheduleOverride.findUnique({ where: { date: d } });
      if (existing) return { userId: existing.userId, userName: existing.userName };
      const [year, month, day] = d.split('-').map(Number);
      const base = rotation[rotationIndexForDay(day)];
      return { userId: base.id, userName: base.name };
    };

    const [current, target] = await Promise.all([resolve(date), resolve(targetDate)]);

    if (!isAdmin(me) && me.id !== current.userId && me.id !== target.userId) {
      return res.status(403).json({ error: 'You can only swap a day you are assigned to' });
    }

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

export default router;
