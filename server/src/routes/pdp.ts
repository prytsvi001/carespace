// server/src/routes/pdp.ts
import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

function parseComments(raw: string): { authorId: string; authorName: string; text: string; createdAt: string }[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function formatTask(t: { comments: string; [key: string]: unknown }) {
  return { ...t, comments: parseComments(t.comments) };
}

function getTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Returns the date 14 days before the given YYYY-MM-DD string
function windowStartFor(periodEnd: string): string {
  const d = new Date(periodEnd + 'T00:00:00');
  d.setDate(d.getDate() - 14);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Whether the feedback form is in the submission window (≤14 days before end, or after)
function isInFeedbackWindow(periodEnd: string | null): boolean {
  if (!periodEnd) return false;
  const today = getTodayStr();
  return today >= windowStartFor(periodEnd);
}

// Whether the period has ended (feedback permanently locked)
function isPeriodEnded(periodEnd: string | null): boolean {
  if (!periodEnd) return false;
  return getTodayStr() > periodEnd;
}

// Decide if feedback should be included based on viewer role and plan owner role
function feedbackVisible(viewerRole: string, viewerId: string, planUserId: string, planUserRole: string): boolean {
  if (viewerId === planUserId) return true;          // owner always sees own
  if (viewerRole === 'head') return true;            // head sees everyone
  if (viewerRole === 'lead' && planUserRole === 'agent') return true; // lead sees agents
  return false; // lead cannot see another lead's feedback
}

const PLAN_INCLUDE = {
  goals: { orderBy: { sortOrder: 'asc' as const } },
  tasks: { orderBy: { sortOrder: 'asc' as const } },
  feedback: true,
  user: { select: { id: true, name: true, role: true } },
};

function formatPlan(plan: {
  tasks: { comments: string; [key: string]: unknown }[];
  feedback: unknown;
  user: { id: string; name: string; role: string };
  userId: string;
  [key: string]: unknown;
}, viewerRole: string, viewerId: string) {
  const visible = feedbackVisible(viewerRole, viewerId, plan.userId, plan.user.role);
  return {
    ...plan,
    tasks: plan.tasks.map(formatTask),
    feedback: visible ? plan.feedback : null,
  };
}

// GET /api/pdp/summary — all agent+lead users + their PDP status (head/lead only)
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const role = (req.user as Express.User).role;
    if (role !== 'head' && role !== 'lead') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const agentUsers = await prisma.user.findMany({
      where: { role: { in: ['agent', 'lead'] } },
      include: {
        pdpPlan: {
          include: { goals: { select: { status: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    const summary = agentUsers.map((u) => {
      const plan = u.pdpPlan;
      const totalGoals = plan?.goals.length ?? 0;
      const doneGoals = plan?.goals.filter((g) => g.status === 'done').length ?? 0;
      return {
        userId: u.id,
        userName: u.name,
        pdpStatus: !plan ? 'none' : plan.status === 'completed' ? 'completed' : 'in_progress',
        totalGoals,
        doneGoals,
      };
    });

    return res.json(summary);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch PDP summary' });
  }
});

// GET /api/pdp/me — current user's own PDP
router.get('/me', async (req: Request, res: Response) => {
  try {
    const { id: userId, role } = req.user as Express.User;
    const plan = await prisma.pdpPlan.findUnique({
      where: { userId },
      include: PLAN_INCLUDE,
    });
    if (!plan) return res.json(null);
    // Owner viewing own plan — feedback always visible
    return res.json(formatPlan(plan as Parameters<typeof formatPlan>[0], role, userId));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch PDP' });
  }
});

// GET /api/pdp/user/:userId — specific user's PDP (head/lead or own)
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const requesting = req.user as Express.User;
    const { userId } = req.params;

    if (requesting.id !== userId && requesting.role !== 'head' && requesting.role !== 'lead') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const plan = await prisma.pdpPlan.findUnique({
      where: { userId },
      include: PLAN_INCLUDE,
    });

    if (!plan) return res.json(null);
    return res.json(formatPlan(plan as Parameters<typeof formatPlan>[0], requesting.role, requesting.id));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch PDP' });
  }
});

// POST /api/pdp — create PDP for current user (agent or lead only)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { id: userId, role } = req.user as Express.User;

    if (role !== 'agent' && role !== 'lead') {
      return res.status(403).json({ error: 'Only agents and leads can create PDPs' });
    }

    const existing = await prisma.pdpPlan.findUnique({ where: { userId } });
    if (existing) return res.status(409).json({ error: 'PDP already exists' });

    const { periodStart, periodEnd } = req.body as { periodStart?: string; periodEnd?: string };

    const plan = await prisma.pdpPlan.create({
      data: { userId, periodStart: periodStart || null, periodEnd: periodEnd || null },
      include: { goals: true, tasks: true, feedback: true, user: { select: { id: true, name: true, role: true } } },
    });

    return res.status(201).json({ ...plan, tasks: [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create PDP' });
  }
});

// PATCH /api/pdp/:id — update PDP period dates (plan owner only)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id: userId } = req.user as Express.User;
    const { id } = req.params;

    const plan = await prisma.pdpPlan.findUnique({ where: { id } });
    if (!plan) return res.status(404).json({ error: 'Not found' });
    if (plan.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    const { periodStart, periodEnd } = req.body as { periodStart?: string; periodEnd?: string };

    const updated = await prisma.pdpPlan.update({
      where: { id },
      data: {
        ...(periodStart !== undefined && { periodStart: periodStart || null }),
        ...(periodEnd !== undefined && { periodEnd: periodEnd || null }),
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update PDP' });
  }
});

// ─── Goals ───────────────────────────────────────────────────────────────────

// POST /api/pdp/:planId/goals — add goal (plan owner OR admin)
router.post('/:planId/goals', async (req: Request, res: Response) => {
  try {
    const { id: userId, role, name: userName } = req.user as Express.User;
    const { planId } = req.params;

    const plan = await prisma.pdpPlan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const isOwner = plan.userId === userId;
    const isAdmin = role === 'head' || role === 'lead';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const { goal, specificActions, targetDate } = req.body as {
      goal?: string; specificActions?: string; targetDate?: string;
    };
    if (!goal?.trim()) return res.status(400).json({ error: 'Goal text is required' });

    const agg = await prisma.pdpGoal.aggregate({ where: { planId }, _max: { sortOrder: true } });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;

    const created = await prisma.pdpGoal.create({
      data: {
        planId,
        goal: goal.trim(),
        specificActions: specificActions?.trim() || null,
        targetDate: targetDate || null,
        sortOrder,
        assignedByName: isOwner ? null : userName,
      },
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add goal' });
  }
});

// PATCH /api/pdp/goals/:goalId — update goal
// Owner on own goal: all content fields + progress/status
// Owner on admin-assigned goal: progress/status only
// Admin on another's goal: adminRating + content fields if admin-assigned
router.patch('/goals/:goalId', async (req: Request, res: Response) => {
  try {
    const { id: userId, role } = req.user as Express.User;
    const { goalId } = req.params;

    const goalRecord = await prisma.pdpGoal.findUnique({
      where: { id: goalId },
      include: { plan: true },
    });
    if (!goalRecord) return res.status(404).json({ error: 'Goal not found' });

    const isOwner = goalRecord.plan.userId === userId;
    const isAdmin = role === 'head' || role === 'lead';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const isAdminAssigned = !!goalRecord.assignedByName;

    const body = req.body as {
      goal?: string;
      specificActions?: string | null;
      progressPct?: number;
      status?: string;
      targetDate?: string | null;
      adminRating?: number | null;
    };

    const data: Record<string, unknown> = {};

    // Content fields: editable by owner (when not admin-assigned) or admin (when admin-assigned)
    const canEditContent = (isOwner && !isAdminAssigned) || (isAdmin && !isOwner && isAdminAssigned);
    if (canEditContent) {
      if (body.goal !== undefined) data.goal = body.goal.trim();
      if (body.specificActions !== undefined) data.specificActions = body.specificActions || null;
      if (body.targetDate !== undefined) data.targetDate = body.targetDate || null;
    }

    // Progress/status: editable by owner only
    if (isOwner) {
      if (body.progressPct !== undefined) data.progressPct = body.progressPct;
      if (body.status !== undefined) data.status = body.status;
    }

    // Admin rating: admin only, on someone else's plan
    if (isAdmin && !isOwner && body.adminRating !== undefined) {
      data.adminRating = body.adminRating;
    }

    if (Object.keys(data).length === 0) {
      return res.json(goalRecord);
    }

    const updated = await prisma.pdpGoal.update({ where: { id: goalId }, data });

    // Auto-update plan status when a goal's status changes
    if (body.status && isOwner) {
      const allGoals = await prisma.pdpGoal.findMany({ where: { planId: goalRecord.planId } });
      const allDone =
        allGoals.length > 0 &&
        allGoals.every((g) => (g.id === goalId ? body.status === 'done' : g.status === 'done'));

      await prisma.pdpPlan.update({
        where: { id: goalRecord.planId },
        data: { status: allDone ? 'completed' : 'in_progress' },
      });
    }

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update goal' });
  }
});

// DELETE /api/pdp/goals/:goalId
// Owner can delete agent-created goals; admin can delete admin-assigned goals
router.delete('/goals/:goalId', async (req: Request, res: Response) => {
  try {
    const { id: userId, role } = req.user as Express.User;
    const { goalId } = req.params;

    const goalRecord = await prisma.pdpGoal.findUnique({
      where: { id: goalId },
      include: { plan: true },
    });
    if (!goalRecord) return res.status(404).json({ error: 'Goal not found' });

    const isOwner = goalRecord.plan.userId === userId;
    const isAdmin = role === 'head' || role === 'lead';
    const isAdminAssigned = !!goalRecord.assignedByName;

    const canDelete = (isOwner && !isAdminAssigned) || (isAdmin && isAdminAssigned);
    if (!canDelete) return res.status(403).json({ error: 'Forbidden' });

    await prisma.pdpTask.updateMany({ where: { goalId }, data: { goalId: null } });
    await prisma.pdpGoal.delete({ where: { id: goalId } });

    const remaining = await prisma.pdpGoal.findMany({ where: { planId: goalRecord.planId } });
    const allDone = remaining.length > 0 && remaining.every((g) => g.status === 'done');
    await prisma.pdpPlan.update({
      where: { id: goalRecord.planId },
      data: { status: allDone ? 'completed' : 'in_progress' },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete goal' });
  }
});

// ─── Tasks ───────────────────────────────────────────────────────────────────

// POST /api/pdp/:planId/tasks — add task (plan owner OR admin)
router.post('/:planId/tasks', async (req: Request, res: Response) => {
  try {
    const { id: userId, role, name: userName } = req.user as Express.User;
    const { planId } = req.params;

    const plan = await prisma.pdpPlan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const isOwner = plan.userId === userId;
    const isAdmin = role === 'head' || role === 'lead';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const { task, goalId } = req.body as { task?: string; goalId?: string };
    if (!task?.trim()) return res.status(400).json({ error: 'Task text is required' });

    const agg = await prisma.pdpTask.aggregate({ where: { planId }, _max: { sortOrder: true } });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;

    const created = await prisma.pdpTask.create({
      data: {
        planId,
        goalId: goalId || null,
        task: task.trim(),
        sortOrder,
        comments: '[]',
        assignedByName: isOwner ? null : userName,
      },
    });

    return res.status(201).json(formatTask(created));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add task' });
  }
});

// PATCH /api/pdp/tasks/:taskId — update task
// Owner on own task: all content fields + status/completed
// Owner on admin-assigned task: status/completed only
// Admin on another's task: adminGrade + content fields if admin-assigned
router.patch('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const { id: userId, role } = req.user as Express.User;
    const { taskId } = req.params;

    const taskRecord = await prisma.pdpTask.findUnique({
      where: { id: taskId },
      include: { plan: true },
    });
    if (!taskRecord) return res.status(404).json({ error: 'Task not found' });

    const isOwner = taskRecord.plan.userId === userId;
    const isAdmin = role === 'head' || role === 'lead';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const isAdminAssigned = !!taskRecord.assignedByName;

    const body = req.body as {
      task?: string;
      goalId?: string | null;
      completed?: boolean;
      status?: string;
      adminGrade?: number | null;
    };

    const data: Record<string, unknown> = {};

    // Content fields (task text, goalId): owner on own task, or admin on admin-assigned task
    const canEditContent = (isOwner && !isAdminAssigned) || (isAdmin && !isOwner && isAdminAssigned);
    if (canEditContent) {
      if (body.task !== undefined) data.task = body.task.trim();
      if (body.goalId !== undefined) data.goalId = body.goalId || null;
    }

    // Status/completed: owner only
    if (isOwner) {
      if (body.completed !== undefined) {
        data.completed = body.completed;
        if (body.status === undefined) {
          data.status = body.completed ? 'completed' : 'not_started';
        }
      }
      if (body.status !== undefined) {
        data.status = body.status;
        if (body.completed === undefined) {
          data.completed = body.status === 'completed';
        }
      }
    }

    // Admin grade: admin only, on someone else's plan
    if (isAdmin && !isOwner && body.adminGrade !== undefined) {
      data.adminGrade = body.adminGrade;
    }

    if (Object.keys(data).length === 0) {
      return res.json(formatTask(taskRecord));
    }

    const updated = await prisma.pdpTask.update({ where: { id: taskId }, data });
    return res.json(formatTask(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/pdp/tasks/:taskId
// Owner can delete agent-created tasks; admin can delete admin-assigned tasks
router.delete('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const { id: userId, role } = req.user as Express.User;
    const { taskId } = req.params;

    const taskRecord = await prisma.pdpTask.findUnique({
      where: { id: taskId },
      include: { plan: true },
    });
    if (!taskRecord) return res.status(404).json({ error: 'Task not found' });

    const isOwner = taskRecord.plan.userId === userId;
    const isAdmin = role === 'head' || role === 'lead';
    const isAdminAssigned = !!taskRecord.assignedByName;

    const canDelete = (isOwner && !isAdminAssigned) || (isAdmin && isAdminAssigned);
    if (!canDelete) return res.status(403).json({ error: 'Forbidden' });

    await prisma.pdpTask.delete({ where: { id: taskId } });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete task' });
  }
});

// POST /api/pdp/tasks/:taskId/comments — append a comment (owner or admin)
router.post('/tasks/:taskId/comments', async (req: Request, res: Response) => {
  try {
    const user = req.user as Express.User;
    const { taskId } = req.params;

    const taskRecord = await prisma.pdpTask.findUnique({
      where: { id: taskId },
      include: { plan: true },
    });
    if (!taskRecord) return res.status(404).json({ error: 'Task not found' });

    const isOwner = taskRecord.plan.userId === user.id;
    const isAdmin = user.role === 'head' || user.role === 'lead';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: 'Comment text is required' });

    const comments = parseComments(taskRecord.comments);
    comments.push({
      authorId: user.id,
      authorName: user.name,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    });

    const updated = await prisma.pdpTask.update({
      where: { id: taskId },
      data: { comments: JSON.stringify(comments) },
    });

    return res.json(formatTask(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add comment' });
  }
});

// ─── Feedback ─────────────────────────────────────────────────────────────────

// PUT /api/pdp/:planId/feedback — upsert feedback draft (plan owner only, while not locked)
router.put('/:planId/feedback', async (req: Request, res: Response) => {
  try {
    const { id: userId } = req.user as Express.User;
    const { planId } = req.params;

    const plan = await prisma.pdpPlan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
    if (isPeriodEnded(plan.periodEnd)) {
      return res.status(403).json({ error: 'Feedback period has ended' });
    }
    if (!isInFeedbackWindow(plan.periodEnd)) {
      return res.status(403).json({ error: 'Feedback is not yet available' });
    }

    const { mentorRating, mostHelpful, improvements, achievements, nextFocus } = req.body as {
      mentorRating?: number | null;
      mostHelpful?: string;
      improvements?: string;
      achievements?: string;
      nextFocus?: string;
    };

    const data: Record<string, unknown> = {};
    if (mentorRating !== undefined) data.mentorRating = mentorRating;
    if (mostHelpful !== undefined) data.mostHelpful = mostHelpful || null;
    if (improvements !== undefined) data.improvements = improvements || null;
    if (achievements !== undefined) data.achievements = achievements || null;
    if (nextFocus !== undefined) data.nextFocus = nextFocus || null;

    const feedback = await prisma.pdpFeedback.upsert({
      where: { planId },
      create: { planId, ...data },
      update: data,
    });

    return res.json(feedback);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// POST /api/pdp/:planId/feedback/submit — submit feedback (plan owner, while in window and not locked)
router.post('/:planId/feedback/submit', async (req: Request, res: Response) => {
  try {
    const { id: userId } = req.user as Express.User;
    const { planId } = req.params;

    const plan = await prisma.pdpPlan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
    if (isPeriodEnded(plan.periodEnd)) {
      return res.status(403).json({ error: 'Feedback period has ended' });
    }
    if (!isInFeedbackWindow(plan.periodEnd)) {
      return res.status(403).json({ error: 'Feedback is not yet available' });
    }

    const feedback = await prisma.pdpFeedback.upsert({
      where: { planId },
      create: { planId, submittedAt: new Date() },
      update: { submittedAt: new Date() },
    });

    return res.json(feedback);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

export default router;
