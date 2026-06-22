// server/src/routes/quickLinks.ts
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import prisma from '../prisma';

const router = Router();
router.use(requireAuth);

// GET /api/quick-links — list all for the current user, newest first
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const links = await (prisma as any).quickLink.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(links);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch quick links' });
  }
});

// POST /api/quick-links
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const { title, url, category } = req.body;

    if (!title?.trim() || !url?.trim()) {
      return res.status(400).json({ error: 'title and url are required' });
    }

    const link = await (prisma as any).quickLink.create({
      data: {
        userId,
        title: title.trim(),
        url: url.trim(),
        category: category || '',
      },
    });
    return res.status(201).json(link);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create quick link' });
  }
});

// DELETE /api/quick-links/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const link = await (prisma as any).quickLink.findUnique({ where: { id: req.params.id } });

    if (!link || link.userId !== userId) {
      return res.status(404).json({ error: 'Not found' });
    }

    await (prisma as any).quickLink.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to delete quick link' });
  }
});

export default router;
