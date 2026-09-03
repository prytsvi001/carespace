// server/src/routes/updates.ts
// Lead/head-authored team announcements ("Updates" tab inside Inbox). Every
// non-peek_handler user except the update's own author is the "eligible
// audience" — that single rule drives the Telegram notification, the
// UpdateRead rows created at publish time, and the "Read by X/Y" denominator.
// No separate agent/lead/head distinction needed beyond that (confirmed with
// the user: the non-author admin is treated exactly like an agent).
import { Readable } from 'stream';
import { Router, Request, Response } from 'express';
import { del, get, issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';
import { sendTelegramMessage } from '../telegram';

const router = Router();
router.use(requireAuth);

const ALLOWED_TAGS = ['Important', 'Policy change', 'Reminder'] as const;

// The Blob store backing update attachments was created as private (read
// access requires an authenticated request through this server — see the
// /attachments/view route below), not a public CDN URL.
const BLOB_ACCESS = 'private' as const;

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = [
  'image/*', 'video/*', 'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/zip',
];

type UpdateAttachment = { url: string; pathname: string; name: string; contentType: string; size: number };

function parseAttachments(raw: string): UpdateAttachment[] {
  try { return JSON.parse(raw); } catch { return []; }
}

// Trusts the shape only loosely — this app has no other file-attachment
// precedent, so keep validation defensive rather than assuming the client
// always sends exactly what uploadPresigned() returned.
function sanitizeAttachments(input: unknown): UpdateAttachment[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).url === 'string')
    .map((a) => ({
      url: a.url as string,
      pathname: typeof a.pathname === 'string' ? a.pathname : '',
      name: typeof a.name === 'string' && a.name ? a.name : (typeof a.pathname === 'string' ? a.pathname : 'file'),
      contentType: typeof a.contentType === 'string' ? a.contentType : '',
      size: typeof a.size === 'number' ? a.size : 0,
    }));
}

function isAdmin(role: string): boolean {
  return role === 'head' || role === 'lead';
}

function updateTelegramText(authorName: string): string {
  return `‼️ IMPORTANT UPDATE від ${authorName} — перевір CareSpace · carespace.struktura.io`;
}

type ReadRow = { read: boolean; user: { id: string; name: string } };

function formatUpdate(
  u: { id: string; authorId: string | null; authorName: string; title: string; content: string; tag: string | null; attachments: string; editedAt: Date | null; createdAt: Date; updatedAt: Date; reads: ReadRow[] },
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
    attachments: parseAttachments(u.attachments),
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

    const { title, content, tag, attachments } = req.body as { title?: string; content?: string; tag?: string | null; attachments?: unknown };
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
        attachments: JSON.stringify(sanitizeAttachments(attachments)),
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

// POST /api/updates/attachments/upload-url — admin only. Issues a presigned
// PUT URL so the browser uploads directly to Blob storage; no file bytes
// pass through this Function. Also handles the upload-completed callback
// (a no-op here since the client already gets the blob metadata back
// directly from uploadPresigned() and sends it along with the update).
// Registered before /:id so "attachments" is never captured as an :id param.
router.post('/attachments/upload-url', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me.role)) return res.status(403).json({ error: 'Not allowed' });

    const body = req.body as HandleUploadPresignedBody;
    const jsonResponse = await handleUploadPresigned({
      body,
      request: req,
      getSignedToken: async (pathname) => {
        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          allowedContentTypes: ALLOWED_ATTACHMENT_TYPES,
          maximumSizeInBytes: MAX_ATTACHMENT_BYTES,
          validUntil: Date.now() + 60 * 60 * 1000,
        });
        return {
          token,
          urlOptions: {
            allowedContentTypes: ALLOWED_ATTACHMENT_TYPES,
            maximumSizeInBytes: MAX_ATTACHMENT_BYTES,
            addRandomSuffix: true,
            allowOverwrite: false,
            validUntil: Date.now() + 10 * 60 * 1000,
          },
        };
      },
    });
    return res.json(jsonResponse);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: (error as Error).message });
  }
});

// GET /api/updates/attachments/view?url=... — the store is private, so every
// read goes through this authenticated Function rather than a direct CDN URL.
router.get('/attachments/view', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (me.role === 'peek_handler') return res.status(403).json({ error: 'Not allowed' });

    const url = req.query.url as string | undefined;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const blob = await get(url, { access: BLOB_ACCESS });
    if (!blob || !blob.stream) return res.status(404).json({ error: 'Not found' });

    res.setHeader('Content-Type', blob.blob.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', blob.blob.contentDisposition || 'inline');
    Readable.fromWeb(blob.stream as never).pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch attachment' });
  }
});

// DELETE /api/updates/attachments — admin only. Cleans up a blob the admin
// uploaded then removed from the form before publishing/saving; already-
// published attachments are simply dropped from the JSON array on PUT, not
// deleted here. Registered before /:id so "attachments" is never captured
// as an :id param.
router.delete('/attachments', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me.role)) return res.status(403).json({ error: 'Not allowed' });

    const url = req.body?.url as string | undefined;
    if (!url) return res.status(400).json({ error: 'url is required' });

    await del(url);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

// PUT /api/updates/:id — author only
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { title, content, tag, attachments } = req.body as { title?: string; content?: string; tag?: string | null; attachments?: unknown };
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'title and content are required' });
    }
    if (tag && !ALLOWED_TAGS.includes(tag as (typeof ALLOWED_TAGS)[number])) {
      return res.status(400).json({ error: 'Invalid tag' });
    }

    const result = await prisma.update.updateMany({
      where: { id: req.params.id, authorId: me.id },
      data: {
        title: title.trim(),
        content: content.trim(),
        tag: tag || null,
        attachments: JSON.stringify(sanitizeAttachments(attachments)),
        editedAt: new Date(),
      },
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
