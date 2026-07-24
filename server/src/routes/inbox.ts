// server/src/routes/inbox.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';
import { sendTelegramMessage, CARESPACE_URL } from '../telegram';

const router = Router();
router.use(requireAuth);

const ALLOWED_TYPES: Record<string, string[]> = {
  head:  ['task_assignment', 'salary_message', 'general'],
  lead:  ['task_assignment', 'general'],
  agent: ['general'],
};

function parseMetadata(raw: string | null) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function formatMessage(msg: { metadata: string | null; [key: string]: unknown }) {
  return { ...msg, metadata: parseMetadata(msg.metadata) };
}

// Attaches a lightweight preview of the message being replied to (if any),
// so the receiver can see exactly which message a reply is about.
async function attachReplyPreviews<T extends { replyToId: string | null }>(messages: T[]) {
  const ids = [...new Set(messages.map((m) => m.replyToId).filter((id): id is string => !!id))];
  if (ids.length === 0) return messages.map((m) => ({ ...m, replyTo: null }));

  const originals = await prisma.inboxMessage.findMany({
    where: { id: { in: ids } },
    include: { sender: { select: { name: true } } },
  });
  const byId = new Map(originals.map((o) => [o.id, o]));

  return messages.map((m) => {
    const original = m.replyToId ? byId.get(m.replyToId) : undefined;
    return {
      ...m,
      replyTo: original
        ? { id: original.id, subject: original.subject, content: original.content, senderName: original.sender.name }
        : null,
    };
  });
}

// GET /api/inbox — received messages for current user, newest first
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;

    const messages = await prisma.inboxMessage.findMany({
      where: { receiverId: userId, deletedByReceiver: false },
      include: {
        sender: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200, // bounds an otherwise ever-growing, unpaginated history
    });

    const withReplies = await attachReplyPreviews(messages);
    res.json(withReplies.map(formatMessage));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

// GET /api/inbox/users — all other users (for recipient picker)
router.get('/users', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const users = await prisma.user.findMany({
      where: { id: { not: userId } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/inbox/sent — messages sent by current user, newest first
router.get('/sent', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const messages = await prisma.inboxMessage.findMany({
      where: { senderId: userId, deletedBySender: false },
      include: {
        receiver: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200, // bounds an otherwise ever-growing, unpaginated history
    });
    const withReplies = await attachReplyPreviews(messages);
    res.json(withReplies.map(formatMessage));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sent messages' });
  }
});

// GET /api/inbox/unread-count
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const count = await prisma.inboxMessage.count({
      where: { receiverId: userId, read: false },
    });
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

// POST /api/inbox — send a new message
router.post('/', async (req: Request, res: Response) => {
  try {
    const senderId = (req.user as Express.User).id;
    const senderRole = (req.user as Express.User).role;
    const { recipientId, type, content, replyToId } = req.body as {
      recipientId?: string;
      type?: string;
      content?: string;
      replyToId?: string;
    };

    if (!recipientId || !type || !content?.trim()) {
      return res.status(400).json({ error: 'recipientId, type, and content are required' });
    }

    const allowed = ALLOWED_TYPES[senderRole] ?? ['general'];
    if (!allowed.includes(type)) {
      return res.status(403).json({ error: 'Message type not permitted for your role' });
    }

    const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) {
      return res.status(404).json({ error: 'Recipient not found' });
    }

    // Only accept replyToId if the sender was actually a party to that message
    let validReplyToId: string | undefined;
    if (replyToId) {
      const original = await prisma.inboxMessage.findUnique({ where: { id: replyToId } });
      if (original && (original.senderId === senderId || original.receiverId === senderId)) {
        validReplyToId = original.id;
      }
    }

    const message = await prisma.inboxMessage.create({
      data: { senderId, receiverId: recipientId, type, content: content.trim(), replyToId: validReplyToId },
      include: {
        sender:   { select: { id: true, name: true, role: true } },
        receiver: { select: { id: true, name: true, role: true } },
      },
    });

    if (recipient.telegramChatId) {
      const senderName = (req.user as Express.User).name;
      const preview = content.trim().slice(0, 120);
      const text = type === 'task_assignment'
        ? `New task assignment from ${senderName}: ${preview} ${CARESPACE_URL}`
        : `New message from ${senderName}: ${preview} ${CARESPACE_URL}`;
      await sendTelegramMessage(recipient.telegramChatId, text);
    }

    const [withReply] = await attachReplyPreviews([message]);
    return res.status(201).json(formatMessage(withReply));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

// PATCH /api/inbox/:id/read
router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const msg = await prisma.inboxMessage.findUnique({ where: { id: req.params.id } });

    if (!msg || msg.receiverId !== userId) {
      return res.status(404).json({ error: 'Not found' });
    }

    const updated = await prisma.inboxMessage.update({
      where: { id: req.params.id },
      data: { read: true },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// DELETE /api/inbox/:id — removes the message from the caller's own side
// (received or sent) without affecting the other party's copy
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;
    const msg = await prisma.inboxMessage.findUnique({ where: { id: req.params.id } });

    if (!msg || (msg.receiverId !== userId && msg.senderId !== userId)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const deletedBySender = msg.senderId === userId ? true : msg.deletedBySender;
    const deletedByReceiver = msg.receiverId === userId ? true : msg.deletedByReceiver;

    if (deletedBySender && deletedByReceiver) {
      await prisma.inboxMessage.delete({ where: { id: msg.id } });
    } else {
      await prisma.inboxMessage.update({
        where: { id: msg.id },
        data: { deletedBySender, deletedByReceiver },
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete message' });
  }
});

export default router;
