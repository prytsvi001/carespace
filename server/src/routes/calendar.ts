// server/src/routes/calendar.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { getRotationPair, SHIFT_REASSIGNED } from '../rotationSchedule';

const router = Router();

type EventWithAgentName = { agentId: string; eventDate: Date; leaveType: string; agent: { name: string } };

function isNativeRotationShift(ev: EventWithAgentName): boolean {
  if (ev.leaveType !== 'SHIFT') return false;
  const pair = getRotationPair(ev.eventDate);
  return !!pair && (pair.morning === ev.agent.name || pair.night === ev.agent.name);
}

// Stamp a SHIFT_REASSIGNED marker on a rotation agent's native day once their
// SHIFT there is gone (dragged away or deleted). statsHelpers.ts credits
// rotation shifts from the schedule, not from stored rows, so without the
// marker the vacated shift keeps counting toward the original agent's hours.
async function markVacatedRotationDay(ev: EventWithAgentName, note: string) {
  if (!isNativeRotationShift(ev)) return;
  const existing = await prisma.calendarEvent.findFirst({
    where: { agentId: ev.agentId, eventDate: ev.eventDate, leaveType: SHIFT_REASSIGNED },
  });
  if (existing) return;
  await prisma.calendarEvent.create({
    data: {
      agentId: ev.agentId,
      eventDate: ev.eventDate,
      leaveType: SHIFT_REASSIGNED,
      shiftType: null,
      isExtraShift: false,
      notes: note,
    },
  });
}

// The agent got an event back on a day previously marked vacated (re-added or
// dragged back), so the marker no longer applies.
async function clearVacatedMarker(agentId: string, eventDate: Date) {
  await prisma.calendarEvent.deleteMany({
    where: { agentId, eventDate, leaveType: SHIFT_REASSIGNED },
  });
}

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
    // Bookkeeping-only rows — see SHIFT_REASSIGNED above. They exist purely for
    // statsHelpers.ts to read directly via Prisma; the calendar UI never shows them.
    where.leaveType = { not: SHIFT_REASSIGNED };

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

    if (leaveType === SHIFT_REASSIGNED) {
      return res.status(400).json({ error: 'Invalid leaveType' });
    }

    await clearVacatedMarker(agentId, new Date(eventDate));

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

// PATCH /api/calendar/:id/reschedule — the drag & drop endpoint. Atomically
// handles both a "plain move" (target day empty for this agent) and a "swap"
// (target day already has another event for the same agent) in one request,
// so the client never has to run two independent PUTs and risk the server
// observing them in a torn, half-applied state.
//
// When a rotation-scheduled agent's SHIFT is moved off their native rotation
// day (per rotationSchedule.ts) to a plain-move destination, the vacated day
// is stamped with a SHIFT_REASSIGNED marker. Without this, statsHelpers.ts's
// day-loop has no record of the move — an empty day for a rotation agent
// reads as "worked their normal shift, nothing to see here" — so it goes on
// crediting a shift nobody works anymore, on top of the shift now correctly
// counted (as an "extra shift") on the new day. A same-agent swap doesn't
// need this: the vacated day still ends up holding an event afterward (the
// other one), so there's nothing to mark.
router.patch('/:id/reschedule', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { newDate } = req.body as { newDate?: string };
    if (!newDate) return res.status(400).json({ error: 'newDate is required' });

    const dragged = await prisma.calendarEvent.findUnique({ where: { id }, include: { agent: true } });
    if (!dragged) return res.status(404).json({ error: 'Event not found' });

    const oldDateObj = dragged.eventDate;
    const newDateObj = new Date(newDate);
    if (oldDateObj.getTime() === newDateObj.getTime()) {
      return res.json({ moved: dragged });
    }

    const target = await prisma.calendarEvent.findFirst({
      where: {
        agentId: dragged.agentId,
        id: { not: dragged.id },
        archived: false,
        leaveType: { not: SHIFT_REASSIGNED },
        eventDate: newDateObj,
      },
    });

    if (target) {
      const [updatedDragged, updatedTarget] = await prisma.$transaction([
        prisma.calendarEvent.update({ where: { id: dragged.id }, data: { eventDate: newDateObj } }),
        prisma.calendarEvent.update({ where: { id: target.id }, data: { eventDate: oldDateObj } }),
      ]);
      return res.json({ moved: updatedDragged, swappedWith: updatedTarget });
    }

    await clearVacatedMarker(dragged.agentId, newDateObj);
    const updated = await prisma.calendarEvent.update({ where: { id: dragged.id }, data: { eventDate: newDateObj } });

    await markVacatedRotationDay(dragged, `Auto: shift moved to ${newDate}`);

    return res.json({ moved: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to reschedule calendar event' });
  }
});

// DELETE (archive) /api/calendar/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const ev = await prisma.calendarEvent.update({
      where: { id },
      data: { archived: true },
      include: { agent: { select: { name: true } } },
    });
    await markVacatedRotationDay(ev, 'Auto: rotation shift deleted');
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to archive calendar event' });
  }
});

router.delete('/delete/:id', async (req: Request, res: Response) => {
  try {
    const ev = await prisma.calendarEvent.delete({
      where: { id: req.params.id },
      include: { agent: { select: { name: true } } },
    });
    await markVacatedRotationDay(ev, 'Auto: rotation shift deleted');
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete calendar event' });
  }
});

export default router;
