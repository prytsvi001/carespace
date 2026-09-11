// server/src/routes/kpi.ts
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import prisma from '../prisma';

const router = Router();
router.use(requireAuth);

// Peekviewer's KPI content is unrelated to Support's (no chat/ticket response
// times, review bonus tiers, or QA score thresholds) — it starts empty and is
// built entirely from custom blocks by whoever has peekviewerAdmin rights.
const DEFAULT_PEEKVIEWER_KPI = {
  customBlocks: [] as {
    id: string;
    title: string;
    section: string;
    content: string;
    createdBy: string;
    createdAt: string;
  }[],
  deletedBuiltins: [] as string[],
};

function kpiIdForTeam(team: unknown): string {
  return team === 'peekviewer' ? 'peekviewer' : 'global';
}

function defaultKpiForTeam(team: unknown): typeof DEFAULT_KPI {
  return team === 'peekviewer' ? (DEFAULT_PEEKVIEWER_KPI as unknown as typeof DEFAULT_KPI) : DEFAULT_KPI;
}

const DEFAULT_KPI = {
  chatResponseTimes: [
    { channel: 'Chats (Tech support)', firstResponse: 'up to 20 sec', replyTime: '20 sec – 15 min' },
  ] as { channel: string; firstResponse: string; replyTime: string }[],
  ticketResponseTimes: [
    { channel: 'Tickets', firstResponse: 'up to 20 min', replyTime: 'up to 3 hours' },
  ] as { channel: string; firstResponse: string; replyTime: string }[],
  callResponseTimes: [] as { channel: string; firstResponse: string; replyTime: string }[],
  chatPriorities: [
    'Failure Payments',
    'Refund chats',
    'Installation chats (new clients)',
    'Usual chats (existing clients)',
  ] as string[],
  ticketPriorities: [] as string[],
  callPriorities: [] as string[],
  reviewsKpi: {
    rules: [
      'Minimum per month: 10 reviews, of which at least 3–5 on Trustpilot',
      'Deadline: check all sites by the 30th of each month',
      'Each review must contain: code word/phrase, agent name, or other identifier',
    ] as string[],
    bonusTable: [
      { range: '1–10', bonus: '$5' },
      { range: '11–20', bonus: '$6' },
      { range: '21+', bonus: '$7' },
    ] as { range: string; bonus: string }[],
  },
  qaScore: {
    thresholds: [
      { result: 'Good', score: '98–100%' },
      { result: 'Average', score: '96–98%' },
      { result: 'Poor', score: 'below 96%' },
    ] as { result: string; score: string }[],
    communicationErrors: [] as string[],
    technicalErrors: [] as string[],
  },
  customBlocks: [] as {
    id: string;
    title: string;
    section: string;
    content: string;
    createdBy: string;
    createdAt: string;
  }[],
  deletedBuiltins: [] as string[],
};

// Migrate data saved before the per-section split (old format had a flat responseTimes[]).
// Peekviewer's KPI has no built-in sections at all (see DEFAULT_PEEKVIEWER_KPI) — running
// Support's migration on it would inject Support's built-in defaults (chat/ticket response
// times, review tiers, QA thresholds), so it only ever needs the two shared array fields.
function migrateKpiData(raw: any, team?: unknown): any {
  const data = { ...raw };

  if (team === 'peekviewer') {
    if (!data.customBlocks)    data.customBlocks    = [];
    if (!data.deletedBuiltins) data.deletedBuiltins = [];
    return data;
  }

  if (data.responseTimes && !data.chatResponseTimes) {
    const rows: { channel: string; firstResponse: string; replyTime: string }[] = data.responseTimes;
    data.chatResponseTimes   = rows.filter(r => /chat|tech/i.test(r.channel));
    data.ticketResponseTimes = rows.filter(r => /ticket/i.test(r.channel));
    data.callResponseTimes   = rows.filter(r => /call/i.test(r.channel));
    // Anything that matched none of the above goes to chats (safest default)
    const matched = new Set([
      ...data.chatResponseTimes,
      ...data.ticketResponseTimes,
      ...data.callResponseTimes,
    ]);
    const unmatched = rows.filter(r => !matched.has(r));
    data.chatResponseTimes = [...data.chatResponseTimes, ...unmatched];
    delete data.responseTimes;
  }

  if (!data.chatResponseTimes)   data.chatResponseTimes   = DEFAULT_KPI.chatResponseTimes;
  if (!data.ticketResponseTimes) data.ticketResponseTimes = DEFAULT_KPI.ticketResponseTimes;
  if (!data.callResponseTimes)   data.callResponseTimes   = [];
  if (!data.ticketPriorities)    data.ticketPriorities    = [];
  if (!data.callPriorities)      data.callPriorities      = [];
  if (!data.customBlocks)        data.customBlocks        = [];
  if (!data.deletedBuiltins)     data.deletedBuiltins     = [];

  return data;
}

// A caller may only read/write a team's KPI if they actually belong to it
// (home or secondary team) — otherwise Support and Peekviewer agents could see
// each other's KPI reference card just by passing a different query param.
function belongsToTeam(user: Express.User, team: unknown): boolean {
  const t = team === 'peekviewer' ? 'peekviewer' : 'support';
  return user.team === t || user.secondaryTeam === t;
}

// GET /api/kpi?team=support|peekviewer — returns that team's KPI settings
// (creates defaults on first access). team defaults to 'support' for back-compat.
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const team = req.query.team;
    if (!belongsToTeam(user, team)) return res.status(403).json({ error: 'Not permitted' });

    const id = kpiIdForTeam(team);
    const defaults = defaultKpiForTeam(team);

    let settings = await (prisma as any).kpiSettings.findUnique({ where: { id } });
    if (!settings) {
      settings = await (prisma as any).kpiSettings.create({
        data: { id, data: JSON.stringify(defaults) },
      });
    }
    const raw = settings.data && settings.data !== '{}' ? JSON.parse(settings.data) : defaults;
    res.json(migrateKpiData(raw, team));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch KPI settings' });
  }
});

// PUT /api/kpi?team=support|peekviewer — update that team's KPI settings
// (head/lead, or peekviewerAdmin for the Peekviewer team)
router.put('/', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const team = req.query.team;
    if (!belongsToTeam(user, team)) return res.status(403).json({ error: 'Not permitted' });
    const permitted = team === 'peekviewer'
      ? (['head', 'lead'].includes(user.role) || user.peekviewerAdmin)
      : ['head', 'lead'].includes(user.role);
    if (!permitted) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    const id = kpiIdForTeam(team);
    const settings = await (prisma as any).kpiSettings.upsert({
      where: { id },
      update: { data: JSON.stringify(req.body), updatedBy: user.id },
      create: { id, data: JSON.stringify(req.body), updatedBy: user.id },
    });

    return res.json(migrateKpiData(JSON.parse(settings.data), team));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update KPI settings' });
  }
});

export default router;
