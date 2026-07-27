// server/src/routes/shortcuts.ts
import { randomUUID } from 'crypto';
import express, { Router, Request, Response } from 'express';
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

// Default palette for a tag's color the first time it's auto-created — an admin
// can repaint it afterward via PATCH /tags/:kind/:name/color.
const DEFAULT_TAG_COLORS = ['#85B7EB', '#97C459', '#F0997B', '#AFA9EC', '#D4A847', '#5DCAA5'];
function defaultColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return DEFAULT_TAG_COLORS[hash % DEFAULT_TAG_COLORS.length];
}

// Auto-creates a ShortcutTag the first time a product/topic value appears, so the
// facet chip list is always self-consistent with what's actually on shortcuts —
// no manual admin setup needed before a new tag can be filtered/colored/reordered.
async function ensureTag(kind: 'product' | 'topic', name: string): Promise<void> {
  if (!name) return;
  const existing = await (prisma as any).shortcutTag.findUnique({ where: { kind_name: { kind, name } } });
  if (existing) return;
  const maxOrder = await (prisma as any).shortcutTag.aggregate({ where: { kind }, _max: { order: true } });
  try {
    await (prisma as any).shortcutTag.create({
      data: { kind, name, color: defaultColorFor(name), order: (maxOrder._max.order ?? -1) + 1 },
    });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code !== 'P2002') throw err; // lost a create race — the other request's row already exists
  }
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

// POST /api/shortcuts — any authenticated user can add. Larger body limit to
// fit a resized pasted image (see client/src/utils/imagePaste.ts).
router.post('/', express.json({ limit: '6mb' }), async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const { title, type, content, category, variants, imageData } = req.body as {
      title?: string;
      type?: string;
      content?: string;
      category?: string;
      variants?: { label?: string; content: string }[];
      imageData?: string | null;
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
    const facets = deriveFacets(finalCategory);
    const shortcut = await (prisma as any).shortcut.create({
      data: {
        title: title.trim(),
        type,
        content: finalContent,
        variants: JSON.stringify(finalVariants),
        category: finalCategory,
        ...facets,
        imageData: imageData || null,
        createdById: user.id,
        createdByName: user.name,
      },
    });
    await Promise.all([ensureTag('product', facets.product), ensureTag('topic', facets.topic)]);
    return res.status(201).json(formatShortcut(shortcut));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create shortcut' });
  }
});

// PUT /api/shortcuts/:id — head/lead only. Larger body limit to fit a resized
// pasted image.
router.put('/:id', express.json({ limit: '6mb' }), async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const { title, type, content, category, variants, imageData } = req.body as {
      title?: string;
      type?: string;
      content?: string;
      category?: string;
      variants?: { label?: string; content: string }[];
      imageData?: string | null;
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

    // Product/topic are recomputed fresh from category on every save — safe now
    // that tag rename no longer exists (that was the one way they could diverge
    // from the static category mapping; Manage Categories' bulk category-rename
    // already keeps every affected row in sync the same way).
    const finalCategory = category?.trim() || '';
    const facets = deriveFacets(finalCategory);

    const shortcut = await (prisma as any).shortcut.update({
      where: { id: req.params.id },
      data: {
        title: title.trim(),
        type,
        content: finalContent,
        variants: JSON.stringify(finalVariants),
        category: finalCategory,
        ...facets,
        ...(imageData !== undefined && { imageData: imageData || null }),
      },
    });
    await Promise.all([ensureTag('product', facets.product), ensureTag('topic', facets.topic)]);
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
    const facets = deriveFacets(trimmedTo);
    const result = await (prisma as any).shortcut.updateMany({
      where: { category: from },
      data: { category: trimmedTo, ...facets },
    });
    await Promise.all([ensureTag('product', facets.product), ensureTag('topic', facets.topic)]);
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


// GET /api/shortcuts/tags — product/topic facet metadata (color, display order)
router.get('/tags', async (_req: Request, res: Response) => {
  try {
    const tags = await (prisma as any).shortcutTag.findMany({ orderBy: { order: 'asc' } });
    return res.json({
      products: tags.filter((t: { kind: string }) => t.kind === 'product'),
      topics: tags.filter((t: { kind: string }) => t.kind === 'topic'),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// PATCH /api/shortcuts/tags/reorder — head/lead only
router.patch('/tags/reorder', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });
    const { kind, names } = req.body as { kind?: string; names?: string[] };
    if (kind !== 'product' && kind !== 'topic') {
      return res.status(400).json({ error: 'kind must be "product" or "topic"' });
    }
    if (!Array.isArray(names)) {
      return res.status(400).json({ error: 'names must be an array' });
    }
    await prisma.$transaction(
      names.map((name, index) =>
        (prisma as any).shortcutTag.updateMany({ where: { kind, name }, data: { order: index } })
      )
    );
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to reorder tags' });
  }
});

// PATCH /api/shortcuts/tags/:kind/:name/color — head/lead only
router.patch('/tags/:kind/:name/color', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not allowed' });
    const { kind } = req.params;
    if (kind !== 'product' && kind !== 'topic') {
      return res.status(400).json({ error: 'invalid kind' });
    }
    const name = decodeURIComponent(req.params.name);
    const { color } = req.body as { color?: string };
    if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return res.status(400).json({ error: 'color must be a hex value like #85B7EB' });
    }
    // No contrast-based rejection here — the drawer always renders a computed
    // ink/white text color against this as a tinted background (never the raw
    // color as text), so any hex stays readable regardless of what's picked.
    const tag = await (prisma as any).shortcutTag.update({
      where: { kind_name: { kind, name } },
      data: { color },
    });
    return res.json(tag);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update color' });
  }
});

export default router;
