// server/src/routes/calendar.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';

const router = Router();

// GET /api/calendar?year=2024&month=3
router.get('/', async (req: Request, res: Response) => {
  try {
    const { includeArchived } = req.query;
    // Default to the current month rather than an unbounded query — without this,
    // omitting year/month returned every CalendarEvent ever created, no limit.
    const now = new Date();
    const year = req.query.year ?? now.getUTCFullYear();
    const month = req.query.month ?? now.getUTCMonth() + 1;

    let where: Record<string, unknown> = includeArchived === 'true' ? {} : { archived: false };

    const y = Number(year);
    const m = Number(month) - 1; // 0-indexed
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 1));
    where.eventDate = { gte: start, lt: end };

    const events = await prisma.calendarEvent.findMany({
      where,
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { eventDate: 'asc' },
    });

    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// POST /api/calendar
router.post('/', async (req: Request, res: Response) => {
  try {
    const { agentId, eventDate, leaveType, shiftType, isExtraShift, notes } = req.body;

    if (!agentId || !eventDate || !leaveType) {
      return res.status(400).json({ error: 'agentId, eventDate, and leaveType are required' });
    }

    const event = await prisma.calendarEvent.create({
      data: {
        agentId,
        eventDate: new Date(eventDate),
        leaveType,
        shiftType: shiftType || null,
        isExtraShift: isExtraShift === true,
        notes: notes || null,
      },
      include: { agent: { select: { id: true, name: true } } },
    });

    return res.status(201).json(event);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

// PUT /api/calendar/:id — update (including drag & drop date change)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { eventDate, leaveType, shiftType, isExtraShift, notes, agentId } = req.body;

    const event = await prisma.calendarEvent.update({
      where: { id },
      data: {
        ...(eventDate && { eventDate: new Date(eventDate) }),
        ...(leaveType && { leaveType }),
        ...(shiftType !== undefined && { shiftType: shiftType || null }),
        ...(isExtraShift !== undefined && { isExtraShift: isExtraShift === true }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(agentId && { agentId }),
      },
      include: { agent: { select: { id: true, name: true } } },
    });

    res.json(event);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update calendar event' });
  }
});

// DELETE (archive) /api/calendar/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.calendarEvent.update({
      where: { id },
      data: { archived: true },
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to archive calendar event' });
  }
});

router.delete('/delete/:id', async (req: Request, res: Response) => {
  try {
    await prisma.calendarEvent.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete calendar event' });
  }
});

export default router;
