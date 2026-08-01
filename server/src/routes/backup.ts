// server/src/routes/backup.ts
// Full-database JSON export, admin-only (head/lead). Personal Shortcuts are
// deliberately excluded — this app's one architectural privacy guarantee is
// that personal shortcuts are invisible even to head/lead, and a full-data
// backup must not become a backdoor around that.
import { Router, Request, Response } from 'express';
import prisma from '../prisma';

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

router.get('/', async (req: Request, res: Response) => {
  try {
    const me = req.user as Express.User;
    if (!isAdmin(me.role)) return res.status(403).json({ error: 'Not allowed' });

    const [
      users,
      agents,
      shiftLogs,
      calendarEvents,
      clientCards,
      aiChatQA,
      plans,
      pdpPlans,
      qaReports,
      reviews,
      shortcuts,
      shortcutTags,
      inboxMessages,
      updates,
    ] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: { name: 'asc' },
      }),
      prisma.agent.findMany({ orderBy: { name: 'asc' } }),
      prisma.shiftLog.findMany({
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { shiftDate: 'desc' },
      }),
      prisma.calendarEvent.findMany({
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { eventDate: 'desc' },
      }),
      prisma.clientCard.findMany({
        include: {
          requests: {
            include: { agent: { select: { id: true, name: true } } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.aIChatQA.findMany({ orderBy: { issueDate: 'desc' } }),
      prisma.plan.findMany({
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pdpPlan.findMany({
        include: {
          user: { select: { id: true, name: true } },
          goals: true,
          tasks: true,
          feedback: true,
        },
      }),
      prisma.qAReport.findMany({
        include: {
          issues: { include: { agent: { select: { id: true, name: true } } } },
          agentReports: { include: { agent: { select: { id: true, name: true } } } },
        },
      }),
      prisma.clientReview.findMany({ include: { user: { select: { id: true, name: true } } } }),
      prisma.shortcut.findMany({ include: { createdBy: { select: { id: true, name: true } } } }),
      prisma.shortcutTag.findMany(),
      prisma.inboxMessage.findMany({
        include: {
          sender: { select: { id: true, name: true } },
          receiver: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.update.findMany({
        include: {
          author: { select: { id: true, name: true } },
          reads: { include: { user: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const backup = {
      generatedAt: new Date().toISOString(),
      generatedBy: me.name,

      users,
      agents,

      dailyLog: shiftLogs,
      shiftCalendar: calendarEvents,

      peakRequests: clientCards.map((card) => ({
        id: card.id,
        contactEmail: card.contactEmail,
        profileNickname: card.profileNickname,
        status: card.status,
        starred: card.starred,
        archived: card.archived,
        lastCheckedByName: card.lastCheckedByName,
        lastCheckedAt: card.lastCheckedAt,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
        history: card.requests.map((r) => ({
          id: r.id,
          agent: r.agent,
          requestText: r.requestText,
          status: r.status,
          tags: r.tags, // plain comma-separated string, not JSON
          comments: safeParseJSON(r.comments, []),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      })),

      aiChatQA,
      myPlans: plans,

      pdp: pdpPlans.map((p) => ({
        ...p,
        tasks: p.tasks.map((t) => ({ ...t, comments: safeParseJSON(t.comments, []) })),
      })),

      qaReports: qaReports.map((r) => ({
        ...r,
        issues: r.issues.map((i) => ({ ...i, comments: safeParseJSON(i.comments, []) })),
        agentReports: r.agentReports.map((a) => ({ ...a, comments: safeParseJSON(a.comments, []) })),
      })),

      reviews,

      shortcuts: shortcuts.map((s) => ({ ...s, variants: safeParseJSON(s.variants, []) })),
      shortcutTags,

      inbox: inboxMessages.map((m) => ({ ...m, metadata: safeParseJSON(m.metadata, null) })),
      updates,
    };

    const filename = `carespace-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate backup' });
  }
});

export default router;
