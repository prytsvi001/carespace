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

// A column in the pasted text maps to one credential field, or 'skip' to
// ignore it (e.g. an extra column the source export happens to include).
const FIELD_KEYS = ['login', 'password', 'twoFaCode', 'email', 'emailPassword'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type ColumnKey = FieldKey | 'skip';

// Legacy fixed orders, still accepted from a client that sends `mode`.
const MODE_ORDERS: Record<Mode, ColumnKey[]> = {
  with2fa: ['login', 'password', 'twoFaCode', 'email', 'emailPassword'],
  without2fa: ['login', 'password', 'email', 'emailPassword'],
};

// Validates a client-chosen column order: known keys only, each field at most
// once, and login + password must be present.
function parseOrder(raw: unknown): ColumnKey[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const seen = new Set<string>();
  for (const k of raw) {
    if (k === 'skip') continue;
    if (!FIELD_KEYS.includes(k) || seen.has(k)) return null;
    seen.add(k);
  }
  if (!seen.has('login') || !seen.has('password')) return null;
  return raw as ColumnKey[];
}

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

// Splits one pasted line into a credential row, assigning the i-th column to
// order[i] (the column order chosen in the Add modal).
function parseAccountLine(line: string, order: ColumnKey[]): {
  login: string; password: string; twoFaCode: string | null; email: string | null; emailPassword: string | null;
} | null {
  // Not filtered for blanks — a middle column left empty (e.g. no 2FA between
  // two tabs) must keep its position so later columns don't shift left.
  const tokens = splitColumns(line);
  if (tokens.length === 0 || !tokens.some(Boolean)) return null;

  const row: Partial<Record<FieldKey, string>> = {};
  order.forEach((key, i) => {
    if (key !== 'skip' && tokens[i]) row[key] = tokens[i];
  });
  if (!row.login || !row.password) return null;

  return {
    login: row.login,
    password: row.password,
    twoFaCode: row.twoFaCode || null,
    email: row.email || null,
    emailPassword: row.emailPassword || null,
  };
}

// GET /api/row-accounts — everyone; split into available/archive client-side by takenById
router.get('/', async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.rowAccount.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch raw accounts' });
  }
});

// POST /api/row-accounts/bulk — admin only. Body: { text: string, order:
// ColumnKey[], header?: string } (or the legacy `mode` instead of `order`),
// one account per non-blank line, columns mapped by order; header
// classifies the whole batch into a named block, same as Proxy.header.
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { text, mode, order: rawOrder, header } = req.body as {
      text?: string; mode?: string; order?: unknown; header?: string;
    };
    const order = rawOrder !== undefined
      ? parseOrder(rawOrder)
      : MODES.includes(mode as Mode) ? MODE_ORDERS[mode as Mode] : null;
    if (!order) {
      return res.status(400).json({ error: 'Invalid column order: each field at most once, Nickname and Password required' });
    }

    const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return res.status(400).json({ error: 'No accounts found in the pasted text' });

    const rows = lines
      .map((line) => parseAccountLine(line, order))
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
    return res.status(500).json({ error: 'Failed to add raw accounts' });
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
    return res.status(500).json({ error: 'Failed to take raw account' });
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
    return res.status(500).json({ error: 'Failed to archive raw account' });
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
    return res.status(500).json({ error: 'Failed to update raw account' });
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
    res.status(500).json({ error: 'Failed to delete raw account' });
  }
});

export default router;
