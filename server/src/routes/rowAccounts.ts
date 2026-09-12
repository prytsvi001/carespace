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

const MODES = ['with2fa', 'without2fa'] as const;
type Mode = (typeof MODES)[number];

// Splits a pasted line into columns. A 2FA value itself can contain single
// spaces (e.g. a backup-code block like "RYPR ZYF4 JIZ2 ..."), so a generic
// "split on any whitespace" would shred it into extra tokens and misalign
// everything after it. Column separators are resolved in priority order:
//   1. Tab — what an actual spreadsheet paste (Excel/Sheets) uses between
//      columns; splitting only on "\t" keeps any spaces inside a cell intact.
//   2. Colon — the legacy typed format.
//   3. A run of 2+ spaces — someone manually lined up columns with padding
//      instead of a real tab; a single space stays part of the value.
//   4. A single space — only reached when none of the above apply, i.e. a
//      simple line with no field containing a space at all.
function splitColumns(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim());
  if (line.includes(':')) return line.split(':').map((s) => s.trim());
  if (/ {2,}/.test(line)) return line.split(/ {2,}/).map((s) => s.trim());
  return line.split(/\s+/).map((s) => s.trim());
}

// Splits one pasted line into a credential row by a fixed column order that
// depends on the chosen mode:
//   with2fa:    nickname password 2FA email emailPassword
//   without2fa: nickname password email emailPassword
function parseAccountLine(line: string, mode: Mode): {
  login: string; password: string; twoFaCode: string | null; email: string | null; emailPassword: string | null;
} | null {
  // Not filtered for blanks — a middle column left empty (e.g. no 2FA between
  // two tabs) must keep its position so later columns don't shift left.
  const tokens = splitColumns(line);
  if (tokens.length === 0 || !tokens.some(Boolean)) return null;

  const [login, password, third, fourth, fifth] = tokens;
  if (!login || !password) return null;

  return mode === 'with2fa'
    ? { login, password, twoFaCode: third || null, email: fourth || null, emailPassword: fifth || null }
    : { login, password, twoFaCode: null, email: third || null, emailPassword: fourth || null };
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

// POST /api/row-accounts/bulk — admin only. Body: { text: string, mode:
// 'with2fa' | 'without2fa', header?: string }, one account per non-blank
// line, columns in a fixed order per mode (see parseAccountLine); header
// classifies the whole batch into a named block, same as Proxy.header.
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { text, mode, header } = req.body as { text?: string; mode?: string; header?: string };
    if (!MODES.includes(mode as Mode)) {
      return res.status(400).json({ error: 'mode must be "with2fa" or "without2fa"' });
    }

    const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return res.status(400).json({ error: 'No accounts found in the pasted text' });

    const rows = lines
      .map((line) => parseAccountLine(line, mode as Mode))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({ ...r, header: header?.trim() || '', addedById: me.id, addedByName: me.name }));

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

// PATCH /api/row-accounts/:id/take — any team member claims an available
// account. No longer archives it — it stays in the Available list, highlighted.
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

// PATCH /api/row-accounts/:id/archive — any team member; no confirmation
// step, moves the row straight to the Archive list.
router.patch('/:id/archive', async (req: Request, res: Response) => {
  try {
    const result = await prisma.rowAccount.updateMany({
      where: { id: req.params.id },
      data: { archived: true },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.rowAccount.findUnique({ where: { id: req.params.id } });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to archive row account' });
  }
});

// PATCH /api/row-accounts/:id — admin only
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { login, password, twoFaCode, email, emailPassword, header } = req.body as {
      login?: string; password?: string; twoFaCode?: string | null; email?: string | null; emailPassword?: string | null; header?: string;
    };

    const result = await prisma.rowAccount.updateMany({
      where: { id: req.params.id },
      data: {
        ...(typeof login === 'string' ? { login: login.trim() } : {}),
        ...(typeof password === 'string' ? { password: password.trim() } : {}),
        ...(twoFaCode !== undefined ? { twoFaCode: twoFaCode?.trim() || null } : {}),
        ...(email !== undefined ? { email: email?.trim() || null } : {}),
        ...(emailPassword !== undefined ? { emailPassword: emailPassword?.trim() || null } : {}),
        ...(header !== undefined ? { header: header.trim() } : {}),
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
