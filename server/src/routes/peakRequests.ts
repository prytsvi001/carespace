// server/src/routes/peakRequests.ts
// "Client Card" board: one card per unique client (matched by contactEmail +
// profileNickname), holding the full history of their requests. The "active"
// request for a card is simply the one with the latest (createdAt, id) —
// derived, not a stored flag — everything older is read-only history.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { sendTelegramMessage, CARESPACE_URL } from '../telegram';

const router = Router();

type PeakComment = { authorId: string | null; authorName: string; text: string; createdAt: string };

function parseComments(raw: string): PeakComment[] {
  try { return JSON.parse(raw); } catch { return []; }
}

// Same normalization used in scripts/backfill-peak-request-client-cards.ts —
// keep both in sync if this ever changes. Null when either field is blank, so
// blank-identity cards never accidentally merge with each other (Postgres and
// SQLite both treat multiple NULLs as non-conflicting under a unique index).
function normalizeMatchKey(email: string | null | undefined, nickname: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  const n = nickname?.trim().toLowerCase();
  if (!e || !n) return null;
  return `${e}|${n}`;
}

// The peek team: Iryna Kolodienko, Victoria Horopeka (both peek_handler role),
// and Julia Manson (peekCalendarAccess flag) — same shape as peekCalendar.ts's
// isAssignable, duplicated locally rather than cross-imported (matches
// normalizeMatchKey's precedent above). Gates both the "checked" stamp and
// self-crediting on Done.
function isTrackedAgent(u: { role: string; peekCalendarAccess: boolean }): boolean {
  return u.role === 'peek_handler' || u.peekCalendarAccess;
}

// UTC-midnight day marker, same convention as peekCalendar.ts's parseDayMarker
// / PeekCalendarEntry.eventDate.
function todayDayMarker(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Tags (see TAGS in PeakRequests.tsx) that mean the card didn't actually get
// resolved as a support outcome — the client lost access / is blocked, not
// something the peek agent fixed — so it shouldn't count as a processed
// request even when a tracked peek agent is the one who moved it to Done.
const NON_COUNTABLE_TAGS = ['blocked', 'lost_access'];

function hasNonCountableTag(tags: string | null | undefined): boolean {
  const keys = (tags || '').split(',').filter(Boolean);
  return keys.some((k) => NON_COUNTABLE_TAGS.includes(k));
}

// Credit-assignment rule: only counts when whoever moved the card to Done is
// themselves one of the 3 tracked peek agents (self-credited). A regular
// support agent resolving a card records no credit at all — this used to
// fall back to crediting whoever was the sole agent scheduled on the Peek
// Calendar that day, but that guessed credit for work they didn't actually
// do (see the August 2026 Julia Manson correction — request from Victoria
// Davis to only count a peek agent's own resolutions). Also skips entirely
// when the active request carries a non-countable tag (request from Victoria
// Davis: "Blocked"/"Lost access" outcomes shouldn't count as processed).
// Never allowed to throw past this point — credit-tracking must not break
// the status change it's attached to.
async function recordResolutionCredit(clientCardId: string, sessionUser: Express.User, activeRequestTags: string | null | undefined) {
  try {
    if (hasNonCountableTag(activeRequestTags)) return;

    const actor = await prisma.user.findUnique({ where: { id: sessionUser.id } });
    if (!actor || !isTrackedAgent(actor)) return;

    await prisma.peekResolutionCredit.create({
      data: {
        clientCardId,
        movedByUserId: actor.id,
        movedByName: actor.name,
        creditedUserId: actor.id,
        creditedName: actor.name,
        resolvedDate: todayDayMarker(),
      },
    });
  } catch (err) {
    console.error('Failed to record resolution credit:', err);
  }
}

type RawRequest = {
  id: string; agentId: string; agent: { id: string; name: string };
  requestText: string; status: string; doneAt: Date | null;
  comments: string; tags: string; createdAt: Date; updatedAt: Date;
};

// Drops the legacy per-row contactEmail/profileNickname/archived/clientCardId —
// those are now ClientCard-level concerns; showing them per-history-row would
// just go stale the moment the card's identity is edited.
function formatRequestEntry(r: RawRequest) {
  return {
    id: r.id, agentId: r.agentId, agent: r.agent,
    requestText: r.requestText, status: r.status, doneAt: r.doneAt,
    comments: parseComments(r.comments), tags: r.tags,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

type RawCard = {
  id: string; contactEmail: string | null; profileNickname: string | null;
  status: string; starred: boolean; archived: boolean; lastActivityAt: Date;
  lastCheckedByName: string | null; lastCheckedAt: Date | null;
  requests: RawRequest[]; // pre-sorted desc by (createdAt, id) — requests[0] is active
};

function formatCard(card: RawCard) {
  const [active, ...history] = card.requests;
  return {
    id: card.id,
    contactEmail: card.contactEmail,
    profileNickname: card.profileNickname,
    status: card.status,
    starred: card.starred,
    archived: card.archived,
    requestCount: card.requests.length,
    lastActivityAt: card.lastActivityAt,
    lastCheckedByName: card.lastCheckedByName,
    lastCheckedAt: card.lastCheckedAt,
    // Deterministic, no fragile time-window: a returning client's fresh issue
    // reads as "new activity" for as long as the card is genuinely sitting in
    // New with more than one request behind it.
    hasNewActivity: card.requests.length > 1 && card.status === 'NEW',
    activeRequest: formatRequestEntry(active),
    history: history.map(formatRequestEntry),
  };
}

const CARD_INCLUDE = {
  requests: {
    include: { agent: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  },
};

const DONE_ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;

// Runs on every board load/poll — no separate cron process needed (production
// runs as Vercel serverless functions, which can't host a long-lived timer).
// Cards that were already DONE before this existed have no doneAt yet;
// stamping them with "now" here means their 24h timer effectively starts at
// first-check-after-deploy.
async function autoArchiveStaleDone() {
  const now = new Date();
  await prisma.clientCard.updateMany({
    where: { status: 'DONE', archived: false, doneAt: null },
    data: { doneAt: now },
  });
  await prisma.clientCard.updateMany({
    where: { status: 'DONE', archived: false, doneAt: { lte: new Date(now.getTime() - DONE_ARCHIVE_AFTER_MS) } },
    data: { archived: true },
  });
}

// GET /api/peak-requests?status=NEW&agentId=...
router.get('/', async (req: Request, res: Response) => {
  try {
    await autoArchiveStaleDone();
    const { status, agentId, limit = '50', offset = '0', includeArchived, search } = req.query;

    const where: Record<string, unknown> = includeArchived === 'true' ? {} : { archived: false };
    if (search) {
      const s = search as string;
      where.OR = [
        { contactEmail: { contains: s } },
        { profileNickname: { contains: s } },
        { requests: { some: { requestText: { contains: s } } } },
        { requests: { some: { comments: { contains: s } } } },
      ];
    }
    if (status) where.status = status as string;
    if (agentId) where.requests = { some: { agentId: agentId as string } };

    const sessionUser = req.user as Express.User;
    const [cards, total, me] = await Promise.all([
      prisma.clientCard.findMany({
        where,
        include: CARD_INCLUDE,
        orderBy: { lastActivityAt: 'desc' },
        take: Number(limit),
        skip: Number(offset),
      }),
      prisma.clientCard.count({ where }),
      // peekCalendarAccess isn't in the session payload (same reasoning as
      // peekCalendar.ts's loadMe), so this needs a fresh read.
      prisma.user.findUnique({ where: { id: sessionUser.id } }),
    ]);

    res.json({
      cards: cards.map(formatCard),
      total,
      canCheckAccounts: !!me && isTrackedAgent(me),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch peak requests' });
  }
});

// GET /api/peak-requests/new-count — distinct clients, not raw request rows
router.get('/new-count', async (req: Request, res: Response) => {
  try {
    await autoArchiveStaleDone();
    const count = await prisma.clientCard.count({
      where: { archived: false, status: 'NEW' },
    });
    res.json({ count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch new requests count' });
  }
});

// POST /api/peak-requests — match-or-create a ClientCard, then always create a new PeakRequest under it
router.post('/', async (req: Request, res: Response) => {
  try {
    const { agentId, contactEmail, profileNickname, requestText } = req.body;

    if (!agentId || !requestText) {
      return res.status(400).json({ error: 'agentId and requestText are required' });
    }

    const email = contactEmail || null;
    const nickname = profileNickname || null;
    const key = normalizeMatchKey(email, nickname);

    // `upsert` on the unique matchKey resolves concurrent submissions from the
    // same brand-new client atomically — the DB, not a check-then-act race in
    // app code. Blank-identity submissions (key === null) always create a new
    // card; two nulls never collide under a unique index.
    const card = key
      ? await prisma.clientCard.upsert({
          where: { matchKey: key },
          update: { status: 'NEW', archived: false, doneAt: null, lastActivityAt: new Date() },
          create: { contactEmail: email, profileNickname: nickname, matchKey: key },
        })
      : await prisma.clientCard.create({ data: { contactEmail: email, profileNickname: nickname, matchKey: null } });

    await prisma.peakRequest.create({
      data: { clientCardId: card.id, agentId, contactEmail: email, profileNickname: nickname, requestText, status: 'NEW' },
    });

    // Only notify users currently toggled "on duty" via the dedicated Peek Duty status
    // (User.peekOnDuty, set through PATCH /api/duty/me) — a separate concept from the
    // Daily Log shift system. Fires for every new request, whether it created a fresh
    // card or added to an existing one — a fresh inbound issue deserves the same nudge.
    const onlinePeekHandlers = await prisma.user.findMany({
      where: { peekOnDuty: true, telegramChatId: { not: null } },
    });
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    const notifyText = `New Peak Request from ${agent?.name ?? 'an agent'}: ${requestText.trim().slice(0, 120)} ${CARESPACE_URL}`;
    await Promise.allSettled(
      onlinePeekHandlers.map((u) => sendTelegramMessage(u.telegramChatId as string, notifyText)),
    );

    const withRequests = await prisma.clientCard.findUnique({ where: { id: card.id }, include: CARD_INCLUDE });
    return res.status(201).json(formatCard(withRequests!));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create peak request' });
  }
});

// PUT /api/peak-requests/:id — :id is the active PeakRequest's id. Updates the
// request's own text/agent, and its parent card's identity fields (with a
// collision guard, since editing email/nickname could otherwise merge two
// previously-distinct clients together).
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { agentId, contactEmail, profileNickname, requestText } = req.body;

    if (!agentId || !requestText) {
      return res.status(400).json({ error: 'agentId and requestText are required' });
    }

    const existing = await prisma.peakRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    const email = contactEmail || null;
    const nickname = profileNickname || null;
    const key = normalizeMatchKey(email, nickname);

    if (key) {
      const collision = await prisma.clientCard.findUnique({ where: { matchKey: key } });
      if (collision && collision.id !== existing.clientCardId) {
        return res.status(409).json({ error: 'This email/nickname already belongs to another client card' });
      }
    }

    try {
      await prisma.clientCard.update({
        where: { id: existing.clientCardId },
        data: { contactEmail: email, profileNickname: nickname, matchKey: key },
      });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') {
        return res.status(409).json({ error: 'This email/nickname already belongs to another client card' });
      }
      throw err;
    }

    await prisma.peakRequest.update({
      where: { id },
      data: { agentId, contactEmail: email, profileNickname: nickname, requestText },
    });

    const card = await prisma.clientCard.findUnique({ where: { id: existing.clientCardId }, include: CARD_INCLUDE });
    return res.json(formatCard(card!));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update peak request' });
  }
});

// PATCH /api/peak-requests/:id/fields — lightweight inline update (tags) on the active request
router.patch('/:id/fields', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tags } = req.body;

    const data: Record<string, unknown> = {};
    if (tags !== undefined) data.tags = tags;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const request = await prisma.peakRequest.update({
      where: { id },
      data,
      include: { agent: { select: { id: true, name: true } } },
    });

    return res.json(formatRequestEntry(request));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update fields' });
  }
});

// POST /api/peak-requests/:id/comments — append a comment to the active request
router.post('/:id/comments', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const { id } = req.params;
    const { text } = req.body as { text?: string };

    if (!text?.trim()) return res.status(400).json({ error: 'Comment text is required' });

    const existing = await prisma.peakRequest.findUnique({ where: { id }, select: { comments: true, agentId: true } });
    if (!existing) return res.status(404).json({ error: 'Request not found' });

    const comments = parseComments(existing.comments);
    comments.push({
      authorId: user.id,
      authorName: user.name,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    });

    const request = await prisma.peakRequest.update({
      where: { id },
      data: { comments: JSON.stringify(comments) },
      include: { agent: { select: { id: true, name: true } } },
    });

    const originalRequester = await prisma.user.findFirst({ where: { agentId: existing.agentId } });
    if (originalRequester && originalRequester.id !== user.id && originalRequester.telegramChatId) {
      const notifyText = `${user.name} commented on your Peek Request: ${text.trim().slice(0, 120)} ${CARESPACE_URL}`;
      await sendTelegramMessage(originalRequester.telegramChatId, notifyText);
    }

    return res.json(formatRequestEntry(request));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to add comment' });
  }
});

// PATCH /api/peak-requests/cards/:id/status
router.patch('/cards/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['NEW', 'IN_PROGRESS', 'DONE'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const card = await prisma.clientCard.findUnique({ where: { id }, include: CARD_INCLUDE });
    if (!card) return res.status(404).json({ error: 'Card not found' });

    const wasAlreadyDone = card.status === 'DONE';
    const doneAt = status === 'DONE' ? (wasAlreadyDone ? card.doneAt : new Date()) : null;

    await prisma.clientCard.update({ where: { id }, data: { status, doneAt } });

    const active = card.requests[0];
    if (active) {
      await prisma.peakRequest.update({ where: { id: active.id }, data: { status, doneAt } });
    }

    if (status === 'DONE' && !wasAlreadyDone) {
      await recordResolutionCredit(id, req.user as Express.User, active?.tags);
    }

    const updated = await prisma.clientCard.findUnique({ where: { id }, include: CARD_INCLUDE });
    return res.json(formatCard(updated!));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

// PATCH /api/peak-requests/cards/:id/checked — "I verified this account still
// works" stamp, settable only by the peek team (isTrackedAgent).
router.patch('/cards/:id/checked', async (req: Request, res: Response) => {
  try {
    const sessionUser = req.user as Express.User;
    const me = await prisma.user.findUnique({ where: { id: sessionUser.id } });
    if (!me || !isTrackedAgent(me)) return res.status(403).json({ error: 'Not allowed' });

    const card = await prisma.clientCard.update({
      where: { id: req.params.id },
      data: { lastCheckedByName: me.name, lastCheckedAt: new Date() },
      include: CARD_INCLUDE,
    });
    return res.json(formatCard(card));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to record check' });
  }
});

// PATCH /api/peak-requests/cards/:id/star
router.patch('/cards/:id/star', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { starred } = req.body as { starred?: boolean };
    if (typeof starred !== 'boolean') return res.status(400).json({ error: 'starred (boolean) is required' });

    const card = await prisma.clientCard.update({ where: { id }, data: { starred }, include: CARD_INCLUDE });
    return res.json(formatCard(card));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update priority' });
  }
});

// DELETE (archive) /api/peak-requests/cards/:id
router.delete('/cards/:id', async (req: Request, res: Response) => {
  try {
    await prisma.clientCard.update({ where: { id: req.params.id }, data: { archived: true } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to archive client card' });
  }
});

// DELETE /api/peak-requests/cards/delete/:id — cascades its PeakRequest rows
router.delete('/cards/delete/:id', async (req: Request, res: Response) => {
  try {
    await prisma.clientCard.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete client card' });
  }
});

// GET /api/peak-requests/analysis/all-tagged — head/lead only, read-only,
// temporary audit for Victoria Davis. The Blocked/Lost access tab on the
// board (PeakRequests.tsx) only ever looks at each card's ACTIVE request's
// tags, since that's the current live issue — this checks every ClientCard
// (any status, archived included) across its FULL history to catch the one
// case the tab can't show: a card whose active request has no tag but an
// older, already-resolved request under the same card once carried one.
// Delete this route once the reconciliation is confirmed; no ongoing purpose.
router.get('/analysis/all-tagged', async (req: Request, res: Response) => {
  try {
    const sessionUser = req.user as Express.User;
    const me = await prisma.user.findUnique({ where: { id: sessionUser.id } });
    if (!me || !(me.role === 'head' || me.role === 'lead')) return res.status(403).json({ error: 'Not allowed' });

    const cards = await prisma.clientCard.findMany({ include: CARD_INCLUDE });

    const visibleInTab: { clientCardId: string; profileNickname: string | null; contactEmail: string | null; status: string; archived: boolean; tags: string[] }[] = [];
    const hiddenFromTab: { clientCardId: string; profileNickname: string | null; contactEmail: string | null; status: string; archived: boolean; taggedRequestTags: string[]; taggedRequestCreatedAt: Date }[] = [];

    for (const card of cards) {
      const [active, ...history] = card.requests;
      const activeTags = (active?.tags || '').split(',').filter(Boolean);
      if (hasNonCountableTag(active?.tags)) {
        visibleInTab.push({
          clientCardId: card.id, profileNickname: card.profileNickname, contactEmail: card.contactEmail,
          status: card.status, archived: card.archived, tags: activeTags,
        });
        continue;
      }
      const taggedHistoryEntry = history.find((h) => hasNonCountableTag(h.tags));
      if (taggedHistoryEntry) {
        hiddenFromTab.push({
          clientCardId: card.id, profileNickname: card.profileNickname, contactEmail: card.contactEmail,
          status: card.status, archived: card.archived,
          taggedRequestTags: taggedHistoryEntry.tags.split(',').filter(Boolean),
          taggedRequestCreatedAt: taggedHistoryEntry.createdAt,
        });
      }
    }

    return res.json({
      visibleCount: visibleInTab.length,
      hiddenCount: hiddenFromTab.length,
      visibleInTab,
      hiddenFromTab,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to run audit' });
  }
});

export default router;
