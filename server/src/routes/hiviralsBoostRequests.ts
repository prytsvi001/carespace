// server/src/routes/hiviralsBoostRequests.ts
// HiVirals boost requests. A support agent creates one from Inbox's
// "HiVirals Boost Request" view (client account profile: email, plan, dates,
// stats, niche, social circle, hashtags, notes). It lands in Anna Bilous's
// Inbox (companion InboxMessage + Telegram, same split as AccountRequest) and
// in the Peekviewer "HiVirals" tab, where Anna — or Sandra Moore/Victoria
// Davis — log per day which followers/likes/comments were delivered, then
// End Boost, which notifies every support agent. Deleting is per-side, same as
// AccountRequest.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';
import { sendTelegramMessage, CARESPACE_URL } from '../telegram';

const router = Router();
router.use(requireAuth);

const ANNA_EMAIL = 'anna_bilous@struktura.io';
// Anna processes the queue; Sandra Moore and Victoria Davis have the same rights.
const MANAGER_EMAILS = new Set([
  ANNA_EMAIL,
  'oleksandra_kraichynska@struktura.io',
  'victoria_pryts@struktura.io',
]);

const PROFILE_FIELDS = [
  'email', 'plan', 'accountName', 'startDate', 'endDate',
  'followersCount', 'postsCount', 'followingCount', 'engagementRate',
  'niche', 'interests', 'publicLinks', 'postLinks', 'hashtags', 'notes',
] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];
const PLAN_LABELS: Record<string, string> = { starter: 'Starter', business: 'Business', pro: 'PRO' };
const PLANS = Object.keys(PLAN_LABELS);
// End point stats — filled in by Anna after the boost, never by the requester.
const END_FIELDS = ['endFollowersCount', 'endPostsCount', 'endFollowingCount', 'endEngagementRate'] as const;

type FollowerRow = { id: string; date: string; username: string };
type LikeRow = { id: string; date: string; username: string; postUrl: string };
type CommentRow = { id: string; date: string; username: string; postUrl: string; text: string };
type Day = { id: string; date: string; followers: FollowerRow[]; likes: LikeRow[]; comments: CommentRow[] };

function isManager(me: Express.User): boolean {
  return MANAGER_EMAILS.has(me.email);
}

function isSupport(me: Express.User): boolean {
  return me.team === 'support' || me.secondaryTeam === 'support';
}

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];

// Days come straight from the client's editor — keep only known keys/strings
// so a malformed payload can't store arbitrary JSON.
function sanitizeDays(raw: unknown): Day[] | null {
  if (!Array.isArray(raw)) return null;
  return arr(raw).slice(0, 365).map((d) => ({
    id: str(d.id, 64),
    date: str(d.date, 10),
    followers: arr(d.followers).map((r) => ({ id: str(r.id, 64), date: str(r.date, 10), username: str(r.username, 200) })),
    likes: arr(d.likes).map((r) => ({ id: str(r.id, 64), date: str(r.date, 10), username: str(r.username, 200), postUrl: str(r.postUrl, 1000) })),
    comments: arr(d.comments).map((r) => ({
      id: str(r.id, 64), date: str(r.date, 10), username: str(r.username, 200), postUrl: str(r.postUrl, 1000), text: str(r.text, 2000),
    })),
  }));
}

function parseDays(raw: string): Day[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function formatRequest<T extends { days: string }>(r: T) {
  return { ...r, days: parseDays(r.days) };
}

// GET /api/hivirals-boost-requests — the full queue, managers only.
router.get('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isManager(me)) return res.status(403).json({ error: 'Not permitted' });
    const requests = await prisma.hiviralsBoostRequest.findMany({ where: { deletedByAdmin: false, status: { not: 'draft' } }, orderBy: { createdAt: 'desc' } });
    res.json(requests.map(formatRequest));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch HiVirals boost requests' });
  }
});

// GET /api/hivirals-boost-requests/sent — the caller's own requests.
router.get('/sent', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const requests = await prisma.hiviralsBoostRequest.findMany({
      where: { requesterId: me.id, deletedByRequester: false, status: { not: 'draft' } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(requests.map(formatRequest));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sent HiVirals boost requests' });
  }
});

function readProfile(body: Record<string, unknown>): Record<ProfileField, string> {
  const data = {} as Record<ProfileField, string>;
  for (const f of PROFILE_FIELDS) data[f] = str(body[f], 5000).trim();
  return data;
}

function validateProfile(data: Record<ProfileField, string>): string | null {
  if (!data.email) return 'email is required';
  if (!PLANS.includes(data.plan)) return 'plan must be starter, business, or pro';
  return null;
}

// Lands a submitted request in Anna's Inbox + Telegram.
async function notifyAnna(me: Express.User, requestId: string, data: Record<ProfileField, string>) {
  const anna = await prisma.user.findUnique({ where: { email: ANNA_EMAIL } });
  if (!anna || anna.id === me.id) return;
  const summary = [
    `Email: ${data.email}`,
    `Plan: ${PLAN_LABELS[data.plan]}`,
    data.accountName && `Account: ${data.accountName}`,
    (data.startDate || data.endDate) && `Dates: ${data.startDate || '—'} → ${data.endDate || '—'}`,
    'Full details are in the HiVirals tab.',
  ].filter(Boolean).join('\n');
  const message = await prisma.inboxMessage.create({
    data: {
      senderId: me.id, receiverId: anna.id, type: 'hivirals_boost',
      subject: 'New HiVirals boost request', content: summary,
    },
  });
  await prisma.hiviralsBoostRequest.update({ where: { id: requestId }, data: { inboxMessageId: message.id } });
  if (anna.telegramChatId) {
    await sendTelegramMessage(
      anna.telegramChatId,
      `Новий запит на HiVirals boost від ${me.name} (${data.accountName || data.email}). Перегляньте деталі в CareSpace: ${CARESPACE_URL}`
    );
  }
}

// POST /api/hivirals-boost-requests — any support-team member, created and
// submitted in one go (used when the form is sent before its draft exists).
router.post('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isSupport(me) && !isManager(me)) return res.status(403).json({ error: 'Not permitted' });

    const data = readProfile(req.body as Record<string, unknown>);
    const invalid = validateProfile(data);
    if (invalid) return res.status(400).json({ error: invalid });

    const request = await prisma.hiviralsBoostRequest.create({
      data: { ...data, requesterId: me.id, requesterName: me.name },
    });
    await notifyAnna(me, request.id, data);

    return res.status(201).json(formatRequest(request));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create HiVirals boost request' });
  }
});

// ── Drafts ──────────────────────────────────────────────────────────────────
// An unfinished request autosaves as a draft (status "draft") that every
// support agent sees — one agent often starts it and another finishes. Drafts
// never reach Anna's queue until submitted; whoever submits becomes the
// requester.

// GET /api/hivirals-boost-requests/drafts — all drafts, any support agent.
router.get('/drafts', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isSupport(me) && !isManager(me)) return res.status(403).json({ error: 'Not permitted' });
    const drafts = await prisma.hiviralsBoostRequest.findMany({ where: { status: 'draft' }, orderBy: { updatedAt: 'desc' } });
    res.json(drafts.map(formatRequest));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch drafts' });
  }
});

// POST /api/hivirals-boost-requests/drafts — start a draft (no validation).
router.post('/drafts', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isSupport(me) && !isManager(me)) return res.status(403).json({ error: 'Not permitted' });
    const draft = await prisma.hiviralsBoostRequest.create({
      data: {
        ...readProfile(req.body as Record<string, unknown>),
        status: 'draft', requesterId: me.id, requesterName: me.name, draftEditorName: me.name,
      },
    });
    res.status(201).json(formatRequest(draft));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

async function findDraft(id: string) {
  const draft = await prisma.hiviralsBoostRequest.findUnique({ where: { id } });
  return draft?.status === 'draft' ? draft : null;
}

// PUT /api/hivirals-boost-requests/drafts/:id — autosave, any support agent.
router.put('/drafts/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isSupport(me) && !isManager(me)) return res.status(403).json({ error: 'Not permitted' });
    if (!(await findDraft(req.params.id))) return res.status(404).json({ error: 'Draft not found — it may have been sent or deleted' });
    const draft = await prisma.hiviralsBoostRequest.update({
      where: { id: req.params.id },
      data: { ...readProfile(req.body as Record<string, unknown>), draftEditorName: me.name },
    });
    res.json(formatRequest(draft));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// POST /api/hivirals-boost-requests/drafts/:id/submit — any support agent
// sends the draft (body = final form). Notifies Anna like a direct create.
router.post('/drafts/:id/submit', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isSupport(me) && !isManager(me)) return res.status(403).json({ error: 'Not permitted' });
    if (!(await findDraft(req.params.id))) return res.status(404).json({ error: 'Draft not found — it may have been sent or deleted' });

    const data = readProfile(req.body as Record<string, unknown>);
    const invalid = validateProfile(data);
    if (invalid) return res.status(400).json({ error: invalid });

    const request = await prisma.hiviralsBoostRequest.update({
      where: { id: req.params.id },
      data: { ...data, status: 'active', requesterId: me.id, requesterName: me.name, draftEditorName: '', createdAt: new Date() },
    });
    await notifyAnna(me, request.id, data);
    res.json(formatRequest(request));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// DELETE /api/hivirals-boost-requests/drafts/:id — any support agent discards a draft.
router.delete('/drafts/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isSupport(me) && !isManager(me)) return res.status(403).json({ error: 'Not permitted' });
    if (!(await findDraft(req.params.id))) return res.status(404).json({ error: 'Draft not found' });
    await prisma.hiviralsBoostRequest.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

// PATCH /api/hivirals-boost-requests/:id — managers only.
// Body: { days?, endFollowersCount?, endPostsCount?, endFollowingCount?, endEngagementRate? }
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isManager(me)) return res.status(403).json({ error: 'Not permitted' });

    const body = req.body as Record<string, unknown>;
    const data: Record<string, string> = {};
    if (body.days !== undefined) {
      const days = sanitizeDays(body.days);
      if (!days) return res.status(400).json({ error: 'days must be an array' });
      data.days = JSON.stringify(days);
    }
    for (const f of END_FIELDS) if (body[f] !== undefined) data[f] = str(body[f], 200).trim();

    const existing = await prisma.hiviralsBoostRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.status === 'draft') return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.hiviralsBoostRequest.update({ where: { id: existing.id }, data });
    res.json(formatRequest(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update HiVirals boost request' });
  }
});

// POST /api/hivirals-boost-requests/:id/end — managers only. Marks the boost
// ended and notifies every support agent once (Inbox + Telegram).
router.post('/:id/end', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isManager(me)) return res.status(403).json({ error: 'Not permitted' });

    const existing = await prisma.hiviralsBoostRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.status === 'draft') return res.status(404).json({ error: 'Not found' });
    if (existing.status === 'ended') return res.json(formatRequest(existing));

    const updated = await prisma.hiviralsBoostRequest.update({
      where: { id: existing.id },
      data: { status: 'ended', endedAt: new Date() },
    });

    // Every support agent hears about it, not just the requester — whoever
    // picks up the client's chat next needs to know the boost is done.
    const label = existing.accountName || existing.email;
    const supportUsers = await prisma.user.findMany({
      where: { OR: [{ team: 'support' }, { secondaryTeam: 'support' }], id: { not: me.id } },
    });
    await prisma.inboxMessage.createMany({
      data: supportUsers.map((u) => ({
        senderId: me.id, receiverId: u.id, type: 'hivirals_boost',
        subject: 'HiVirals boost completed',
        content: `The HiVirals boost for ${label} (requested by ${existing.requesterName}) has been completed.`,
      })),
    });
    await Promise.all(supportUsers.filter((u) => u.telegramChatId).map((u) =>
      sendTelegramMessage(u.telegramChatId!, `HiVirals boost для ${label} завершено. Перегляньте деталі в CareSpace: ${CARESPACE_URL}`)
    ));

    res.json(formatRequest(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to end HiVirals boost' });
  }
});

// DELETE /api/hivirals-boost-requests/:id — per-side soft delete, same as
// AccountRequest: managers delete from the queue, the requester from their
// own list; the row is only removed once both sides have deleted it.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    const existing = await prisma.hiviralsBoostRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.status === 'draft') return res.status(404).json({ error: 'Not found' });

    const manager = isManager(me);
    const isOwner = existing.requesterId === me.id;
    if (!manager && !isOwner) return res.status(403).json({ error: 'Not permitted' });

    const { scope } = req.body as { scope?: 'requester' | 'admin' };
    const asRequester = !manager || (isOwner && scope === 'requester');

    const deletedByRequester = asRequester ? true : existing.deletedByRequester;
    const deletedByAdmin = asRequester ? existing.deletedByAdmin : true;

    if (deletedByRequester && deletedByAdmin) {
      await prisma.hiviralsBoostRequest.delete({ where: { id: existing.id } });
    } else {
      await prisma.hiviralsBoostRequest.update({ where: { id: existing.id }, data: { deletedByRequester, deletedByAdmin } });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete HiVirals boost request' });
  }
});

export default router;
