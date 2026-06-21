// server/src/routes/reviews.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// GET /api/reviews?userId=...&month=...&year=...&limit=...&offset=...
router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId, month, year, limit = '200', offset = '0', includeArchived } = req.query;

    const where: Record<string, unknown> = includeArchived === 'true' ? {} : { archived: false };
    if (userId) where.userId = userId as string;

    if (month && year) {
      const y = Number(year), m = Number(month);
      where.submittedAt = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    } else if (year) {
      const y = Number(year);
      where.submittedAt = { gte: new Date(y, 0, 1), lt: new Date(y + 1, 0, 1) };
    }

    const [reviews, total] = await Promise.all([
      prisma.clientReview.findMany({
        where,
        include: { user: { select: { id: true, name: true, role: true } } },
        orderBy: { submittedAt: 'desc' },
        take: Number(limit),
        skip: Number(offset),
      }),
      prisma.clientReview.count({ where }),
    ]);

    res.json({ reviews, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// POST /api/reviews — userId is always the authenticated user
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const { url, clientName, submittedAt } = req.body as {
      url?: string;
      clientName?: string;
      submittedAt?: string;
    };

    if (!url?.trim()) {
      return res.status(400).json({ error: 'url is required' });
    }

    const review = await prisma.clientReview.create({
      data: {
        userId,
        url: url.trim(),
        clientName: clientName?.trim() || null,
        submittedAt: submittedAt ? new Date(submittedAt) : new Date(),
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    return res.status(201).json(review);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create review' });
  }
});

// DELETE (archive) /api/reviews/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const userRole = (req.user as Express.User).role;
    const review = await prisma.clientReview.findUnique({ where: { id: req.params.id } });

    if (!review) return res.status(404).json({ error: 'Not found' });
    if (review.userId !== userId && !['head', 'lead'].includes(userRole)) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    await prisma.clientReview.update({ where: { id: req.params.id }, data: { archived: true } });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to archive review' });
  }
});

// DELETE (permanent) /api/reviews/delete/:id
router.delete('/delete/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const userRole = (req.user as Express.User).role;
    const review = await prisma.clientReview.findUnique({ where: { id: req.params.id } });

    if (!review) return res.status(404).json({ error: 'Not found' });
    if (review.userId !== userId && !['head', 'lead'].includes(userRole)) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    await prisma.clientReview.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete review' });
  }
});

export default router;
