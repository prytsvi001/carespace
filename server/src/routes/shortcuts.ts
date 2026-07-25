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

// Maps the free-text `category` (still the only field the unchanged Add/Edit form
// writes to) into the two independent facets the drawer filters by. Only the
// current real category values are mapped — anything else (a brand-new category
// typed later) simply gets no facet tag and only surfaces in the unfiltered view.
// Recomputed on every create/update/rename rather than stored as a one-way
// migration, so editing a shortcut's category always keeps product/topic in sync.
const CATEGORY_FACETS: Record<string, { product?: string; topic?: string }> = {
  ANDROID: { product: 'Android' },
  IOS: { product: 'iOS' },
  GEOFINDER: { product: 'Geofinder' },
  GLASSAGRAM: { product: 'Glassagram' },
  'Знайомства': { product: 'Знайомства' },
  'Premium Support': { product: 'Premium' },
  BILLING: { topic: 'Billing' },
  'GENERAL INFO': { topic: 'General' },
  Sales: { topic: 'Sales' },
  'Common ticket answers': { topic: 'Common ticket answers' },
  'Common requests': { topic: 'Common requests' },
};

function deriveFacets(category: string): { product: string; topic: string } {
  const match = CATEGORY_FACETS[category.trim()];
  return { product: match?.product ?? '', topic: match?.topic ?? '' };
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

    const finalCategory = category?.trim() || '';
    const shortcut = await (prisma as any).shortcut.create({
      data: {
        title: title.trim(),
        type,
        content: finalContent,
        variants: JSON.stringify(finalVariants),
        category: finalCategory,
        ...deriveFacets(finalCategory),
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

    const finalCategory = category?.trim() || '';
    const shortcut = await (prisma as any).shortcut.update({
      where: { id: req.params.id },
      data: {
        title: title.trim(),
        type,
        content: finalContent,
        variants: JSON.stringify(finalVariants),
        category: finalCategory,
        ...deriveFacets(finalCategory),
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

// PATCH /api/shortcuts/:id/pin — any authenticated user can pin/unpin (team-wide, low-stakes, reversible)
router.patch('/:id/pin', async (req: Request, res: Response) => {
  try {
    const { pinned } = req.body as { pinned?: boolean };
    if (typeof pinned !== 'boolean') {
      return res.status(400).json({ error: 'pinned (boolean) is required' });
    }
    const shortcut = await (prisma as any).shortcut.update({
      where: { id: req.params.id },
      data: { pinned },
    });
    return res.json(formatShortcut(shortcut));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update pin status' });
  }
});

// POST /api/shortcuts/:id/copy — records that a shortcut's text was copied, for the
// "Recent" section. Any authenticated user; fire-and-forget from the client's
// perspective (a failure here should never block the copy the user already made).
router.post('/:id/copy', async (req: Request, res: Response) => {
  try {
    const shortcut = await (prisma as any).shortcut.update({
      where: { id: req.params.id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    return res.json(formatShortcut(shortcut));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to record usage' });
  }
});

// PATCH /api/shortcuts/category — rename a category across every shortcut in it (head/lead only)
router.patch('/category', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const { from, to } = req.body as { from?: string; to?: string };
    if (!from?.trim() || !to?.trim()) {
      return res.status(400).json({ error: 'from and to are required' });
    }
    const trimmedTo = to.trim();
    const result = await (prisma as any).shortcut.updateMany({
      where: { category: from },
      data: { category: trimmedTo, ...deriveFacets(trimmedTo) },
    });
    return res.json({ success: true, updated: result.count });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to rename category' });
  }
});

// DELETE /api/shortcuts/category/:name — delete a category AND every shortcut in it (head/lead only)
router.delete('/category/:name', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const result = await (prisma as any).shortcut.deleteMany({ where: { category: req.params.name } });
    return res.json({ success: true, deleted: result.count });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
