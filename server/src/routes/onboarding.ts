// server/src/routes/onboarding.ts
// Peekviewer Team — "Onboarding" tab (inside My Space): product info and
// how-to material. Authored only by Sandra Moore / Victoria Davis — role
// head/lead, which within the Peekviewer team (this router is gated by
// requirePeekviewerTeam) is exactly those two, no separate flag needed.
// Either of them can edit/delete ANY block, not just ones they personally
// authored — authorId/authorName is just attribution ("written by"), not
// an ownership restriction. Everyone on the team can read. Attachments use
// the same Vercel Blob
// private-store + presigned-URL pattern as Update.attachments (see
// updates.ts), but the client renders images/videos inline rather than as a
// download link — the view route below is a plain authenticated stream, so
// an <img>/<video> tag pointed at it just works.
import { Readable } from 'stream';
import { Router, Request, Response } from 'express';
import { del, get, issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client';
import prisma from '../prisma';
import { requireAuth, requirePeekviewerTeam } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePeekviewerTeam);

const BLOB_ACCESS = 'private' as const;

// Higher than Updates' 25MB — onboarding attachments are expected to include
// short screen-recording videos, and the upload goes straight to Blob
// storage (presigned), not through this Function's request body.
const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;
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

type OnboardingAttachment = { url: string; pathname: string; name: string; contentType: string; size: number };

function parseAttachments(raw: string): OnboardingAttachment[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function sanitizeAttachments(input: unknown): OnboardingAttachment[] {
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

function isAdmin(user: Express.User): boolean {
  return user.role === 'head' || user.role === 'lead';
}

function formatBlock(b: {
  id: string; authorId: string | null; authorName: string; title: string; content: string;
  attachments: string; parentId: string | null; editedAt: Date | null; createdAt: Date; updatedAt: Date;
}, viewerId: string) {
  return {
    id: b.id,
    authorId: b.authorId,
    authorName: b.authorName,
    title: b.title,
    content: b.content,
    attachments: parseAttachments(b.attachments),
    parentId: b.parentId,
    editedAt: b.editedAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    isAuthor: b.authorId === viewerId,
  };
}

// GET /api/onboarding — everyone on the team, oldest first (reading order).
// Flat list, including parentId — the client builds the two-level tree
// (top-level blocks + their sub-blocks) itself.
router.get('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const blocks = await prisma.onboardingBlock.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    res.json(blocks.map((b) => formatBlock(b, me.id)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch onboarding blocks' });
  }
});

// POST /api/onboarding — admin only. Body may include parentId to create a
// sub-block nested under an existing top-level block — that target block
// must itself have no parent (one level of nesting only).
router.post('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not allowed' });

    const { title, content, attachments, parentId } = req.body as {
      title?: string; content?: string; attachments?: unknown; parentId?: string | null;
    };
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    if (parentId) {
      const parent = await prisma.onboardingBlock.findUnique({ where: { id: parentId } });
      if (!parent) return res.status(400).json({ error: 'Parent block not found' });
      if (parent.parentId) return res.status(400).json({ error: 'Only one level of sub-blocks is supported' });
    }

    // New block appends after its current siblings (top-level blocks and a
    // given parent's sub-blocks each form their own sibling group).
    const siblingCount = await prisma.onboardingBlock.count({ where: { parentId: parentId || null } });

    const block = await prisma.onboardingBlock.create({
      data: {
        authorId: me.id,
        authorName: me.name,
        title: title.trim(),
        content: content.trim(),
        attachments: JSON.stringify(sanitizeAttachments(attachments)),
        parentId: parentId || null,
        sortOrder: siblingCount,
      },
    });

    return res.status(201).json(formatBlock(block, me.id));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create onboarding block' });
  }
});

// POST /api/onboarding/attachments/upload-url — admin only. Registered before
// /:id so "attachments" is never captured as an :id param.
router.post('/attachments/upload-url', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not allowed' });

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
            validUntil: Date.now() + 60 * 60 * 1000, // longer window — a big video upload can take a while
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

// GET /api/onboarding/attachments/view?url=... — private store, streamed
// through this authenticated Function so <img>/<video> tags can point at it
// directly (no download step).
router.get('/attachments/view', async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string | undefined;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const blob = await get(url, { access: BLOB_ACCESS });
    if (!blob || !blob.stream) return res.status(404).json({ error: 'Not found' });

    res.setHeader('Content-Type', blob.blob.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    Readable.fromWeb(blob.stream as never).pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch attachment' });
  }
});

// DELETE /api/onboarding/attachments — admin only. Cleans up a blob the admin
// uploaded then removed from the form before publishing/saving. Registered
// before /:id so "attachments" is never captured as an :id param.
router.delete('/attachments', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not allowed' });

    const url = req.body?.url as string | undefined;
    if (!url) return res.status(400).json({ error: 'url is required' });

    await del(url);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

// PATCH /api/onboarding/reorder — admin only. Body: { parentId: string | null,
// ids: string[] } — ids is the FULL new order of one sibling group (either
// every top-level block, when parentId is null, or one specific top-level
// block's sub-blocks, when parentId is its id). Sets sortOrder = array index
// for each; the `parentId` filter in the update keeps a reorder call from
// touching blocks outside that group even if a stale/tampered id sneaks in.
// Registered before /:id so "reorder" is never captured as an :id param.
router.patch('/reorder', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not allowed' });

    const { parentId, ids } = req.body as { parentId?: string | null; ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.onboardingBlock.updateMany({
          where: { id, parentId: parentId ?? null },
          data: { sortOrder: index },
        })
      )
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reorder blocks' });
  }
});

// PUT /api/onboarding/:id — either admin (Sandra/Victoria Davis) can edit
// any block, not just ones they personally authored. parentId is optional;
// when present it's validated the same way as on create (target must be a
// top-level block), and a block that already has children can't be given a
// parent itself (still just one level of nesting).
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not allowed' });

    const { title, content, attachments, parentId } = req.body as {
      title?: string; content?: string; attachments?: unknown; parentId?: string | null;
    };
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    if (parentId) {
      if (parentId === req.params.id) return res.status(400).json({ error: "A block can't be its own parent" });
      const parent = await prisma.onboardingBlock.findUnique({ where: { id: parentId } });
      if (!parent) return res.status(400).json({ error: 'Parent block not found' });
      if (parent.parentId) return res.status(400).json({ error: 'Only one level of sub-blocks is supported' });
      const hasChildren = await prisma.onboardingBlock.count({ where: { parentId: req.params.id } });
      if (hasChildren > 0) return res.status(400).json({ error: 'A block with sub-blocks of its own cannot become a sub-block' });
    }

    const result = await prisma.onboardingBlock.updateMany({
      where: { id: req.params.id },
      data: {
        title: title.trim(),
        content: content.trim(),
        attachments: JSON.stringify(sanitizeAttachments(attachments)),
        ...(parentId !== undefined ? { parentId: parentId || null } : {}),
        editedAt: new Date(),
      },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.onboardingBlock.findUnique({ where: { id: req.params.id } });
    return res.json(formatBlock(updated!, me.id));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update onboarding block' });
  }
});

// DELETE /api/onboarding/:id — either admin (Sandra/Victoria Davis), same as edit
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not allowed' });

    const result = await prisma.onboardingBlock.deleteMany({ where: { id: req.params.id } });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete onboarding block' });
  }
});

export default router;
