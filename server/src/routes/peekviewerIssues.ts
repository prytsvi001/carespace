// server/src/routes/peekviewerIssues.ts
// Support → Peekviewer team escalation from a Peek Requests card. Support
// picks recipients (To) and fills Peeker / Issue / Comment; recipients see it
// as an urgent block at the top of their Inbox and close it as resolved /
// blocked / suspended / other. Sending and closing both leave a comment on
// the card's active request, so the outcome is visible on the board.
import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';
import { sendTelegramMessage, CARESPACE_URL } from '../telegram';

const router = Router();
router.use(requireAuth);

const OUTCOMES = ['resolved', 'blocked', 'suspended', 'other'] as const;
type Outcome = (typeof OUTCOMES)[number];
const OUTCOME_LABELS: Record<Outcome, string> = {
  resolved: 'Resolved', blocked: 'Blocked', suspended: 'Suspended', other: 'Other',
};

const str = (v: unknown, max = 5000): string => (typeof v === 'string' ? v.slice(0, max).trim() : '');

function isSupport(me: Express.User): boolean {
  return me.team === 'support' || me.secondaryTeam === 'support';
}

const recipientIdList = (raw: string) => raw.split(',').filter(Boolean);

function formatIssue<T extends { recipientIds: string; recipientNames: string }>(i: T) {
  return { ...i, recipientIds: recipientIdList(i.recipientIds), recipientNames: i.recipientNames.split(',').filter(Boolean) };
}

// Appends a comment to the card's current active request (latest createdAt,
// same derivation peakRequests.ts uses) and bumps the card's activity.
async function commentOnCard(clientCardId: string, author: Express.User, text: string) {
  const active = await prisma.peakRequest.findFirst({
    where: { clientCardId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, comments: true },
  });
  if (!active) return null;
  let comments: unknown[] = [];
  try { comments = JSON.parse(active.comments); } catch { /* keep empty */ }
  comments.push({ id: randomUUID(), authorId: author.id, authorName: author.name, text, createdAt: new Date().toISOString() });
  await prisma.peakRequest.update({ where: { id: active.id }, data: { comments: JSON.stringify(comments) } });
  await prisma.clientCard.update({ where: { id: clientCardId }, data: { lastActivityAt: new Date() } });
  return { requestId: active.id, comments };
}

// GET /api/peekviewer-issues/recipients — Peekviewer team members to pick from.
router.get('/recipients', async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: { team: 'peekviewer' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recipients' });
  }
});

// GET /api/peekviewer-issues/mine — issues sent to the caller.
// ?handled=1 returns the last 30 closed ones instead of the open queue.
router.get('/mine', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const handled = req.query.handled === '1';
    const issues = await prisma.peekviewerIssue.findMany({
      where: { recipientIds: { contains: me.id }, status: handled ? { not: 'open' } : 'open' },
      orderBy: handled ? { resolvedAt: 'desc' } : { createdAt: 'asc' },
      take: handled ? 30 : undefined,
    });
    res.json(issues.map(formatIssue));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch issues' });
  }
});

// POST /api/peekviewer-issues — support sends an issue from a card.
// Body: { clientCardId, recipientIds[], peeker, issue, comment? }
router.post('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isSupport(me)) return res.status(403).json({ error: 'Not permitted' });

    const body = req.body as Record<string, unknown>;
    const clientCardId = str(body.clientCardId, 64);
    const peeker = str(body.peeker, 500);
    const issue = str(body.issue);
    const comment = str(body.comment);
    const ids = Array.isArray(body.recipientIds) ? body.recipientIds.filter((x): x is string => typeof x === 'string') : [];
    if (!clientCardId || !peeker || !issue || ids.length === 0) {
      return res.status(400).json({ error: 'Recipients, Peeker and Issue are required' });
    }

    const [card, recipients] = await Promise.all([
      prisma.clientCard.findUnique({ where: { id: clientCardId }, select: { id: true } }),
      prisma.user.findMany({ where: { id: { in: ids }, team: 'peekviewer' } }),
    ]);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    if (recipients.length === 0) return res.status(400).json({ error: 'Pick at least one Peekviewer team member' });

    const created = await prisma.peekviewerIssue.create({
      data: {
        clientCardId, senderId: me.id, senderName: me.name,
        recipientIds: recipients.map((r) => r.id).join(','),
        recipientNames: recipients.map((r) => r.name).join(','),
        peeker, issue, comment,
      },
    });

    const cardComments = await commentOnCard(clientCardId, me, `Sent to Peekviewer (${recipients.map((r) => r.name).join(', ')}) — Peeker: ${peeker} · Issue: ${issue}`);

    await Promise.all(recipients.filter((r) => r.telegramChatId).map((r) =>
      sendTelegramMessage(r.telegramChatId!, `Терміновий запит від ${me.name}: ${peeker} — ${issue.slice(0, 120)}. Опрацюйте в CareSpace (Inbox): ${CARESPACE_URL}`)
    ));

    // card lets the sender's board show the new comment without waiting for a refresh
    res.status(201).json({ ...formatIssue(created), card: cardComments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send issue' });
  }
});

// POST /api/peekviewer-issues/:id/close — any recipient. Body: { outcome, comment? }
// "resolved" needs no comment; blocked/suspended/other require one.
router.post('/:id/close', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const body = req.body as Record<string, unknown>;
    const outcome = body.outcome as Outcome;
    const comment = str(body.comment);
    if (!OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'Unknown outcome' });
    if (outcome !== 'resolved' && !comment) return res.status(400).json({ error: 'Please add a comment' });

    const existing = await prisma.peekviewerIssue.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!recipientIdList(existing.recipientIds).includes(me.id)) return res.status(403).json({ error: 'Not permitted' });
    if (existing.status !== 'open') return res.status(409).json({ error: `Already closed as ${existing.status} by ${existing.resolvedByName}` });

    // Conditional on still being open, so two recipients closing at the same
    // moment can't both post an outcome to the card.
    const { count } = await prisma.peekviewerIssue.updateMany({
      where: { id: existing.id, status: 'open' },
      data: { status: outcome, resolutionComment: comment, resolvedByName: me.name, resolvedAt: new Date() },
    });
    if (count === 0) return res.status(409).json({ error: 'Already closed by someone else' });
    const updated = (await prisma.peekviewerIssue.findUnique({ where: { id: existing.id } }))!;

    const label = OUTCOME_LABELS[outcome];
    await commentOnCard(existing.clientCardId, me, comment ? `${label}: ${comment}` : label);

    const sender = await prisma.user.findUnique({ where: { id: existing.senderId } });
    if (sender?.telegramChatId && sender.id !== me.id) {
      await sendTelegramMessage(
        sender.telegramChatId,
        `${me.name} (Peekviewer): ${label}${comment ? ` — ${comment.slice(0, 120)}` : ''} (${existing.peeker}). ${CARESPACE_URL}`
      );
    }

    res.json(formatIssue(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update issue' });
  }
});

export default router;
