// server/src/routes/shortcuts.ts
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import prisma from '../prisma';

const router = Router();
router.use(requireAuth);

function isAdmin(req: Request): boolean {
  const role = (req.user as Express.User).role;
  return role === 'head' || role === 'lead';
}

// GET /api/shortcuts — shared team-wide list, newest first
router.get('/', async (_req: Request, res: Response) => {
  try {
    const shortcuts = await (prisma as any).shortcut.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(shortcuts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch shortcuts' });
  }
});

// POST /api/shortcuts — any authenticated user can add
router.post('/', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const { title, type, content, category } = req.body;

    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'title and content are required' });
    }
    if (type !== 'text' && type !== 'link') {
      return res.status(400).json({ error: 'type must be "text" or "link"' });
    }

    const shortcut = await (prisma as any).shortcut.create({
      data: {
        title: title.trim(),
        type,
        content: content.trim(),
        category: category?.trim() || '',
        createdById: user.id,
        createdByName: user.name,
      },
    });
    return res.status(201).json(shortcut);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create shortcut' });
  }
});

// PUT /api/shortcuts/:id — head/lead only
router.put('/:id', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const { title, type, content, category } = req.body;

    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'title and content are required' });
    }
    if (type !== 'text' && type !== 'link') {
      return res.status(400).json({ error: 'type must be "text" or "link"' });
    }

    const shortcut = await (prisma as any).shortcut.update({
      where: { id: req.params.id },
      data: {
        title: title.trim(),
        type,
        content: content.trim(),
        category: category?.trim() || '',
      },
    });
    return res.json(shortcut);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update shortcut' });
  }
});

// DELETE /api/shortcuts/:id — head/lead only
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    await (prisma as any).shortcut.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to delete shortcut' });
  }
});

export default router;
