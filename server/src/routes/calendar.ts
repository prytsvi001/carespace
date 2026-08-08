// server/src/routes/calendar.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { getRotationPair, SHIFT_REASSIGNED } from '../rotationSchedule';

const router = Router();

function isAdmin(req: Request): boolean {
  const role = (req.user as Express.User).role;
  return role === 'head' || role === 'lead';
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

    const updated = await prisma.calendarEvent.update({ where: { id: dragged.id }, data: { eventDate: newDateObj } });

    if (dragged.leaveType === 'SHIFT') {
      const pair = getRotationPair(oldDateObj);
      const isNativeDay = !!pair && (pair.morning === dragged.agent.name || pair.night === dragged.agent.name);
      if (isNativeDay) {
        await prisma.calendarEvent.create({
          data: {
            agentId: dragged.agentId,
            eventDate: oldDateObj,
            leaveType: SHIFT_REASSIGNED,
            shiftType: null,
            isExtraShift: false,
            notes: `Auto: shift moved to ${newDate}`,
          },
        });
      }
    }

    return res.json({ moved: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to reschedule calendar event' });
  }
});

// POST /api/calendar/fix-victoria-nicky-august-2026-swap — head/lead only,
// one-off admin action (button in ShiftCalendar.tsx). Corrects a swap that
// happened before the SHIFT_REASSIGNED fix above existed: on 2026-08-04 and
// 2026-08-07 Victoria Davis covered Nicky Brown's native rotation shift; on
// 2026-08-18 and 2026-08-19 Nicky Brown covered Victoria Davis's. Without
// this, statsHelpers.ts kept crediting the original native agent's phantom
// shift on each of those days on top of the real shift now correctly counted
// (as an "extra shift") for whoever actually covered it — see the
// conversation this was diagnosed in for the full root-cause writeup.
//
// Idempotent — checks current state before each change, safe to click more
// than once. Delete this route (and its button in ShiftCalendar.tsx) once
// August's numbers have been confirmed correct; it has no ongoing purpose.
router.post('/fix-victoria-nicky-august-2026-swap', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });

    const SWAPS: { date: string; nativeAgentName: string; coveredByAgentName: string }[] = [
      { date: '2026-08-04', nativeAgentName: 'Nicky Brown',    coveredByAgentName: 'Victoria Davis' },
      { date: '2026-08-07', nativeAgentName: 'Nicky Brown',    coveredByAgentName: 'Victoria Davis' },
      { date: '2026-08-18', nativeAgentName: 'Victoria Davis', coveredByAgentName: 'Nicky Brown' },
      { date: '2026-08-19', nativeAgentName: 'Victoria Davis', coveredByAgentName: 'Nicky Brown' },
    ];

    const results: string[] = [];

    for (const swap of SWAPS) {
      const day = new Date(`${swap.date}T00:00:00.000Z`);
      const [nativeAgent, coveredByAgent] = await Promise.all([
        prisma.agent.findFirst({ where: { name: swap.nativeAgentName } }),
        prisma.agent.findFirst({ where: { name: swap.coveredByAgentName } }),
      ]);
      if (!nativeAgent || !coveredByAgent) {
        results.push(`${swap.date}: agent not found — skipped`);
        continue;
      }

      // Authoritative source for which shift type (MORNING/NIGHT) the native
      // agent's slot was, regardless of whether their stored row still exists.
      const pair = getRotationPair(day);
      const rotationShiftType = pair?.morning === swap.nativeAgentName ? 'MORNING' : pair?.night === swap.nativeAgentName ? 'NIGHT' : null;
      if (!rotationShiftType) {
        results.push(`${swap.date}: ${swap.nativeAgentName} isn't natively rotated this day — skipped`);
        continue;
      }

      const nativeEvent = await prisma.calendarEvent.findFirst({
        where: { agentId: nativeAgent.id, eventDate: day },
      });

      if (!nativeEvent) {
        // Row already gone (e.g. dragged away pre-fix, which just deletes it
        // with no trace) — create the reassigned marker from scratch.
        await prisma.calendarEvent.create({
          data: { agentId: nativeAgent.id, eventDate: day, leaveType: SHIFT_REASSIGNED, shiftType: null, isExtraShift: false, notes: `Auto: covered by ${swap.coveredByAgentName}` },
        });
      } else if (nativeEvent.leaveType === SHIFT_REASSIGNED) {
        results.push(`${swap.date}: already applied — skipped`);
        continue;
      } else {
        await prisma.calendarEvent.update({
          where: { id: nativeEvent.id },
          data: { leaveType: SHIFT_REASSIGNED, notes: `Auto: covered by ${swap.coveredByAgentName}` },
        });
      }

      const existingCoverEvent = await prisma.calendarEvent.findFirst({
        where: { agentId: coveredByAgent.id, eventDate: day },
      });
      if (existingCoverEvent) {
        results.push(`${swap.date}: ${swap.nativeAgentName} reassigned; ${swap.coveredByAgentName} already had an event that day — left as-is`);
        continue;
      }

      await prisma.calendarEvent.create({
        data: {
          agentId: coveredByAgent.id,
          eventDate: day,
          leaveType: 'SHIFT',
          shiftType: rotationShiftType,
          isExtraShift: true,
          notes: `Auto: covered ${swap.nativeAgentName}'s shift`,
        },
      });
      results.push(`${swap.date}: fixed — ${swap.nativeAgentName} reassigned, ${swap.coveredByAgentName} credited`);
    }

    return res.json({ success: true, results });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to apply fix' });
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
