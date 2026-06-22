// server/src/routes/kpi.ts
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import prisma from '../prisma';

const router = Router();
router.use(requireAuth);

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

// Migrate data saved before the per-section split (old format had a flat responseTimes[])
function migrateKpiData(raw: any): any {
  const data = { ...raw };

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

// GET /api/kpi — returns the global KPI settings (creates defaults on first access)
router.get('/', async (req: Request, res: Response) => {
  try {
    let settings = await (prisma as any).kpiSettings.findUnique({ where: { id: 'global' } });
    if (!settings) {
      settings = await (prisma as any).kpiSettings.create({
        data: { id: 'global', data: JSON.stringify(DEFAULT_KPI) },
      });
    }
    const raw = settings.data && settings.data !== '{}' ? JSON.parse(settings.data) : DEFAULT_KPI;
    res.json(migrateKpiData(raw));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch KPI settings' });
  }
});

// PUT /api/kpi — update global KPI settings (head/lead only)
router.put('/', async (req: Request, res: Response) => {
  try {
    const userRole = (req.user as Express.User).role;
    if (!['head', 'lead'].includes(userRole)) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    const userId = (req.user as Express.User).id;
    const settings = await (prisma as any).kpiSettings.upsert({
      where: { id: 'global' },
      update: { data: JSON.stringify(req.body), updatedBy: userId },
      create: { id: 'global', data: JSON.stringify(req.body), updatedBy: userId },
    });

    return res.json(migrateKpiData(JSON.parse(settings.data)));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update KPI settings' });
  }
});

export default router;
