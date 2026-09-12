// server/src/routes/notes.ts
// My Space — "Notes" tab, available to every agent on either team. Fully
// personal: no author/admin distinction, no team scoping — each user only
// ever sees and manages their own notes.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

function formatNote(n: { id: string; title: string; content: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: n.id,
    title: n.title,
    content: n.content,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

// GET /api/notes — the caller's own notes, oldest first (reading order,
// matches Onboarding's convention).
router.get('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const notes = await prisma.note.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'asc' } });
    res.json(notes.map(formatNote));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// POST /api/notes
router.post('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { title, content } = req.body as { title?: string; content?: string };
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const note = await prisma.note.create({
      data: { userId: me.id, title: title.trim(), content: content.trim() },
    });
    return res.status(201).json(formatNote(note));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create note' });
  }
});

// PUT /api/notes/:id — owner only
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { title, content } = req.body as { title?: string; content?: string };
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const result = await prisma.note.updateMany({
      where: { id: req.params.id, userId: me.id },
      data: { title: title.trim(), content: content.trim() },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.note.findUnique({ where: { id: req.params.id } });
    return res.json(formatNote(updated!));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update note' });
  }
});

// DELETE /api/notes/:id — owner only
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const result = await prisma.note.deleteMany({ where: { id: req.params.id, userId: me.id } });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

export default router;
