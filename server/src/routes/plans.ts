// server/src/routes/plans.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// GET /api/plans — returns every plan for the user, grouped/sorted client-side
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const today = getTodayStr();

    // Carry-over: any incomplete plan whose due date is in the past moves to today.
    // Only match full "YYYY-MM-DD" dates — legacy "YYYY-MM" (month-only) values would
    // otherwise compare as "less than" today via string comparison and get corrupted.
    const stale = await prisma.plan.findMany({
      where: { userId, completed: false, date: { not: null } },
      select: { id: true, date: true },
    });
    const staleIds = stale
      .filter((p) => p.date && p.date.length === 10 && p.date < today)
      .map((p) => p.id);
    if (staleIds.length > 0) {
      await prisma.plan.updateMany({
        where: { id: { in: staleIds } },
        data: { date: today, carriedOver: true },
      });
    }

    const plans = await prisma.plan.findMany({
      where: { userId },
      orderBy: [{ completed: 'asc' }, { createdAt: 'asc' }],
    });

    res.json(plans);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// POST /api/plans
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const { title, date, priority, category, dueTime } = req.body as {
      title?: string;
      date?: string;
      priority?: string;
      category?: string;
      dueTime?: string;
    };

    if (!title?.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const plan = await prisma.plan.create({
      data: {
        userId,
        title: title.trim(),
        type: 'daily',
        date: date || null,
        priority: priority || 'medium',
        category: category || 'work',
        dueTime: dueTime || null,
      },
    });

    return res.status(201).json(plan);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create plan' });
  }
});

// PATCH /api/plans/:id — update plan fields
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const plan = await prisma.plan.findUnique({ where: { id: req.params.id } });
    if (!plan || plan.userId !== userId) return res.status(404).json({ error: 'Not found' });

    const { title, completed, priority, category, dueTime, date, carriedOverDismissed } = req.body as {
      title?: string;
      completed?: boolean;
      priority?: string;
      category?: string;
      dueTime?: string | null;
      date?: string | null;
      carriedOverDismissed?: boolean;
    };

    const updated = await prisma.plan.update({
      where: { id: req.params.id },
      data: {
        ...(typeof title === 'string' ? { title: title.trim() } : {}),
        ...(typeof completed === 'boolean' ? { completed } : {}),
        ...(typeof priority === 'string' ? { priority } : {}),
        ...(typeof category === 'string' ? { category } : {}),
        // Changing the due date or time invalidates any already-sent 24h-before
        // reminder, so it can fire again for the new due instant.
        ...(dueTime !== undefined ? { dueTime: dueTime || null, reminderSent: false } : {}),
        // Editing the due date means it's no longer "carried over" in the old sense
        ...(date !== undefined ? { date: date || null, carriedOver: false, reminderSent: false } : {}),
        ...(typeof carriedOverDismissed === 'boolean' ? { carriedOverDismissed } : {}),
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update plan' });
  }
});

// DELETE /api/plans/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const plan = await prisma.plan.findUnique({ where: { id: req.params.id } });
    if (!plan || plan.userId !== userId) return res.status(404).json({ error: 'Not found' });

    await prisma.plan.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete plan' });
  }
});

export default router;
