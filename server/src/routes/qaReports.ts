// server/src/routes/qaReports.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const VALID_ISSUE_TYPES = ['technical', 'communication', 'no_response'];

type ReportComment = {
  authorId: string;
  authorName: string;
  authorRole: string;
  text: string;
  type: 'reply' | 'return_request';
  createdAt: string;
};

function parseComments(raw: string): ReportComment[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function formatAgentReport(ar: { comments: string; [key: string]: unknown }) {
  return { ...ar, comments: parseComments(ar.comments) };
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
    const senderName = (req.user as Express.User).name;
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
      include: {
        issues: {
          where: { agentId },
          orderBy: { createdAt: 'asc' },
        },
      },
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

    const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    const typeLabel = (t: string) =>
      t === 'technical' ? 'Technical problem'
      : t === 'communication' ? 'Communication problem'
      : 'No response';

    const issueLines = report.issues
      .map((i) => `• [${typeLabel(i.issueType)}] ${i.chatRef}${i.notes ? ` — ${i.notes}` : ''}`)
      .join('\n');

    const issueCount = report.issues.length;
    const problemRate = effectiveTotalChats ? (issueCount / effectiveTotalChats) * 100 : null;
    const successRate = problemRate !== null ? 100 - problemRate : null;

    const statsLines = [
      effectiveTotalChats != null ? `Total chats: ${effectiveTotalChats}` : null,
      `Issues logged: ${issueCount}`,
      problemRate !== null ? `Problem rate: ${problemRate.toFixed(1)}%` : null,
      successRate !== null ? `Success rate: ${successRate.toFixed(1)}%` : null,
    ].filter(Boolean).join('\n');

    const subject = isResend ? `QA Report (Updated) — ${monthLabel}` : `QA Report — ${monthLabel}`;

    const content = [
      subject,
      `Agent: ${agentName}`,
      statsLines,
      report.issues.length > 0 ? `\nIssues:\n${issueLines}` : '\nNo issues logged this month.',
      note?.trim() ? `\nNote from ${senderName}:\n${note.trim()}` : '',
    ].filter(Boolean).join('\n');

    const metadata = JSON.stringify({
      year: y, month: m, agentId, reportId: report.id, status: newStatus,
      agentName, totalChats: effectiveTotalChats, note: note?.trim() || null,
      issues: report.issues.map((i) => ({
        id: i.id, chatRef: i.chatRef, issueType: i.issueType, notes: i.notes,
      })),
    });

    let messageId: string;
    if (existingAgentReport?.inboxMessageId) {
      // Update the same inbox message in place — resending shouldn't create a duplicate
      const updatedMessage = await prisma.inboxMessage.update({
        where: { id: existingAgentReport.inboxMessageId },
        data: { subject, content, metadata, read: false },
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
      },
      update: {
        note: note?.trim() || null, status: newStatus, sentAt: new Date(),
        totalChats: effectiveTotalChats, sentByUserId: senderId, inboxMessageId: messageId,
      },
      include: { agent: { select: { id: true, name: true } } },
    });

    return res.status(201).json({ agentReport: formatAgentReport(agentReport), messageId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to send report' });
  }
});

// POST /api/qa-reports/agent-reports/reply — add a comment/question, no status change
router.post('/agent-reports/reply', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const { year, month, agentId, text } = req.body as {
      year?: number; month?: number; agentId?: string; text?: string;
    };
    const y = Number(year), m = Number(month);
    if (!y || !m || !agentId || !text?.trim()) {
      return res.status(400).json({ error: 'year, month, agentId, and text are required' });
    }

    const isAdmin = user.role === 'head' || user.role === 'lead';
    const isOwningAgent = user.agentId === agentId;
    if (!isAdmin && !isOwningAgent) {
      return res.status(403).json({ error: 'Not permitted' });
    }

    const report = await prisma.qAReport.findUnique({ where: { year_month: { year: y, month: m } } });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const agentReport = await prisma.qAAgentReport.findUnique({
      where: { reportId_agentId: { reportId: report.id, agentId } },
    });
    if (!agentReport) return res.status(404).json({ error: 'Agent report not found' });

    const comments = parseComments(agentReport.comments);
    comments.push({
      authorId: user.id, authorName: user.name, authorRole: user.role,
      text: text.trim(), type: 'reply', createdAt: new Date().toISOString(),
    });

    const updated = await prisma.qAAgentReport.update({
      where: { id: agentReport.id },
      data: { comments: JSON.stringify(comments) },
      include: { agent: { select: { id: true, name: true } } },
    });

    const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const metadata = JSON.stringify({ year: y, month: m, agentId, reportId: report.id, status: updated.status });

    const notifyReceiverId = isOwningAgent
      ? agentReport.sentByUserId
      : (await prisma.user.findFirst({ where: { agentId } }))?.id;

    if (notifyReceiverId) {
      await prisma.inboxMessage.create({
        data: {
          senderId: user.id,
          receiverId: notifyReceiverId,
          type: 'qa_report',
          subject: `Reply on QA Report — ${monthLabel}`,
          content: isOwningAgent
            ? `${user.name} replied on the ${monthLabel} QA report:\n\n${text.trim()}`
            : `${user.name} replied on your ${monthLabel} QA report:\n\n${text.trim()}`,
          metadata,
        },
      });
    }

    return res.json(formatAgentReport(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add reply' });
  }
});

// POST /api/qa-reports/agent-reports/return — agent returns the report for re-review
router.post('/agent-reports/return', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const { year, month, agentId, text } = req.body as {
      year?: number; month?: number; agentId?: string; text?: string;
    };
    const y = Number(year), m = Number(month);
    if (!y || !m || !agentId || !text?.trim()) {
      return res.status(400).json({ error: 'year, month, agentId, and text are required' });
    }
    if (user.agentId !== agentId) {
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
      authorId: user.id, authorName: user.name, authorRole: user.role,
      text: text.trim(), type: 'return_request', createdAt: new Date().toISOString(),
    });

    const updated = await prisma.qAAgentReport.update({
      where: { id: agentReport.id },
      data: { comments: JSON.stringify(comments), status: 'returned' },
      include: { agent: { select: { id: true, name: true } } },
    });

    const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    if (agentReport.sentByUserId) {
      await prisma.inboxMessage.create({
        data: {
          senderId: user.id,
          receiverId: agentReport.sentByUserId,
          type: 'qa_report',
          subject: `QA Report Returned — ${monthLabel}`,
          content: `${user.name} returned the ${monthLabel} QA report for re-review:\n\n${text.trim()}`,
          metadata: JSON.stringify({ year: y, month: m, agentId, reportId: report.id, status: 'returned' }),
        },
      });
    }

    return res.json(formatAgentReport(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to return report' });
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

    return res.json(issue);
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

    return res.status(201).json(issue);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create issue' });
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

    return res.json(report);
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

    return res.json(report);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update QA report' });
  }
});

export default router;
