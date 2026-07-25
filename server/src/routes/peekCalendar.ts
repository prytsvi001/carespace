// server/src/routes/peekCalendar.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// Always a fresh DB read rather than trusting session data — peekCalendarAccess
// isn't part of the session payload (same reasoning as peekDutyEligible in duty.ts).
async function loadMe(req: Request) {
  const sessionUser = req.user as Express.User;
  return prisma.user.findUnique({ where: { id: sessionUser.id } });
}

function canEdit(u: { role: string; peekCalendarAccess: boolean }): boolean {
  return u.role === 'peek_handler' || u.role === 'head' || u.role === 'lead' || u.peekCalendarAccess;
}

// Only these get scheduled on the calendar: the two peek_handlers plus whichever
// non-peek_handler user has been granted peekCalendarAccess (currently Julia Manson).
function isAssignable(u: { role: string; peekCalendarAccess: boolean }): boolean {
  return u.role === 'peek_handler' || u.peekCalendarAccess;
}

const MAX_PER_DAY = 2;

function parseDayMarker(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// GET /api/peek-calendar/access — lets the frontend decide whether to show the
// Support/Peek toggle at all, without needing a role check duplicated client-side
// for the one non-peek_handler, non-head/lead case (Julia Manson).
router.get('/access', async (req: Request, res: Response) => {
  const me = await loadMe(req);
  if (!me) return res.status(404).json({ error: 'User not found' });
  res.json({ canAccess: canEdit(me) });
});

// GET /api/peek-calendar/assignees — the fixed set of people who can be scheduled
router.get('/assignees', async (req: Request, res: Response) => {
  const me = await loadMe(req);
  if (!me || !canEdit(me)) return res.status(403).json({ error: 'Not allowed' });

  const users = await prisma.user.findMany({
    where: { OR: [{ role: 'peek_handler' }, { peekCalendarAccess: true }] },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

// GET /api/peek-calendar?year=&month=
router.get('/', async (req: Request, res: Response) => {
  try {
    const me = await loadMe(req);
    if (!me || !canEdit(me)) return res.status(403).json({ error: 'Not allowed' });

    const now = new Date();
    const year = Number(req.query.year ?? now.getUTCFullYear());
    const month = Number(req.query.month ?? now.getUTCMonth() + 1) - 1; // 0-indexed
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 1));

    const entries = await prisma.peekCalendarEntry.findMany({
      where: { eventDate: { gte: start, lt: end } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { eventDate: 'asc' },
    });
    res.json(entries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch Peek Requests Calendar entries' });
  }
});

// POST /api/peek-calendar
router.post('/', async (req: Request, res: Response) => {
  try {
    const me = await loadMe(req);
    if (!me || !canEdit(me)) return res.status(403).json({ error: 'Not allowed' });

    const { userId, eventDate, hours } = req.body as { userId?: string; eventDate?: string; hours?: string };
    if (!userId || !eventDate) {
      return res.status(400).json({ error: 'userId and eventDate are required' });
    }

    const assignee = await prisma.user.findUnique({ where: { id: userId } });
    if (!assignee || !isAssignable(assignee)) {
      return res.status(400).json({ error: 'This user cannot be scheduled on the Peek Requests Calendar' });
    }

    const day = parseDayMarker(eventDate);
    const existingCount = await prisma.peekCalendarEntry.count({ where: { eventDate: day } });
    if (existingCount >= MAX_PER_DAY) {
      return res.status(400).json({ error: `This day already has ${MAX_PER_DAY} agents assigned` });
    }

    const entry = await prisma.peekCalendarEntry.create({
      data: { userId, eventDate: day, hours: hours?.trim() || null },
      include: { user: { select: { id: true, name: true } } },
    });
    return res.status(201).json(entry);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create Peek Requests Calendar entry' });
  }
});

// PUT /api/peek-calendar/:id — edit hours and/or move to a different day (drag & drop)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const me = await loadMe(req);
    if (!me || !canEdit(me)) return res.status(403).json({ error: 'Not allowed' });

    const { eventDate, hours } = req.body as { eventDate?: string; hours?: string };

    if (eventDate) {
      const day = parseDayMarker(eventDate);
      const existingCount = await prisma.peekCalendarEntry.count({
        where: { eventDate: day, id: { not: req.params.id } },
      });
      if (existingCount >= MAX_PER_DAY) {
        return res.status(400).json({ error: `This day already has ${MAX_PER_DAY} agents assigned` });
      }
    }

    const entry = await prisma.peekCalendarEntry.update({
      where: { id: req.params.id },
      data: {
        ...(eventDate && { eventDate: parseDayMarker(eventDate) }),
        ...(hours !== undefined && { hours: hours?.trim() || null }),
      },
      include: { user: { select: { id: true, name: true } } },
    });
    res.json(entry);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update Peek Requests Calendar entry' });
  }
});

// DELETE /api/peek-calendar/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const me = await loadMe(req);
    if (!me || !canEdit(me)) return res.status(403).json({ error: 'Not allowed' });

    await prisma.peekCalendarEntry.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete Peek Requests Calendar entry' });
  }
});

export default router;
