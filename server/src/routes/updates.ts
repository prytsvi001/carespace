// server/src/routes/updates.ts
// Lead/head-authored team announcements ("Updates" tab inside Inbox). Every
// non-peek_handler user except the update's own author is the "eligible
// audience" — that single rule drives the Telegram notification, the
// UpdateRead rows created at publish time, and the "Read by X/Y" denominator.
// No separate agent/lead/head distinction needed beyond that (confirmed with
// the user: the non-author admin is treated exactly like an agent).
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';
import { sendTelegramMessage } from '../telegram';

const router = Router();
router.use(requireAuth);

const ALLOWED_TAGS = ['Important', 'Policy change', 'Reminder'] as const;

function isAdmin(role: string): boolean {
  return role === 'head' || role === 'lead';
}

function updateTelegramText(authorName: string): string {
  return `‼️ IMPORTANT UPDATE від ${authorName} — перевір CareSpace · carespace.struktura.io`;
}

type ReadRow = { read: boolean; user: { id: string; name: string } };

function formatUpdate(
  u: { id: string; authorId: string | null; authorName: string; title: string; content: string; tag: string | null; editedAt: Date | null; createdAt: Date; updatedAt: Date; reads: ReadRow[] },
  viewerId: string,
  viewerIsAdmin: boolean
) {
  const isAuthor = u.authorId === viewerId;
  const myReceipt = u.reads.find((r) => r.user.id === viewerId);
  const readRows = u.reads.filter((r) => r.read);

  const base = {
    id: u.id,
    authorId: u.authorId,
    authorName: u.authorName,
    title: u.title,
    content: u.content,
    tag: u.tag,
    editedAt: u.editedAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    isAuthor,
    read: isAuthor ? true : (myReceipt?.read ?? false),
    readCount: readRows.length,
    totalCount: u.reads.length,
  };

  if (!viewerIsAdmin && !isAuthor) return base;

  return {
    ...base,
    readNames: readRows.map((r) => r.user.name),
    unreadNames: u.reads.filter((r) => !r.read).map((r) => r.user.name),
  };
}

// GET /api/updates
router.get('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (me.role === 'peek_handler') return res.status(403).json({ error: 'Not allowed' });

    const updates = await prisma.update.findMany({
      orderBy: { createdAt: 'desc' },
      include: { reads: { include: { user: { select: { id: true, name: true } } } } },
    });

    const admin = isAdmin(me.role);
    res.json(updates.map((u) => formatUpdate(u, me.id, admin)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch updates' });
  }
});

// POST /api/updates — head/lead only
router.post('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me.role)) return res.status(403).json({ error: 'Not allowed' });

    const { title, content, tag } = req.body as { title?: string; content?: string; tag?: string | null };
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'title and content are required' });
    }
    if (tag && !ALLOWED_TAGS.includes(tag as (typeof ALLOWED_TAGS)[number])) {
      return res.status(400).json({ error: 'Invalid tag' });
    }

    const update = await prisma.update.create({
      data: {
        authorId: me.id,
        authorName: me.name,
        title: title.trim(),
        content: content.trim(),
        tag: tag || null,
      },
    });

    const eligible = await prisma.user.findMany({
      where: { role: { not: 'peek_handler' }, id: { not: me.id } },
      select: { id: true, name: true, telegramChatId: true },
    });

    if (eligible.length > 0) {
      await prisma.updateRead.createMany({
        data: eligible.map((u) => ({ updateId: update.id, userId: u.id, read: false })),
      });
    }

    const text = updateTelegramText(me.name);
    await Promise.all(
      eligible
        .filter((u) => u.telegramChatId)
        .map((u) => sendTelegramMessage(u.telegramChatId as string, text))
    );

    const withReads = await prisma.update.findUnique({
      where: { id: update.id },
      include: { reads: { include: { user: { select: { id: true, name: true } } } } },
    });
    return res.status(201).json(formatUpdate(withReads!, me.id, true));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to publish update' });
  }
});

// PUT /api/updates/:id — author only
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { title, content, tag } = req.body as { title?: string; content?: string; tag?: string | null };
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'title and content are required' });
    }
    if (tag && !ALLOWED_TAGS.includes(tag as (typeof ALLOWED_TAGS)[number])) {
      return res.status(400).json({ error: 'Invalid tag' });
    }

    const result = await prisma.update.updateMany({
      where: { id: req.params.id, authorId: me.id },
      data: { title: title.trim(), content: content.trim(), tag: tag || null, editedAt: new Date() },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });

    const withReads = await prisma.update.findUnique({
      where: { id: req.params.id },
      include: { reads: { include: { user: { select: { id: true, name: true } } } } },
    });
    return res.json(formatUpdate(withReads!, me.id, true));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update' });
  }
});

// DELETE /api/updates/:id — author only. UpdateRead rows cascade-delete via the schema relation.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const result = await prisma.update.deleteMany({ where: { id: req.params.id, authorId: me.id } });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete update' });
  }
});

// PATCH /api/updates/:id/read
router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const result = await prisma.updateRead.updateMany({
      where: { updateId: req.params.id, userId: me.id },
      data: { read: true, readAt: new Date() },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

export default router;
