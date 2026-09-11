// server/src/routes/proxies.ts
// Peekviewer Team — "Proxy" tab. peekviewerAdmin users (Yana Fedorova, Sandra
// Moore, Victoria Davis) bulk-add a pasted list (one proxy per line); any
// team member can claim one ("Taken by me"). A taken proxy isn't deleted —
// it just moves from "Available" to "Archive" (takenById != null), both
// visible to every Peekviewer team member.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth, requirePeekviewerTeam } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePeekviewerTeam);

function isAdmin(user: Express.User): boolean {
  return user.peekviewerAdmin === true;
}

// GET /api/proxies — everyone; split into available/archive client-side by takenById
router.get('/', async (_req: Request, res: Response) => {
  try {
    const proxies = await prisma.proxy.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(proxies);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch proxies' });
  }
});

// POST /api/proxies/bulk — admin only. Body: { text: string }, one proxy per
// non-blank line.
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { text } = req.body as { text?: string };
    const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return res.status(400).json({ error: 'No proxies found in the pasted text' });

    await prisma.proxy.createMany({
      data: lines.map((value) => ({ value, addedById: me.id, addedByName: me.name })),
    });

    const created = await prisma.proxy.findMany({ orderBy: { createdAt: 'desc' }, take: lines.length });
    return res.status(201).json(created);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add proxies' });
  }
});

// PATCH /api/proxies/:id/take — any team member claims an available proxy
router.patch('/:id/take', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const result = await prisma.proxy.updateMany({
      where: { id: req.params.id, takenById: null },
      data: { takenById: me.id, takenByName: me.name, takenAt: new Date() },
    });
    if (result.count === 0) return res.status(409).json({ error: 'Already taken' });

    const updated = await prisma.proxy.findUnique({ where: { id: req.params.id } });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to take proxy' });
  }
});

// PATCH /api/proxies/:id — admin only (edit the value)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { value } = req.body as { value?: string };
    if (!value?.trim()) return res.status(400).json({ error: 'value is required' });

    const result = await prisma.proxy.updateMany({
      where: { id: req.params.id },
      data: { value: value.trim() },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.proxy.findUnique({ where: { id: req.params.id } });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update proxy' });
  }
});

// DELETE /api/proxies/:id — admin only
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    await prisma.proxy.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete proxy' });
  }
});

export default router;
