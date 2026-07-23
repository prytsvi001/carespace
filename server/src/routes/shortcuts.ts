// server/src/routes/shortcuts.ts
import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import prisma from '../prisma';

const router = Router();
router.use(requireAuth);

function isAdmin(req: Request): boolean {
  const role = (req.user as Express.User).role;
  return role === 'head' || role === 'lead';
}

type Variant = { id: string; label: string; content: string };

function parseVariants(raw: string): Variant[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function formatShortcut(s: { variants: string; [key: string]: unknown }) {
  return { ...s, variants: parseVariants(s.variants) };
}

// Builds the stored `variants` JSON (text shortcuts only) from the request body,
// dropping blank entries and auto-labeling any variant the client didn't label.
function buildVariants(input?: { label?: string; content: string }[]): Variant[] {
  return (input ?? [])
    .map((v, i) => ({
      id: randomUUID(),
      label: v.label?.trim() || `Variant ${i + 1}`,
      content: v.content?.trim() || '',
    }))
    .filter((v) => v.content);
}

// GET /api/shortcuts — shared team-wide list, newest first
router.get('/', async (_req: Request, res: Response) => {
  try {
    const shortcuts = await (prisma as any).shortcut.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(shortcuts.map(formatShortcut));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch shortcuts' });
  }
});

// POST /api/shortcuts — any authenticated user can add
router.post('/', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const { title, type, content, category, variants } = req.body as {
      title?: string;
      type?: string;
      content?: string;
      category?: string;
      variants?: { label?: string; content: string }[];
    };

    if (!title?.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (type !== 'text' && type !== 'link') {
      return res.status(400).json({ error: 'type must be "text" or "link"' });
    }

    let finalContent: string;
    let finalVariants: Variant[];
    if (type === 'link') {
      if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
      finalContent = content.trim();
      finalVariants = [];
    } else {
      finalVariants = buildVariants(variants);
      if (finalVariants.length === 0) {
        return res.status(400).json({ error: 'At least one variant with text is required' });
      }
      finalContent = finalVariants[0].content;
    }

    const shortcut = await (prisma as any).shortcut.create({
      data: {
        title: title.trim(),
        type,
        content: finalContent,
        variants: JSON.stringify(finalVariants),
        category: category?.trim() || '',
        createdById: user.id,
        createdByName: user.name,
      },
    });
    return res.status(201).json(formatShortcut(shortcut));
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
    const { title, type, content, category, variants } = req.body as {
      title?: string;
      type?: string;
      content?: string;
      category?: string;
      variants?: { label?: string; content: string }[];
    };

    if (!title?.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (type !== 'text' && type !== 'link') {
      return res.status(400).json({ error: 'type must be "text" or "link"' });
    }

    let finalContent: string;
    let finalVariants: Variant[];
    if (type === 'link') {
      if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
      finalContent = content.trim();
      finalVariants = [];
    } else {
      finalVariants = buildVariants(variants);
      if (finalVariants.length === 0) {
        return res.status(400).json({ error: 'At least one variant with text is required' });
      }
      finalContent = finalVariants[0].content;
    }

    const shortcut = await (prisma as any).shortcut.update({
      where: { id: req.params.id },
      data: {
        title: title.trim(),
        type,
        content: finalContent,
        variants: JSON.stringify(finalVariants),
        category: category?.trim() || '',
      },
    });
    return res.json(formatShortcut(shortcut));
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
