// server/src/routes/inbox.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const ALLOWED_TYPES: Record<string, string[]> = {
  head:  ['task_assignment', 'salary_message', 'general'],
  lead:  ['task_assignment', 'general'],
  agent: ['general'],
};

// GET /api/inbox — received messages for current user, newest first
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req.user as Express.User).id;

    const messages = await prisma.inboxMessage.findMany({
      where: { receiverId: userId },
      include: {
        sender: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(messages);
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
      where: { senderId: userId },
      include: {
        receiver: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(messages);
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
    const { recipientId, type, content } = req.body as {
      recipientId?: string;
      type?: string;
      content?: string;
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

    const message = await prisma.inboxMessage.create({
      data: { senderId, receiverId: recipientId, type, content: content.trim() },
      include: {
        sender:   { select: { id: true, name: true, role: true } },
        receiver: { select: { id: true, name: true, role: true } },
      },
    });

    return res.status(201).json(message);
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

export default router;
