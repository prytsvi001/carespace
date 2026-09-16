// server/src/routes/reserveEmails.ts
// Peekviewer Team — "Reserve email" view inside the Row Accounts tab. A pool
// of spare email inboxes (admin-managed), where any team member can tag an
// account nickname onto an email via "+" so everyone can see how many
// accounts are already tied to it before reusing that email again. Adding/
// removing a linked account is open to any Peekviewer member; the email/
// password row itself follows the same admin-only add/edit/delete as Proxy
// and Row Accounts.
import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth, requirePeekviewerTeam } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePeekviewerTeam);

function isAdmin(user: Express.User): boolean {
  return user.peekviewerAdmin === true;
}

type LinkedAccount = { id: string; nickname: string; addedById: string; addedByName: string; createdAt: string };

function parseLinkedAccounts(raw: string): LinkedAccount[] {
  try { return JSON.parse(raw); } catch { return []; }
}

// Same column-splitting priority as Row Accounts' bulk add (tab > colon > 2+
// spaces > single space) so a spreadsheet paste of "email <tab> password"
// keeps a spaced password intact.
function splitColumns(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim());
  if (line.includes(':')) return line.split(':').map((s) => s.trim());
  if (/ {2,}/.test(line)) return line.split(/ {2,}/).map((s) => s.trim());
  return line.split(/\s+/).map((s) => s.trim());
}

// GET /api/reserve-emails — everyone on the Peekviewer team
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.reserveEmail.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(rows.map((r) => ({ ...r, linkedAccounts: parseLinkedAccounts(r.linkedAccounts) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch reserve emails' });
  }
});

// POST /api/reserve-emails/bulk — admin only. One "email password" per line
// (password optional — a line with just an email is fine).
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { text } = req.body as { text?: string };
    const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return res.status(400).json({ error: 'No emails found in the pasted text' });

    const rows = lines
      .map((line) => {
        const [email, ...rest] = splitColumns(line);
        if (!email) return null;
        return { email, emailPassword: rest.join(' ') || null, addedById: me.id, addedByName: me.name };
      })
      .filter((r): r is NonNullable<typeof r> => !!r);

    if (rows.length === 0) return res.status(400).json({ error: 'Each line needs at least an email' });

    await prisma.reserveEmail.createMany({ data: rows });

    const created = await prisma.reserveEmail.findMany({ orderBy: { createdAt: 'desc' }, take: rows.length });
    return res.status(201).json(created.map((r) => ({ ...r, linkedAccounts: parseLinkedAccounts(r.linkedAccounts) })));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add reserve emails' });
  }
});

// PATCH /api/reserve-emails/:id/accounts — any team member appends a linked
// account nickname (the "+" button).
router.patch('/:id/accounts', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const { nickname } = req.body as { nickname?: string };
    if (!nickname?.trim()) return res.status(400).json({ error: 'nickname is required' });

    const row = await prisma.reserveEmail.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Not found' });

    const linked = parseLinkedAccounts(row.linkedAccounts);
    linked.push({ id: randomUUID(), nickname: nickname.trim(), addedById: me.id, addedByName: me.name, createdAt: new Date().toISOString() });

    const updated = await prisma.reserveEmail.update({
      where: { id: req.params.id },
      data: { linkedAccounts: JSON.stringify(linked) },
    });
    return res.json({ ...updated, linkedAccounts: linked });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add linked account' });
  }
});

// DELETE /api/reserve-emails/:id/accounts/:accountId — whoever added that
// entry, or any admin, can remove it (fixing a mistaken/duplicate tag).
router.delete('/:id/accounts/:accountId', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const row = await prisma.reserveEmail.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Not found' });

    const linked = parseLinkedAccounts(row.linkedAccounts);
    const entry = linked.find((a) => a.id === req.params.accountId);
    if (!entry) return res.status(404).json({ error: 'Linked account not found' });
    if (entry.addedById !== me.id && !isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const next = linked.filter((a) => a.id !== req.params.accountId);
    const updated = await prisma.reserveEmail.update({
      where: { id: req.params.id },
      data: { linkedAccounts: JSON.stringify(next) },
    });
    return res.json({ ...updated, linkedAccounts: next });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to remove linked account' });
  }
});

// PATCH /api/reserve-emails/:id — admin only
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    const { email, emailPassword } = req.body as { email?: string; emailPassword?: string | null };

    const result = await prisma.reserveEmail.updateMany({
      where: { id: req.params.id },
      data: {
        ...(typeof email === 'string' ? { email: email.trim() } : {}),
        ...(emailPassword !== undefined ? { emailPassword: emailPassword?.trim() || null } : {}),
      },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.reserveEmail.findUnique({ where: { id: req.params.id } });
    return res.json({ ...updated, linkedAccounts: parseLinkedAccounts(updated!.linkedAccounts) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update reserve email' });
  }
});

// DELETE /api/reserve-emails/:id — admin only
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me)) return res.status(403).json({ error: 'Not permitted' });

    await prisma.reserveEmail.delete({ where: { id: req.params.id } }).catch(() => null);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete reserve email' });
  }
});

export default router;
