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

// GET /api/plans?type=daily&date=YYYY-MM-DD  or  ?type=monthly&date=YYYY-MM
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const { type, date } = req.query as { type?: string; date?: string };

    // Carry-over: when loading today's daily plans, move any incomplete past daily plans to today
    if (type === 'daily' && date) {
      const today = getTodayStr();
      if (date === today) {
        await prisma.plan.updateMany({
          where: { userId, type: 'daily', completed: false, date: { lt: today } },
          data: { date: today, carriedOver: true },
        });
      }
    }

    let where: Record<string, unknown> = { userId };
    if (type) where.type = type;

    if (date) {
      if (type === 'monthly') {
        // Monthly plans: match any date starting with "YYYY-MM" (handles old "YYYY-MM" format and new "YYYY-MM-DD")
        where.date = { startsWith: date };
      } else {
        where.date = date;
      }
    }

    const plans = await prisma.plan.findMany({
      where,
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
    const { title, type, date, priority, category, dueTime } = req.body as {
      title?: string;
      type?: string;
      date?: string;
      priority?: string;
      category?: string;
      dueTime?: string;
    };

    if (!title?.trim() || !type) {
      return res.status(400).json({ error: 'title and type are required' });
    }

    const plan = await prisma.plan.create({
      data: {
        userId,
        title: title.trim(),
        type,
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

    const { title, completed, priority, category, dueTime, carriedOverDismissed } = req.body as {
      title?: string;
      completed?: boolean;
      priority?: string;
      category?: string;
      dueTime?: string | null;
      carriedOverDismissed?: boolean;
    };

    const updated = await prisma.plan.update({
      where: { id: req.params.id },
      data: {
        ...(typeof title === 'string' ? { title: title.trim() } : {}),
        ...(typeof completed === 'boolean' ? { completed } : {}),
        ...(typeof priority === 'string' ? { priority } : {}),
        ...(typeof category === 'string' ? { category } : {}),
        ...(dueTime !== undefined ? { dueTime: dueTime || null } : {}),
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
