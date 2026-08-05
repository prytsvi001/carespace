// server/src/routes/salary.ts
// Monthly pay calculation for the Support Team and Peekviewer Team, visible
// to head (Sandra Moore) and lead (Victoria Davis). Auto-pulls hours
// (Statistics), reviews (Reviews tab), and Julia's resolved Peek Requests
// count; everything is overridable and persisted per person per month in
// SalaryRecord.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { computeMonthlyAgentStats, HoursBreakdown } from '../statsHelpers';
import { sendTelegramMessage } from '../telegram';
import {
  SalaryPerson, ToggleKey, rosterForTeam, reviewsBonusForCount, notifyUserNameFor,
} from '../salaryConfig';

const router = Router();

function isAdmin(role: string): boolean {
  return role === 'head' || role === 'lead';
}

function safeParseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface BonusEntry { id: string; description: string; amount: number; }

interface SalaryOverrides {
  base?: number;
  hours?: number;
  rate?: number;
  reviewsCount?: number;
  reviewsBonus?: number;
  peekCount?: number;
  peekBonus?: number;
  resolvedCount?: number;
  supportDutiesBonus?: number;
  trustpilotOn?: boolean;
  updateOn?: boolean;
  uMobixOn?: boolean;
  strukturaOn?: boolean;
  smmDutyOn?: boolean;
  total?: number;
}

function computeSalary(
  person: SalaryPerson,
  autoHours: number,
  autoShifts: number,
  autoReviewsCount: number,
  autoPeekCount: number,
  autoResolvedCount: number,
  overrides: SalaryOverrides,
  bonuses: BonusEntry[],
) {
  const hours = overrides.hours ?? autoHours;
  const hasSupportDuties = person.formula.type === 'fixed_base_with_support_duties';

  let rate: number | null = null;
  if (person.formula.type === 'hourly_tiered_reviews') rate = overrides.rate ?? person.formula.rate;
  else if (hasSupportDuties) rate = overrides.rate ?? null;

  // Base is a flat, independently-editable number for fixed_base and
  // fixed_base_with_support_duties people (Sandra's base doesn't derive from
  // hours at all); only hourly_tiered_reviews computes it from hours * rate.
  let computedBase = 0;
  if (person.formula.type === 'fixed_base') computedBase = person.fixedBase ?? 0;
  else if (person.formula.type === 'hourly_tiered_reviews' && rate != null) computedBase = round2(hours * rate);
  const base = overrides.base ?? computedBase;

  const hasReviews = person.formula.type === 'hourly_tiered_reviews';
  const reviewsCount = hasReviews ? (overrides.reviewsCount ?? autoReviewsCount) : 0;
  const reviewsBonus = hasReviews ? (overrides.reviewsBonus ?? reviewsBonusForCount(reviewsCount)) : 0;

  const peekCount = person.hasPeekBonus ? (overrides.peekCount ?? autoPeekCount) : 0;
  const peekBonus = person.hasPeekBonus ? round2(overrides.peekBonus ?? peekCount * 0.80) : 0;

  // Reference-only — how many Peek Requests this person personally resolved
  // that month. No bonus math: their existing Update bonus toggle already
  // covers that, this is just context for the admin.
  const resolvedCount = person.hasResolvedRequestCount ? (overrides.resolvedCount ?? autoResolvedCount) : undefined;

  const supportDutiesBonus = hasSupportDuties
    ? (overrides.supportDutiesBonus ?? (rate != null ? round2(hours * rate) : 0))
    : 0;

  let toggleAmount = 0;
  const toggleStates: Record<string, boolean> = {};
  for (const toggle of person.toggles ?? []) {
    const on = !!(overrides as Record<ToggleKey, boolean | undefined>)[toggle.key];
    toggleStates[toggle.key] = on;
    if (on) toggleAmount += toggle.amount;
  }

  const bonusesTotal = round2(bonuses.reduce((s, b) => s + (Number(b.amount) || 0), 0));

  const total = overrides.total ?? round2(base + reviewsBonus + peekBonus + supportDutiesBonus + toggleAmount + bonusesTotal);

  const editedFields = Object.keys(overrides);

  return {
    personKey: person.personKey,
    displayName: person.displayName,
    team: person.team,
    hours, rate, base,
    hasReviews, reviewsCount, reviewsBonus,
    hasPeekBonus: !!person.hasPeekBonus, peekCount: person.hasPeekBonus ? peekCount : undefined, peekBonus,
    hasResolvedRequestCount: !!person.hasResolvedRequestCount, resolvedCount,
    hasSupportDuties, supportDutiesBonus,
    shifts: autoShifts,
    toggles: (person.toggles ?? []).map(t => ({ key: t.key, label: t.label, amount: t.amount, on: toggleStates[t.key] })),
    bonuses, bonusesTotal,
    total,
    editedFields,
  };
}

// GET /api/salary?year=&month=&team=support|peekviewer
router.get('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me.role)) return res.status(403).json({ error: 'Not allowed' });

    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const team = req.query.team === 'peekviewer' ? 'peekviewer' : 'support';
    if (!year || !month) return res.status(400).json({ error: 'year and month are required' });

    const roster = rosterForTeam(team);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));

    const hoursByAgentName: Record<string, { hours: number; shifts: number; agentId: string; breakdown: HoursBreakdown }> = {};
    const reviewsByAgentName: Record<string, number> = {};
    let juliaPeekDoneCount = 0;

    if (team === 'support') {
      const stats = await computeMonthlyAgentStats(year, month);
      for (const s of stats) hoursByAgentName[s.agentName] = { hours: s.totalHours, shifts: s.totalShifts, agentId: s.agentId, breakdown: s.breakdown };

      const agentNames = roster.map(p => p.agentName).filter(Boolean) as string[];
      const users = await prisma.user.findMany({ where: { name: { in: agentNames } } });

      const reviewCounts = await Promise.all(
        users.map(u => prisma.clientReview.count({
          where: { userId: u.id, archived: false, submittedAt: { gte: start, lt: end } },
        }))
      );
      users.forEach((u, i) => { reviewsByAgentName[u.name] = reviewCounts[i]; });

      const julia = roster.find(p => p.hasPeekBonus);
      const juliaAgentId = julia?.agentName ? hoursByAgentName[julia.agentName]?.agentId : undefined;
      if (juliaAgentId) {
        juliaPeekDoneCount = await prisma.peakRequest.count({
          where: { agentId: juliaAgentId, status: 'DONE', doneAt: { gte: start, lt: end } },
        });
      }
    }

    const stored = await prisma.salaryRecord.findMany({
      where: { personKey: { in: roster.map(p => p.personKey) }, year, month },
    });
    const storedByKey = new Map(stored.map(r => [r.personKey, r]));

    // Who can actually receive a notification — any roster person (either
    // team) whose notifyUserNameFor() name resolves to a real User row.
    const notifyNames = roster.map(p => notifyUserNameFor(p)).filter(Boolean) as string[];
    const notifyUsers = notifyNames.length
      ? await prisma.user.findMany({ where: { name: { in: notifyNames } } })
      : [];
    const notifyableNames = new Set(notifyUsers.map(u => u.name));
    const notifyUserByName = new Map(notifyUsers.map(u => [u.name, u]));

    // Reference-only count of Peek Requests personally resolved that month
    // (PeekResolutionCredit.creditedUserId) — Viktoria Horopeka / Iryna
    // Kolodiyenko only, no bonus math attached.
    const resolvedCountByPersonKey: Record<string, number> = {};
    const resolvedPeople = roster.filter(p => p.hasResolvedRequestCount);
    if (resolvedPeople.length) {
      await Promise.all(resolvedPeople.map(async p => {
        const notifyName = notifyUserNameFor(p);
        const user = notifyName ? notifyUserByName.get(notifyName) : undefined;
        if (!user) return;
        resolvedCountByPersonKey[p.personKey] = await prisma.peekResolutionCredit.count({
          where: { creditedUserId: user.id, resolvedDate: { gte: start, lt: end } },
        });
      }));
    }

    const rows = roster.map(person => {
      const record = storedByKey.get(person.personKey);
      const overrides = safeParseJSON<SalaryOverrides>(record?.overrides, {});
      const bonuses = safeParseJSON<BonusEntry[]>(record?.bonuses, []);

      const autoHours = person.agentName ? (hoursByAgentName[person.agentName]?.hours ?? 0) : 0;
      const autoShifts = person.agentName ? (hoursByAgentName[person.agentName]?.shifts ?? 0) : 0;
      const autoReviewsCount = person.agentName ? (reviewsByAgentName[person.agentName] ?? 0) : 0;
      const autoPeekCount = person.hasPeekBonus ? juliaPeekDoneCount : 0;
      const autoResolvedCount = person.hasResolvedRequestCount ? (resolvedCountByPersonKey[person.personKey] ?? 0) : 0;

      const notifyName = notifyUserNameFor(person);
      const hoursBreakdown = person.agentName ? hoursByAgentName[person.agentName]?.breakdown : undefined;

      return {
        ...computeSalary(person, autoHours, autoShifts, autoReviewsCount, autoPeekCount, autoResolvedCount, overrides, bonuses),
        canNotify: !!notifyName && notifyableNames.has(notifyName),
        notifiedAt: record?.notifiedAt ? record.notifiedAt.toISOString() : null,
        hoursBreakdown,
      };
    });

    res.json({ year, month, team, rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch salary data' });
  }
});

// PATCH /api/salary/:personKey  { year, month, team, overrides?, bonuses? }
// overrides: keys set to null/undefined clear that override back to auto-calculated.
// bonuses, if present, replaces the full bonus list (frontend owns the list client-side).
router.patch('/:personKey', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me.role)) return res.status(403).json({ error: 'Not allowed' });

    const { personKey } = req.params;
    const { year, month, team, overrides, bonuses } = req.body as {
      year: number; month: number; team: 'support' | 'peekviewer';
      overrides?: Record<string, unknown>; bonuses?: BonusEntry[];
    };
    if (!year || !month || !team) return res.status(400).json({ error: 'year, month and team are required' });

    const roster = rosterForTeam(team);
    if (!roster.some(p => p.personKey === personKey)) {
      return res.status(400).json({ error: 'Unknown personKey for this team' });
    }

    const existing = await prisma.salaryRecord.findUnique({
      where: { personKey_year_month: { personKey, year, month } },
    });

    const mergedOverrides = safeParseJSON<Record<string, unknown>>(existing?.overrides, {});
    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        if (v === null || v === undefined) delete mergedOverrides[k];
        else mergedOverrides[k] = v;
      }
    }

    const nextBonuses = bonuses ?? safeParseJSON<BonusEntry[]>(existing?.bonuses, []);

    const record = await prisma.salaryRecord.upsert({
      where: { personKey_year_month: { personKey, year, month } },
      update: { team, overrides: JSON.stringify(mergedOverrides), bonuses: JSON.stringify(nextBonuses) },
      create: { personKey, team, year, month, overrides: JSON.stringify(mergedOverrides), bonuses: JSON.stringify(nextBonuses) },
    });

    res.json(record);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save salary override' });
  }
});

function monthLabelFor(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// POST /api/salary/:personKey/notify  { year, month, team, message }
// Sends the exact given message via Telegram (if linked) and creates/updates
// an InboxMessage of type "salary_message" — resending updates the same
// message in place instead of creating a duplicate.
router.post('/:personKey/notify', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me.role)) return res.status(403).json({ error: 'Not allowed' });

    const { personKey } = req.params;
    const { year, month, team, message } = req.body as {
      year: number; month: number; team: 'support' | 'peekviewer'; message?: string;
    };
    if (!year || !month || !team) return res.status(400).json({ error: 'year, month and team are required' });
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    const roster = rosterForTeam(team);
    const person = roster.find(p => p.personKey === personKey);
    if (!person) return res.status(400).json({ error: 'Unknown personKey for this team' });

    const notifyName = notifyUserNameFor(person);
    const targetUser = notifyName ? await prisma.user.findFirst({ where: { name: notifyName } }) : null;
    if (!targetUser) {
      return res.status(400).json({ error: "This person has no linked account and can't receive a notification." });
    }

    const existing = await prisma.salaryRecord.findUnique({
      where: { personKey_year_month: { personKey, year, month } },
    });

    const subject = `Salary — ${monthLabelFor(year, month)}`;
    const content = message.trim();

    let messageId: string;
    if (existing?.notifiedMessageId) {
      const updated = await prisma.inboxMessage.update({
        where: { id: existing.notifiedMessageId },
        data: { subject, content, read: false, deletedByReceiver: false },
      });
      messageId = updated.id;
    } else {
      const created = await prisma.inboxMessage.create({
        data: { senderId: me.id, receiverId: targetUser.id, type: 'salary_message', subject, content },
      });
      messageId = created.id;
    }

    if (targetUser.telegramChatId) {
      await sendTelegramMessage(targetUser.telegramChatId, content);
    }

    const notifiedAt = new Date();
    await prisma.salaryRecord.upsert({
      where: { personKey_year_month: { personKey, year, month } },
      update: { notifiedAt, notifiedMessageId: messageId },
      create: {
        personKey, team, year, month,
        overrides: existing?.overrides ?? '{}', bonuses: existing?.bonuses ?? '[]',
        notifiedAt, notifiedMessageId: messageId,
      },
    });

    res.json({ notifiedAt: notifiedAt.toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send salary notification' });
  }
});

export default router;
