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

const EMAIL_RE = /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/;
const CODE_RE = /^\d{4,8}$/; // typical 2FA code length — never matches an email (needs "@")

// Splits one pasted line into a credential row without requiring a fixed
// column order: any token that looks like an email becomes `email`, any
// token that's purely 4-8 digits becomes `twoFaCode` (first match of each
// wins), and whatever tokens are left are assigned, in their original
// left-to-right order, to login -> password -> emailPassword. Accepts
// either ":" or whitespace/tabs as the separator so a plain paste like
// "login password email@x.com 123456 emailpass" works the same as the
// legacy "login:password:2FA:email:emailPassword" format.
function parseAccountLine(line: string): {
  login: string; password: string; twoFaCode: string | null; email: string | null; emailPassword: string | null;
} | null {
  const tokens = line.split(/[\s:]+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  let email: string | null = null;
  let twoFaCode: string | null = null;
  const rest: string[] = [];

  for (const t of tokens) {
    if (!email && EMAIL_RE.test(t)) { email = t; continue; }
    if (!twoFaCode && CODE_RE.test(t)) { twoFaCode = t; continue; }
    rest.push(t);
  }

  const [login, password, emailPassword] = rest;
  if (!login || !password) return null;

  return { login, password, twoFaCode, email, emailPassword: emailPassword || null };
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
// account per non-blank line. Fields can be separated by ":" or plain
// whitespace, in any order — see parseAccountLine for the auto-detection
// rules (email/2FA are pattern-matched, login/password/emailPassword fill
// in by position among whatever's left).
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { text } = req.body as { text?: string };
    const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return res.status(400).json({ error: 'No accounts found in the pasted text' });

    const rows = lines
      .map(parseAccountLine)
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({ ...r, addedById: me.id, addedByName: me.name }));

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Each line needs at least a login and a password' });
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
