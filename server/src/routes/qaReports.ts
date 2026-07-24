// server/src/routes/qaReports.ts
import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';
import { sendTelegramMessage, CARESPACE_URL } from '../telegram';

const router = Router();
router.use(requireAuth);

const VALID_ISSUE_TYPES = ['technical', 'communication', 'no_response'];

// The "Reset / Clear all" button is scoped to this one account by business
// requirement, not to the head/lead role generally.
const QA_RESET_ALLOWED_EMAIL = 'victoria_pryts@struktura.io';

type QAComment = {
  id: string;
  type: 'comment' | 'status_change';
  authorId?: string;
  authorName?: string;
  authorRole?: string;
  status?: string;
  text: string;
  createdAt: string;
};

function parseComments(raw: string): QAComment[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function formatAgentReport(ar: { comments: string; [key: string]: unknown }) {
  return { ...ar, comments: parseComments(ar.comments) };
}

function formatIssue(issue: { comments: string; [key: string]: unknown }) {
  return { ...issue, comments: parseComments(issue.comments) };
}

function monthLabelFor(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Rebuilds the InboxMessage metadata/subject from the current DB state and
// marks it unread — used by every mutating action so the agent's Inbox and
// Victoria's QA Reports tab both reflect one living report thread instead of
// piling up separate notification messages.
async function refreshInboxMessage(reportId: string, agentId: string) {
  const [report, agentReport] = await Promise.all([
    prisma.qAReport.findUnique({ where: { id: reportId } }),
    prisma.qAAgentReport.findUnique({
      where: { reportId_agentId: { reportId, agentId } },
      include: { agent: { select: { name: true } } },
    }),
  ]);
  if (!report || !agentReport || !agentReport.inboxMessageId) return;

  const issues = await prisma.qAIssue.findMany({ where: { reportId, agentId }, orderBy: { createdAt: 'asc' } });
  const agentName = agentReport.agent?.name ?? 'Unknown';
  const monthLabel = monthLabelFor(report.year, report.month);

  const subject = agentReport.status === 'returned'
    ? `QA Report (Returned) — ${monthLabel}`
    : agentReport.status === 'resent'
    ? `QA Report (Updated) — ${monthLabel}`
    : `QA Report — ${monthLabel}`;

  const metadata = JSON.stringify({
    year: report.year, month: report.month, agentId, reportId: report.id, status: agentReport.status,
    agentName, totalChats: agentReport.totalChats, note: agentReport.note,
    issues: issues.map((i) => ({
      id: i.id, chatRef: i.chatRef, issueType: i.issueType, notes: i.notes,
      comments: parseComments(i.comments),
    })),
    timeline: parseComments(agentReport.comments),
  });

  await prisma.inboxMessage.update({
    where: { id: agentReport.inboxMessageId },
    data: { subject, metadata, read: false, deletedByReceiver: false },
  });
}

// Notifies whoever needs to act next when an agent returns their report for
// re-review — the reviewer who last sent it, or all head/lead as a fallback
// if that link is missing.
async function notifyReturnedForReview(agentReport: { sentByUserId: string | null }, agentName: string) {
  let recipients: { telegramChatId: string | null }[] = [];
  if (agentReport.sentByUserId) {
    const reviewer = await prisma.user.findUnique({ where: { id: agentReport.sentByUserId } });
    if (reviewer) recipients = [reviewer];
  }
  if (recipients.length === 0) {
    recipients = await prisma.user.findMany({ where: { role: { in: ['head', 'lead'] } } });
  }

  const text = `${agentName} returned their QA report for re-review. ${CARESPACE_URL}`;
  await Promise.allSettled(
    recipients
      .filter((r): r is { telegramChatId: string } => !!r.telegramChatId)
      .map((r) => sendTelegramMessage(r.telegramChatId, text)),
  );
}

// GET /api/qa-reports/agent-reports?year=&month=
router.get('/agent-reports', async (req: Request, res: Response) => {
  try {
    const y = Number(req.query.year);
    const m = Number(req.query.month);
    if (!y || !m) return res.status(400).json({ error: 'year and month are required' });

    const report = await prisma.qAReport.findUnique({
      where: { year_month: { year: y, month: m } },
    });
    if (!report) return res.json([]);

    const agentReports = await prisma.qAAgentReport.findMany({
      where: { reportId: report.id },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return res.json(agentReports.map(formatAgentReport));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch agent reports' });
  }
});

// PATCH /api/qa-reports/agent-reports — save draft note and/or per-agent total chats
router.patch('/agent-reports', async (req: Request, res: Response) => {
  try {
    const { year, month, agentId, note, totalChats } = req.body as {
      year?: number; month?: number; agentId?: string; note?: string; totalChats?: number | null;
    };
    const y = Number(year), m = Number(month);
    if (!y || !m || !agentId) {
      return res.status(400).json({ error: 'year, month, and agentId are required' });
    }

    const report = await prisma.qAReport.upsert({
      where: { year_month: { year: y, month: m } },
      create: { year: y, month: m },
      update: {},
    });

    const hasTotalChats = totalChats !== undefined;

    const agentReport = await prisma.qAAgentReport.upsert({
      where: { reportId_agentId: { reportId: report.id, agentId } },
      create: {
        reportId: report.id,
        agentId,
        note: note?.trim() || null,
        status: 'draft',
        totalChats: hasTotalChats ? totalChats : null,
      },
      update: {
        ...(note !== undefined ? { note: note?.trim() || null } : {}),
        ...(hasTotalChats ? { totalChats } : {}),
      },
      include: { agent: { select: { id: true, name: true } } },
    });
    return res.json(formatAgentReport(agentReport));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to save draft' });
  }
});

// POST /api/qa-reports/agent-reports/send — deliver (or re-deliver) report to agent's inbox
router.post('/agent-reports/send', async (req: Request, res: Response) => {
  try {
    const senderId = (req.user as Express.User).id;
    const { year, month, agentId, note, totalChats } = req.body as {
      year?: number; month?: number; agentId?: string; note?: string; totalChats?: number | null;
    };
    const y = Number(year), m = Number(month);
    if (!y || !m || !agentId) {
      return res.status(400).json({ error: 'year, month, and agentId are required' });
    }

    const agentUser = await prisma.user.findFirst({ where: { agentId } });
    if (!agentUser) {
      return res.status(400).json({
        error: 'This agent has no linked user account and cannot receive inbox messages.',
      });
    }

    const report = await prisma.qAReport.upsert({
      where: { year_month: { year: y, month: m } },
      create: { year: y, month: m },
      update: {},
    });

    const agentRecord = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { name: true },
    });
    const agentName = agentRecord?.name ?? 'Unknown';

    const existingAgentReport = await prisma.qAAgentReport.findUnique({
      where: { reportId_agentId: { reportId: report.id, agentId } },
    });
    const effectiveTotalChats = totalChats !== undefined
      ? totalChats
      : existingAgentReport?.totalChats ?? null;

    const isResend = !!existingAgentReport
      && ['sent', 'returned', 'resent'].includes(existingAgentReport.status);
    const newStatus = isResend ? 'resent' : 'sent';

    const timeline = parseComments(existingAgentReport?.comments ?? '[]');
    timeline.push({
      id: randomUUID(), type: 'status_change', status: newStatus,
      text: isResend ? 'Report revised and resent' : 'Report sent',
      createdAt: new Date().toISOString(),
    });

    const monthLabel = monthLabelFor(y, m);
    const subject = isResend ? `QA Report (Updated) — ${monthLabel}` : `QA Report — ${monthLabel}`;
    const content = `${subject}\nAgent: ${agentName}`;

    const issues = await prisma.qAIssue.findMany({
      where: { reportId: report.id, agentId },
      orderBy: { createdAt: 'asc' },
    });

    const metadata = JSON.stringify({
      year: y, month: m, agentId, reportId: report.id, status: newStatus,
      agentName, totalChats: effectiveTotalChats, note: note?.trim() || null,
      issues: issues.map((i) => ({
        id: i.id, chatRef: i.chatRef, issueType: i.issueType, notes: i.notes,
        comments: parseComments(i.comments),
      })),
      timeline,
    });

    let messageId: string;
    if (existingAgentReport?.inboxMessageId) {
      // Update the same inbox message in place — resending shouldn't create a duplicate
      const updatedMessage = await prisma.inboxMessage.update({
        where: { id: existingAgentReport.inboxMessageId },
        data: { subject, content, metadata, read: false, deletedByReceiver: false },
      });
      messageId = updatedMessage.id;
    } else {
      const created = await prisma.inboxMessage.create({
        data: { senderId, receiverId: agentUser.id, type: 'qa_report', subject, content, metadata },
      });
      messageId = created.id;
    }

    const agentReport = await prisma.qAAgentReport.upsert({
      where: { reportId_agentId: { reportId: report.id, agentId } },
      create: {
        reportId: report.id, agentId,
        note: note?.trim() || null, status: newStatus, sentAt: new Date(),
        totalChats: effectiveTotalChats, sentByUserId: senderId, inboxMessageId: messageId,
        comments: JSON.stringify(timeline),
      },
      update: {
        note: note?.trim() || null, status: newStatus, sentAt: new Date(),
        totalChats: effectiveTotalChats, sentByUserId: senderId, inboxMessageId: messageId,
        comments: JSON.stringify(timeline),
      },
      include: { agent: { select: { id: true, name: true } } },
    });

    if (agentUser.telegramChatId) {
      const senderName = (req.user as Express.User).name;
      const text = isResend
        ? `${senderName} updated your QA report for ${monthLabel}. ${CARESPACE_URL}`
        : `${senderName} sent you a new QA report for ${monthLabel}. ${CARESPACE_URL}`;
      await sendTelegramMessage(agentUser.telegramChatId, text);
    }

    return res.status(201).json({ agentReport: formatAgentReport(agentReport), messageId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to send report' });
  }
});

// POST /api/qa-reports/agent-reports/comment — report-level (not tied to one issue)
// comment, optionally also returning the report for re-review
router.post('/agent-reports/comment', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const { year, month, agentId, text, action } = req.body as {
      year?: number; month?: number; agentId?: string; text?: string; action?: 'comment' | 'return';
    };
    const y = Number(year), m = Number(month);
    if (!y || !m || !agentId || !text?.trim()) {
      return res.status(400).json({ error: 'year, month, agentId, and text are required' });
    }

    const isAdmin = user.role === 'head' || user.role === 'lead';
    const isOwningAgent = user.agentId === agentId;
    if (!isAdmin && !isOwningAgent) return res.status(403).json({ error: 'Not permitted' });

    const wantsReturn = action === 'return';
    if (wantsReturn && !isOwningAgent) {
      return res.status(403).json({ error: 'Only the report owner can return it for re-review' });
    }

    const report = await prisma.qAReport.findUnique({ where: { year_month: { year: y, month: m } } });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const agentReport = await prisma.qAAgentReport.findUnique({
      where: { reportId_agentId: { reportId: report.id, agentId } },
    });
    if (!agentReport) return res.status(404).json({ error: 'Agent report not found' });

    const comments = parseComments(agentReport.comments);
    comments.push({
      id: randomUUID(), type: 'comment',
      authorId: user.id, authorName: user.name, authorRole: user.role,
      text: text.trim(), createdAt: new Date().toISOString(),
    });
    if (wantsReturn) {
      comments.push({
        id: randomUUID(), type: 'status_change', status: 'returned',
        text: 'Returned for re-review', createdAt: new Date().toISOString(),
      });
    }

    await prisma.qAAgentReport.update({
      where: { id: agentReport.id },
      data: { comments: JSON.stringify(comments), ...(wantsReturn ? { status: 'returned' } : {}) },
    });

    await refreshInboxMessage(report.id, agentId);

    if (wantsReturn) {
      await notifyReturnedForReview(agentReport, user.name);
    }

    const updated = await prisma.qAAgentReport.findUnique({
      where: { id: agentReport.id },
      include: { agent: { select: { id: true, name: true } } },
    });

    return res.json(formatAgentReport(updated!));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add comment' });
  }
});

// POST /api/qa-reports/issues/:id/comment — comment on one specific issue,
// optionally also returning the whole report for re-review
router.post('/issues/:id/comment', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const { text, action } = req.body as { text?: string; action?: 'comment' | 'return' };
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

    const issue = await prisma.qAIssue.findUnique({ where: { id: req.params.id }, include: { report: true } });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const isAdmin = user.role === 'head' || user.role === 'lead';
    const isOwningAgent = user.agentId === issue.agentId;
    if (!isAdmin && !isOwningAgent) return res.status(403).json({ error: 'Not permitted' });

    const wantsReturn = action === 'return';
    if (wantsReturn && !isOwningAgent) {
      return res.status(403).json({ error: 'Only the report owner can return it for re-review' });
    }

    const issueComments = parseComments(issue.comments);
    issueComments.push({
      id: randomUUID(), type: 'comment',
      authorId: user.id, authorName: user.name, authorRole: user.role,
      text: text.trim(), createdAt: new Date().toISOString(),
    });

    const updatedIssue = await prisma.qAIssue.update({
      where: { id: issue.id },
      data: { comments: JSON.stringify(issueComments) },
      include: { agent: { select: { id: true, name: true } } },
    });

    const agentReport = await prisma.qAAgentReport.findUnique({
      where: { reportId_agentId: { reportId: issue.reportId, agentId: issue.agentId } },
    });

    if (agentReport) {
      const reportComments = parseComments(agentReport.comments);
      if (wantsReturn) {
        reportComments.push({
          id: randomUUID(), type: 'status_change', status: 'returned',
          text: `Returned for re-review (issue: ${issue.chatRef.slice(0, 60)})`,
          createdAt: new Date().toISOString(),
        });
      }
      await prisma.qAAgentReport.update({
        where: { id: agentReport.id },
        data: {
          comments: JSON.stringify(reportComments),
          ...(wantsReturn ? { status: 'returned' } : {}),
        },
      });
      await refreshInboxMessage(issue.reportId, issue.agentId);

      if (wantsReturn) {
        await notifyReturnedForReview(agentReport, user.name);
      }
    }

    return res.json(formatIssue(updatedIssue));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add issue comment' });
  }
});

// PUT /api/qa-reports/issues/:id — must be before /:param routes
router.put('/issues/:id', async (req: Request, res: Response) => {
  try {
    const { chatRef, issueType, notes, agentId } = req.body as {
      chatRef?: string;
      issueType?: string;
      notes?: string;
      agentId?: string;
    };

    if (!chatRef?.trim() || !issueType || !agentId) {
      return res.status(400).json({ error: 'chatRef, issueType, and agentId are required' });
    }
    if (!VALID_ISSUE_TYPES.includes(issueType)) {
      return res.status(400).json({ error: 'Invalid issueType' });
    }

    const issue = await prisma.qAIssue.update({
      where: { id: req.params.id },
      data: { chatRef: chatRef.trim(), issueType, notes: notes?.trim() || null, agentId },
      include: { agent: { select: { id: true, name: true } } },
    });

    return res.json(formatIssue(issue));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update issue' });
  }
});

// DELETE /api/qa-reports/issues/:id
router.delete('/issues/:id', async (req: Request, res: Response) => {
  try {
    await prisma.qAIssue.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete issue' });
  }
});

// POST /api/qa-reports/issues — upserts parent report, then adds issue
router.post('/issues', async (req: Request, res: Response) => {
  try {
    const { year, month, chatRef, issueType, notes, agentId } = req.body as {
      year?: number;
      month?: number;
      chatRef?: string;
      issueType?: string;
      notes?: string;
      agentId?: string;
    };

    const y = Number(year), m = Number(month);
    if (!y || !m || !chatRef?.trim() || !issueType || !agentId) {
      return res.status(400).json({ error: 'year, month, chatRef, issueType, and agentId are required' });
    }
    if (!VALID_ISSUE_TYPES.includes(issueType)) {
      return res.status(400).json({ error: 'Invalid issueType' });
    }

    const report = await prisma.qAReport.upsert({
      where: { year_month: { year: y, month: m } },
      create: { year: y, month: m },
      update: {},
    });

    const issue = await prisma.qAIssue.create({
      data: {
        reportId: report.id,
        agentId,
        chatRef: chatRef.trim(),
        issueType,
        notes: notes?.trim() || null,
      },
      include: { agent: { select: { id: true, name: true } } },
    });

    return res.status(201).json(formatIssue(issue));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create issue' });
  }
});

// DELETE /api/qa-reports/reset-all — permanently wipes every QA report, which
// cascades to delete every QAIssue and QAAgentReport (see schema onDelete: Cascade).
router.delete('/reset-all', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    if (user.email !== QA_RESET_ALLOWED_EMAIL) {
      return res.status(403).json({ error: 'Not permitted' });
    }
    await prisma.qAReport.deleteMany({});
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reset QA reports' });
  }
});

// GET /api/qa-reports?year=2025&month=6
router.get('/', async (req: Request, res: Response) => {
  try {
    const y = Number(req.query.year);
    const m = Number(req.query.month);

    if (!y || !m) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    const report = await prisma.qAReport.findUnique({
      where: { year_month: { year: y, month: m } },
      include: {
        issues: {
          include: { agent: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!report) {
      return res.json({ id: null, year: y, month: m, totalChats: null, issues: [] });
    }

    return res.json({ ...report, issues: report.issues.map(formatIssue) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch QA report' });
  }
});

// PATCH /api/qa-reports?year=2025&month=6 — update total chats (upserts)
router.patch('/', async (req: Request, res: Response) => {
  try {
    const y = Number(req.query.year);
    const m = Number(req.query.month);
    const { totalChats } = req.body as { totalChats: number | null };

    if (!y || !m) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    const report = await prisma.qAReport.upsert({
      where: { year_month: { year: y, month: m } },
      create: { year: y, month: m, totalChats: totalChats ?? null },
      update: { totalChats: totalChats ?? null },
      include: {
        issues: {
          include: { agent: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return res.json({ ...report, issues: report.issues.map(formatIssue) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update QA report' });
  }
});

export default router;
