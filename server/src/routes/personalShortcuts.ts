// server/src/routes/personalShortcuts.ts
// Private, per-agent shortcuts — every route below is scoped to the caller's own
// userId with no admin override anywhere (confirmed: fully private, no exceptions).
// Mirrors shortcuts.ts's shape, but there's no legacy `category` field here — no
// team-wide mapping makes sense for one agent's own organization, so product/topic
// are assigned directly from the request body instead of derived server-side.
import { randomUUID } from 'crypto';
import express, { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import prisma from '../prisma';

const router = Router();
router.use(requireAuth);

function getUserId(req: Request): string {
  return (req.user as Express.User).id;
}

type Variant = { id: string; label: string; content: string };

function parseVariants(raw: string): Variant[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function formatShortcut(s: { variants: string; [key: string]: unknown }) {
  return { ...s, variants: parseVariants(s.variants) };
}

function buildVariants(input?: { label?: string; content: string }[]): Variant[] {
  return (input ?? [])
    .map((v, i) => ({
      id: randomUUID(),
      label: v.label?.trim() || `Variant ${i + 1}`,
      content: v.content?.trim() || '',
    }))
    .filter((v) => v.content);
}

const DEFAULT_TAG_COLORS = ['#85B7EB', '#97C459', '#F0997B', '#AFA9EC', '#D4A847', '#5DCAA5'];
function defaultColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return DEFAULT_TAG_COLORS[hash % DEFAULT_TAG_COLORS.length];
}

// Deliberately a separate function from shortcuts.ts's ensureTag — different
// signature (userId-scoped) and different table; not an overload, to avoid an
// accidental cross-wire between the shared and personal tag systems.
async function ensurePersonalTag(userId: string, kind: 'product' | 'topic', name: string): Promise<void> {
  if (!name) return;
  const existing = await (prisma as any).personalShortcutTag.findUnique({
    where: { userId_kind_name: { userId, kind, name } },
  });
  if (existing) return;
  const maxOrder = await (prisma as any).personalShortcutTag.aggregate({
    where: { userId, kind },
    _max: { order: true },
  });
  try {
    await (prisma as any).personalShortcutTag.create({
      data: { userId, kind, name, color: defaultColorFor(name), order: (maxOrder._max.order ?? -1) + 1 },
    });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code !== 'P2002') throw err; // lost a create race
  }
}

// GET /api/personal-shortcuts — only the caller's own items, ever
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const shortcuts = await (prisma as any).personalShortcut.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(shortcuts.map(formatShortcut));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch personal shortcuts' });
  }
});

// POST /api/personal-shortcuts — larger body limit to fit a resized pasted image
router.post('/', express.json({ limit: '6mb' }), async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { title, type, content, product, topic, variants, imageData } = req.body as {
      title?: string;
      type?: string;
      content?: string;
      product?: string;
      topic?: string;
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

    const finalProduct = product?.trim() || '';
    const finalTopic = topic?.trim() || '';

    const shortcut = await (prisma as any).personalShortcut.create({
      data: {
        userId,
        title: title.trim(),
        type,
        content: finalContent,
        variants: JSON.stringify(finalVariants),
        product: finalProduct,
        topic: finalTopic,
        imageData: imageData || null,
      },
    });
    await Promise.all([ensurePersonalTag(userId, 'product', finalProduct), ensurePersonalTag(userId, 'topic', finalTopic)]);
    return res.status(201).json(formatShortcut(shortcut));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create personal shortcut' });
  }
});

// PUT /api/personal-shortcuts/:id — owner only; ownership enforced by scoping the
// update itself (updateMany with userId in the where), not by a separate check,
// so a crafted id belonging to another user's row simply matches 0 rows.
router.put('/:id', express.json({ limit: '6mb' }), async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { title, type, content, product, topic, variants, imageData } = req.body as {
      title?: string;
      type?: string;
      content?: string;
      product?: string;
      topic?: string;
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

    const finalProduct = product?.trim() || '';
    const finalTopic = topic?.trim() || '';

    const result = await (prisma as any).personalShortcut.updateMany({
      where: { id: req.params.id, userId },
      data: {
        title: title.trim(),
        type,
        content: finalContent,
        variants: JSON.stringify(finalVariants),
        product: finalProduct,
        topic: finalTopic,
        // imageData only touched when the client actually sent the field, so
        // editing a shortcut without repasting keeps its existing image.
        ...(imageData !== undefined && { imageData: imageData || null }),
      },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });

    await Promise.all([ensurePersonalTag(userId, 'product', finalProduct), ensurePersonalTag(userId, 'topic', finalTopic)]);
    const updated = await (prisma as any).personalShortcut.findUnique({ where: { id: req.params.id } });
    return res.json(formatShortcut(updated));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update personal shortcut' });
  }
});

// DELETE /api/personal-shortcuts/:id — owner only
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const result = await (prisma as any).personalShortcut.deleteMany({ where: { id: req.params.id, userId } });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to delete personal shortcut' });
  }
});

// PATCH /api/personal-shortcuts/:id/pin — owner only
router.patch('/:id/pin', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { pinned } = req.body as { pinned?: boolean };
    if (typeof pinned !== 'boolean') {
      return res.status(400).json({ error: 'pinned (boolean) is required' });
    }
    const result = await (prisma as any).personalShortcut.updateMany({ where: { id: req.params.id, userId }, data: { pinned } });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });
    const updated = await (prisma as any).personalShortcut.findUnique({ where: { id: req.params.id } });
    return res.json(formatShortcut(updated));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update pin status' });
  }
});

// GET /api/personal-shortcuts/tags — the caller's own tag metadata only
router.get('/tags', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const tags = await (prisma as any).personalShortcutTag.findMany({ where: { userId }, orderBy: { order: 'asc' } });
    return res.json({
      products: tags.filter((t: { kind: string }) => t.kind === 'product'),
      topics: tags.filter((t: { kind: string }) => t.kind === 'topic'),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// PATCH /api/personal-shortcuts/tags/reorder — owner only (no admin concept here;
// it's the agent's own private list)
router.patch('/tags/reorder', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { kind, names } = req.body as { kind?: string; names?: string[] };
    if (kind !== 'product' && kind !== 'topic') {
      return res.status(400).json({ error: 'kind must be "product" or "topic"' });
    }
    if (!Array.isArray(names)) {
      return res.status(400).json({ error: 'names must be an array' });
    }
    await prisma.$transaction(
      names.map((name, index) =>
        (prisma as any).personalShortcutTag.updateMany({ where: { userId, kind, name }, data: { order: index } })
      )
    );
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to reorder tags' });
  }
});

// PATCH /api/personal-shortcuts/tags/:kind/:name/color — owner only
router.patch('/tags/:kind/:name/color', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { kind } = req.params;
    if (kind !== 'product' && kind !== 'topic') {
      return res.status(400).json({ error: 'invalid kind' });
    }
    const name = decodeURIComponent(req.params.name);
    const { color } = req.body as { color?: string };
    if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return res.status(400).json({ error: 'color must be a hex value like #85B7EB' });
    }
    const result = await (prisma as any).personalShortcutTag.updateMany({ where: { userId, kind, name }, data: { color } });
    if (result.count === 0) return res.status(404).json({ error: 'Tag not found' });
    const tag = await (prisma as any).personalShortcutTag.findUnique({ where: { userId_kind_name: { userId, kind, name } } });
    return res.json(tag);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update color' });
  }
});

export default router;
