// server/src/routes/rowAccounts.ts
// Peekviewer Team — "Row Accounts" tab. Same shared-pool/claim shape as
// Proxy (see proxies.ts), but holds a full credential set per account.
// Stored as plain text — internal-only app, confirmed acceptable trust model.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth, requirePeekviewerTeam } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePeekviewerTeam);

function isAdmin(user: Express.User): boolean {
  return user.peekviewerAdmin === true;
}

// GET /api/row-accounts — everyone; split into available/archive client-side by takenById
router.get('/', async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.rowAccount.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch row accounts' });
  }
});

// POST /api/row-accounts/bulk — admin only. Body: { text: string }, one
// account per non-blank line, fields separated by ":" —
// login:password:twoFaCode:email:emailPassword (2FA/email/email password may
// be left blank between colons, e.g. "login:password::: ").
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { text } = req.body as { text?: string };
    const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return res.status(400).json({ error: 'No accounts found in the pasted text' });

    const rows = lines.map((line) => {
      const [login, password, twoFaCode, email, emailPassword] = line.split(':').map((p) => p?.trim() ?? '');
      return {
        login: login || '',
        password: password || '',
        twoFaCode: twoFaCode || null,
        email: email || null,
        emailPassword: emailPassword || null,
        addedById: me.id,
        addedByName: me.name,
      };
    }).filter((r) => r.login && r.password);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Each line needs at least login:password' });
    }

    await prisma.rowAccount.createMany({ data: rows });

    const created = await prisma.rowAccount.findMany({ orderBy: { createdAt: 'desc' }, take: rows.length });
    return res.status(201).json(created);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add row accounts' });
  }
});

// PATCH /api/row-accounts/:id/take — any team member claims an available account
router.patch('/:id/take', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const result = await prisma.rowAccount.updateMany({
      where: { id: req.params.id, takenById: null },
      data: { takenById: me.id, takenByName: me.name, takenAt: new Date() },
    });
    if (result.count === 0) return res.status(409).json({ error: 'Already taken' });

    const updated = await prisma.rowAccount.findUnique({ where: { id: req.params.id } });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to take row account' });
  }
});

// PATCH /api/row-accounts/:id — admin only
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { login, password, twoFaCode, email, emailPassword } = req.body as {
      login?: string; password?: string; twoFaCode?: string | null; email?: string | null; emailPassword?: string | null;
    };

    const result = await prisma.rowAccount.updateMany({
      where: { id: req.params.id },
      data: {
        ...(typeof login === 'string' ? { login: login.trim() } : {}),
        ...(typeof password === 'string' ? { password: password.trim() } : {}),
        ...(twoFaCode !== undefined ? { twoFaCode: twoFaCode?.trim() || null } : {}),
        ...(email !== undefined ? { email: email?.trim() || null } : {}),
        ...(emailPassword !== undefined ? { emailPassword: emailPassword?.trim() || null } : {}),
      },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.rowAccount.findUnique({ where: { id: req.params.id } });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update row account' });
  }
});

// DELETE /api/row-accounts/:id — admin only
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    await prisma.rowAccount.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete row account' });
  }
});

export default router;
