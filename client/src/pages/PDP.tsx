// client/src/pages/PDP.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  TrendingUp, Plus, Pencil, Trash2, Star, ChevronLeft,
  MessageSquare, Check, ClipboardList,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  getMyPDP, getPDPSummary, getPDPByUser,
  createPDP, updatePDPPeriod,
  createPDPGoal, updatePDPGoal, deletePDPGoal,
  createPDPTask, updatePDPTask, deletePDPTask,
  addPDPTaskComment, savePDPFeedback, submitPDPFeedback,
} from '../api';
import type { PdpPlan, PdpGoal, PdpTask, PdpFeedback, PdpSummaryItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { Modal, Spinner, EmptyState, ConfirmDialog } from '../components/ui';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROGRESS_OPTIONS = [0, 25, 50, 75, 100];

const GOAL_STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

const TASK_STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
];

type PdpTab = 'goals' | 'tasks' | 'feedback';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getManagerName(role: string): string {
  if (role === 'agent') return 'Victoria Davis';
  if (role === 'lead') return 'Sandra Moore';
  return '';
}

function isOverdue(targetDate: string | null, status: string): boolean {
  if (!targetDate || status === 'done') return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return targetDate < today;
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(new Date(dateStr.length > 10 ? dateStr : dateStr + 'T00:00:00'), 'dd MMM yyyy');
  } catch {
    return dateStr;
  }
}

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getFeedbackWindowStart(periodEnd: string): string {
  const d = new Date(periodEnd + 'T00:00:00');
  d.setDate(d.getDate() - 14);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function goalStatusStyle(status: string): React.CSSProperties {
  if (status === 'done') return { backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' };
  if (status === 'in_progress') return { backgroundColor: 'rgb(255,251,235)', color: '#b45309' };
  return { backgroundColor: 'rgba(14,14,14,0.07)', color: 'rgba(14,14,14,0.58)' };
}

function taskStatusStyle(status: string): React.CSSProperties {
  if (status === 'completed') return { backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' };
  if (status === 'in_progress') return { backgroundColor: 'rgb(255,251,235)', color: '#b45309' };
  return { backgroundColor: 'rgba(14,14,14,0.07)', color: 'rgba(14,14,14,0.58)' };
}

function labelOf(options: { value: string; label: string }[], value: string) {
  return options.find((o) => o.value === value)?.label ?? value;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
  disabled,
  size = 14,
}: {
  value: number | null;
  onChange?: (v: number) => void;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <div className="flex items-center gap-0.5" style={{ opacity: disabled ? 0.35 : 1 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= (value ?? 0);
        return (
          <button
            key={n}
            type="button"
            onClick={() => !disabled && onChange?.(n)}
            disabled={disabled}
            className={disabled ? 'cursor-not-allowed' : 'hover:scale-110 transition-transform'}
            title={disabled ? 'Admin only' : `Rate ${n}`}
          >
            <Star
              size={size}
              strokeWidth={1.5}
              fill={filled ? '#A1F96E' : 'none'}
              stroke={filled ? '#A1F96E' : 'rgba(14,14,14,0.25)'}
            />
          </button>
        );
      })}
    </div>
  );
}

function ProgressBar({ total, done }: { total: number; done: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex-1 h-1.5 rounded-full overflow-hidden"
        style={{ backgroundColor: 'rgba(14,14,14,0.07)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: '#A1F96E' }}
        />
      </div>
      <span className="text-xs font-medium w-8 text-right" style={{ color: 'rgba(14,14,14,0.50)' }}>
        {pct}%
      </span>
    </div>
  );
}

function AssignedBadge({ name }: { name: string }) {
  return (
    <span
      className="inline-flex items-center text-xs px-1.5 py-0.5 rounded font-medium"
      style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.45)' }}
    >
      Assigned by {name.split(' ')[0]}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PDP() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'head' || user?.role === 'lead';

  // ── Data state ────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<PdpPlan | null>(null);
  const [summaryItems, setSummaryItems] = useState<PdpSummaryItem[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // ── Tab navigation ─────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<PdpTab>('goals');

  // ── Create PDP modal ──────────────────────────────────────────────────────
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ periodStart: '', periodEnd: '' });
  const [creating, setCreating] = useState(false);

  // ── Edit period modal ─────────────────────────────────────────────────────
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [periodForm, setPeriodForm] = useState({ periodStart: '', periodEnd: '' });
  const [savingPeriod, setSavingPeriod] = useState(false);

  // ── Goal modal ────────────────────────────────────────────────────────────
  const [goalModal, setGoalModal] = useState<{ open: boolean; editing: PdpGoal | null }>({
    open: false,
    editing: null,
  });
  const [goalForm, setGoalForm] = useState({ goal: '', specificActions: '', targetDate: '' });
  const [savingGoal, setSavingGoal] = useState(false);

  // ── Task modal ────────────────────────────────────────────────────────────
  const [taskModal, setTaskModal] = useState<{ open: boolean; editing: PdpTask | null }>({
    open: false,
    editing: null,
  });
  const [taskForm, setTaskForm] = useState({ task: '', goalId: '' });
  const [savingTask, setSavingTask] = useState(false);

  // ── Comments modal ────────────────────────────────────────────────────────
  const [commentsTask, setCommentsTask] = useState<PdpTask | null>(null);
  const [newComment, setNewComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);

  // ── Task goal filter ──────────────────────────────────────────────────────
  const [taskGoalFilter, setTaskGoalFilter] = useState<string | null>(null);

  // ── Delete confirm ────────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'goal' | 'task'; id: string } | null>(
    null,
  );

  // ── Feedback state ────────────────────────────────────────────────────────
  const [feedbackDraft, setFeedbackDraft] = useState({
    mentorRating: null as number | null,
    mostHelpful: '',
    improvements: '',
    achievements: '',
    nextFocus: '',
  });
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadMyPDP = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMyPDP();
      setPlan(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPDPSummary();
      setSummaryItems(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAgentPDP = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const data = await getPDPByUser(userId);
      setPlan(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      if (selectedUserId) {
        loadAgentPDP(selectedUserId);
      } else {
        setPlan(null);
        loadSummary();
      }
    } else {
      loadMyPDP();
    }
  }, [isAdmin, selectedUserId, loadMyPDP, loadSummary, loadAgentPDP]);

  // Reset tab and filter when navigating between plans
  useEffect(() => {
    setActiveSection('goals');
    setTaskGoalFilter(null);
  }, [selectedUserId]);

  // Sync feedback draft from plan when plan loads
  useEffect(() => {
    const fb = plan?.feedback;
    setFeedbackDraft({
      mentorRating: fb?.mentorRating ?? null,
      mostHelpful: fb?.mostHelpful ?? '',
      improvements: fb?.improvements ?? '',
      achievements: fb?.achievements ?? '',
      nextFocus: fb?.nextFocus ?? '',
    });
  }, [plan?.id, plan?.feedback?.updatedAt]);

  // ─── Plan helpers ──────────────────────────────────────────────────────────

  const doneGoals = plan?.goals.filter((g) => g.status === 'done').length ?? 0;
  const totalGoals = plan?.goals.length ?? 0;

  const completedTasks = plan?.tasks.filter((t) => t.completed).length ?? 0;
  const totalTasks = plan?.tasks.length ?? 0;

  const filteredTasks = taskGoalFilter
    ? (plan?.tasks.filter((t) => t.goalId === taskGoalFilter) ?? [])
    : (plan?.tasks ?? []);

  function applyPlanUpdate(updater: (prev: PdpPlan) => PdpPlan) {
    setPlan((prev) => (prev ? updater(prev) : prev));
  }

  // ─── Create PDP ────────────────────────────────────────────────────────────

  const handleCreatePDP = async () => {
    setCreating(true);
    try {
      const created = await createPDP({
        periodStart: createForm.periodStart || undefined,
        periodEnd: createForm.periodEnd || undefined,
      });
      setPlan(created);
      setShowCreateModal(false);
      setCreateForm({ periodStart: '', periodEnd: '' });
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  // ─── Edit period ───────────────────────────────────────────────────────────

  const openPeriodModal = () => {
    setPeriodForm({
      periodStart: plan?.periodStart ?? '',
      periodEnd: plan?.periodEnd ?? '',
    });
    setShowPeriodModal(true);
  };

  const handleSavePeriod = async () => {
    if (!plan) return;
    setSavingPeriod(true);
    try {
      const updated = await updatePDPPeriod(plan.id, {
        periodStart: periodForm.periodStart || undefined,
        periodEnd: periodForm.periodEnd || undefined,
      });
      applyPlanUpdate((p) => ({ ...p, ...updated }));
      setShowPeriodModal(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingPeriod(false);
    }
  };

  // ─── Goals ─────────────────────────────────────────────────────────────────

  const openAddGoal = () => {
    setGoalForm({ goal: '', specificActions: '', targetDate: '' });
    setGoalModal({ open: true, editing: null });
  };

  const openEditGoal = (g: PdpGoal) => {
    setGoalForm({
      goal: g.goal,
      specificActions: g.specificActions ?? '',
      targetDate: g.targetDate ?? '',
    });
    setGoalModal({ open: true, editing: g });
  };

  const handleSaveGoal = async () => {
    if (!plan || !goalForm.goal.trim()) return;
    setSavingGoal(true);
    try {
      if (goalModal.editing) {
        const updated = await updatePDPGoal(goalModal.editing.id, {
          goal: goalForm.goal,
          specificActions: goalForm.specificActions || null,
          targetDate: goalForm.targetDate || null,
        });
        applyPlanUpdate((p) => ({
          ...p,
          goals: p.goals.map((g) => (g.id === updated.id ? { ...g, ...updated } : g)),
        }));
      } else {
        const created = await createPDPGoal(plan.id, {
          goal: goalForm.goal,
          specificActions: goalForm.specificActions || undefined,
          targetDate: goalForm.targetDate || undefined,
        });
        applyPlanUpdate((p) => ({ ...p, goals: [...p.goals, created] }));
      }
      setGoalModal({ open: false, editing: null });
    } catch (e) {
      console.error(e);
    } finally {
      setSavingGoal(false);
    }
  };

  const handleGoalInlineUpdate = async (goalId: string, data: Partial<PdpGoal>) => {
    try {
      const updated = await updatePDPGoal(goalId, data);
      applyPlanUpdate((p) => ({
        ...p,
        goals: p.goals.map((g) => (g.id === goalId ? { ...g, ...updated } : g)),
        status:
          data.status &&
          p.goals.every((g) =>
            g.id === goalId ? data.status === 'done' : g.status === 'done',
          )
            ? 'completed'
            : 'in_progress',
      }));
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteGoal = async (goalId: string) => {
    try {
      await deletePDPGoal(goalId);
      applyPlanUpdate((p) => ({
        ...p,
        goals: p.goals.filter((g) => g.id !== goalId),
        tasks: p.tasks.map((t) => (t.goalId === goalId ? { ...t, goalId: null } : t)),
      }));
      if (taskGoalFilter === goalId) setTaskGoalFilter(null);
    } catch (e) {
      console.error(e);
    }
  };

  // ─── Tasks ─────────────────────────────────────────────────────────────────

  const openAddTask = () => {
    setTaskForm({ task: '', goalId: '' });
    setTaskModal({ open: true, editing: null });
  };

  const openEditTask = (t: PdpTask) => {
    setTaskForm({ task: t.task, goalId: t.goalId ?? '' });
    setTaskModal({ open: true, editing: t });
  };

  const handleSaveTask = async () => {
    if (!plan || !taskForm.task.trim()) return;
    setSavingTask(true);
    try {
      if (taskModal.editing) {
        const updated = await updatePDPTask(taskModal.editing.id, {
          task: taskForm.task,
          goalId: taskForm.goalId || null,
        });
        applyPlanUpdate((p) => ({
          ...p,
          tasks: p.tasks.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
        }));
      } else {
        const created = await createPDPTask(plan.id, {
          task: taskForm.task,
          goalId: taskForm.goalId || undefined,
        });
        applyPlanUpdate((p) => ({ ...p, tasks: [...p.tasks, created] }));
      }
      setTaskModal({ open: false, editing: null });
    } catch (e) {
      console.error(e);
    } finally {
      setSavingTask(false);
    }
  };

  const handleTaskInlineUpdate = async (taskId: string, data: Partial<PdpTask>) => {
    applyPlanUpdate((p) => ({
      ...p,
      tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, ...data } : t)),
    }));
    try {
      const updated = await updatePDPTask(taskId, data);
      applyPlanUpdate((p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, ...updated } : t)),
      }));
    } catch (e) {
      console.error(e);
      if (isAdmin && selectedUserId) loadAgentPDP(selectedUserId);
      else loadMyPDP();
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deletePDPTask(taskId);
      applyPlanUpdate((p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== taskId) }));
    } catch (e) {
      console.error(e);
    }
  };

  // ─── Comments ──────────────────────────────────────────────────────────────

  const openComments = (task: PdpTask) => {
    setCommentsTask(task);
    setNewComment('');
  };

  const handleAddComment = async () => {
    if (!commentsTask || !newComment.trim()) return;
    setAddingComment(true);
    try {
      const updated = await addPDPTaskComment(commentsTask.id, newComment);
      applyPlanUpdate((p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
      }));
      setCommentsTask((prev) => (prev ? { ...prev, comments: updated.comments } : prev));
      setNewComment('');
    } catch (e) {
      console.error(e);
    } finally {
      setAddingComment(false);
    }
  };

  // ─── Feedback ──────────────────────────────────────────────────────────────

  const handleSaveFeedbackDraft = async () => {
    if (!plan) return;
    setSavingFeedback(true);
    try {
      const updated = await savePDPFeedback(plan.id, feedbackDraft);
      applyPlanUpdate((p) => ({ ...p, feedback: updated }));
    } catch (e) {
      console.error(e);
    } finally {
      setSavingFeedback(false);
    }
  };

  const handleSubmitFeedback = async () => {
    if (!plan) return;
    setSubmittingFeedback(true);
    try {
      // Save draft content first, then mark submitted
      await savePDPFeedback(plan.id, feedbackDraft);
      const submitted = await submitPDPFeedback(plan.id);
      applyPlanUpdate((p) => ({ ...p, feedback: submitted }));
    } catch (e) {
      console.error(e);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const handleUpdateFeedback = async () => {
    if (!plan) return;
    setSavingFeedback(true);
    try {
      const updated = await savePDPFeedback(plan.id, feedbackDraft);
      applyPlanUpdate((p) => ({ ...p, feedback: updated }));
    } catch (e) {
      console.error(e);
    } finally {
      setSavingFeedback(false);
    }
  };

  // ─── Delete confirm ────────────────────────────────────────────────────────

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === 'goal') await handleDeleteGoal(confirmDelete.id);
    else await handleDeleteTask(confirmDelete.id);
    setConfirmDelete(null);
  };

  // ─── Derived access flags ──────────────────────────────────────────────────

  const isViewingOwnPDP = isAdmin && selectedUserId === user?.id;
  const canEdit = !isAdmin || isViewingOwnPDP;
  const adminFieldsActive = isAdmin && !isViewingOwnPDP;

  // ─── Render helpers ────────────────────────────────────────────────────────

  function renderPdpStatusBadge(status: 'none' | 'in_progress' | 'completed') {
    if (status === 'none') {
      return (
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: 'rgba(14,14,14,0.07)', color: 'rgba(14,14,14,0.55)' }}
        >
          No PDP created
        </span>
      );
    }
    if (status === 'completed') {
      return (
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' }}
        >
          Completed
        </span>
      );
    }
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ backgroundColor: 'rgb(255,251,235)', color: '#b45309' }}
      >
        In progress
      </span>
    );
  }

  // ─── Render: Admin agent list ──────────────────────────────────────────────

  const renderAdminList = () => (
    <div className="card overflow-hidden p-0">
      <div
        className="px-4 py-3 text-xs font-medium uppercase tracking-wide grid grid-cols-[1fr_140px_160px]"
        style={{
          color: 'rgba(14,14,14,0.40)',
          borderBottom: '1px solid rgba(14,14,14,0.07)',
        }}
      >
        <span>Agent</span>
        <span>Status</span>
        <span>Progress</span>
      </div>

      <div className="divide-y divide-slate-50">
        {summaryItems.map((item) => (
          <button
            key={item.userId}
            onClick={() => setSelectedUserId(item.userId)}
            className="w-full text-left px-4 py-3.5 hover:bg-slate-50 transition-colors grid grid-cols-[1fr_140px_160px] items-center gap-4"
          >
            <span className="text-sm font-medium text-slate-700">{item.userName}</span>
            <span>{renderPdpStatusBadge(item.pdpStatus)}</span>
            <div>
              {item.pdpStatus !== 'none' ? (
                <ProgressBar total={item.totalGoals} done={item.doneGoals} />
              ) : (
                <span className="text-xs" style={{ color: 'rgba(14,14,14,0.30)' }}>
                  —
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // ─── Render: PDP header card ───────────────────────────────────────────────

  const renderPlanHeader = () => {
    if (!plan) return null;
    const managerName = isAdmin
      ? plan.user?.role === 'lead'
        ? 'Sandra Moore'
        : 'Victoria Davis'
      : getManagerName(user!.role);

    const periodText =
      plan.periodStart || plan.periodEnd
        ? `${fmtDate(plan.periodStart)} — ${fmtDate(plan.periodEnd)}`
        : 'Period not set';

    return (
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-5">
            <div>
              <p className="text-xs font-medium mb-0.5" style={{ color: 'rgba(14,14,14,0.45)' }}>
                Period
              </p>
              <p className="text-sm font-medium text-slate-700">{periodText}</p>
            </div>
            {managerName && (
              <div>
                <p className="text-xs font-medium mb-0.5" style={{ color: 'rgba(14,14,14,0.45)' }}>
                  Manager
                </p>
                <p className="text-sm font-medium text-slate-700">{managerName}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium mb-0.5" style={{ color: 'rgba(14,14,14,0.45)' }}>
                Status
              </p>
              {renderPdpStatusBadge(
                plan.status === 'completed' ? 'completed' : 'in_progress',
              )}
            </div>
          </div>

          {canEdit && (
            <button
              className="btn-secondary text-xs self-start sm:self-auto"
              onClick={openPeriodModal}
            >
              <Pencil size={12} strokeWidth={1.6} className="inline mr-1.5" />
              Edit period
            </button>
          )}
        </div>

        {totalGoals > 0 && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(14,14,14,0.07)' }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium" style={{ color: 'rgba(14,14,14,0.55)' }}>
                Overall goal progress
              </span>
              <span className="text-xs font-medium" style={{ color: 'rgba(14,14,14,0.55)' }}>
                {doneGoals}/{totalGoals} done
              </span>
            </div>
            <ProgressBar total={totalGoals} done={doneGoals} />
          </div>
        )}
      </div>
    );
  };

  // ─── Render: Tab bar ──────────────────────────────────────────────────────

  const renderTabBar = () => (
    <div className="flex items-center gap-1.5">
      {(['goals', 'tasks', 'feedback'] as PdpTab[]).map((tab) => {
        const labels: Record<PdpTab, string> = { goals: 'Goals', tasks: 'Tasks', feedback: 'Mentor Feedback' };
        return (
          <button
            key={tab}
            onClick={() => setActiveSection(tab)}
            className="text-sm px-4 py-1.5 rounded-lg font-medium transition-all"
            style={
              activeSection === tab
                ? { backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' }
                : { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.55)' }
            }
          >
            {labels[tab]}
          </button>
        );
      })}
    </div>
  );

  // ─── Render: Goals section ─────────────────────────────────────────────────

  const renderGoals = () => {
    if (!plan) return null;
    const goals = plan.goals;
    const showActionsCol = canEdit || adminFieldsActive;

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-700">Goals</h3>
          {(canEdit || adminFieldsActive) && (
            <button className="btn-accent text-xs" onClick={openAddGoal}>
              <Plus size={13} strokeWidth={2} className="inline mr-1" />
              {adminFieldsActive ? 'Assign goal' : 'Add goal'}
            </button>
          )}
        </div>

        {goals.length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={36} strokeWidth={1} />}
            message="No goals yet"
            action={
              canEdit ? (
                <button className="btn-accent" onClick={openAddGoal}>
                  Add first goal
                </button>
              ) : adminFieldsActive ? (
                <button className="btn-accent" onClick={openAddGoal}>
                  Assign first goal
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr
                    className="text-xs font-medium uppercase tracking-wide"
                    style={{
                      color: 'rgba(14,14,14,0.40)',
                      borderBottom: '1px solid rgba(14,14,14,0.07)',
                    }}
                  >
                    <th className="text-left px-4 py-2.5 w-[22%]">Goal</th>
                    <th className="text-left px-4 py-2.5 w-[20%]">Specific actions</th>
                    <th className="text-left px-4 py-2.5 w-[9%]">Progress</th>
                    <th className="text-left px-4 py-2.5 w-[11%]">Status</th>
                    <th className="text-left px-4 py-2.5 w-[11%]">Admin rating</th>
                    <th className="text-left px-4 py-2.5 w-[10%]">Target date</th>
                    {showActionsCol && <th className="px-4 py-2.5 w-[8%]" />}
                  </tr>
                </thead>
                <tbody>
                  {goals.map((g) => {
                    const overdue = isOverdue(g.targetDate, g.status);
                    // Show edit/delete: agent on own goal, or admin on admin-assigned goal
                    const rowHasActions =
                      (canEdit && !g.assignedByName) ||
                      (adminFieldsActive && !!g.assignedByName);

                    return (
                      <tr
                        key={g.id}
                        className="hover:bg-slate-50 transition-colors"
                        style={{ borderTop: '1px solid rgba(14,14,14,0.05)' }}
                      >
                        {/* Goal */}
                        <td className="px-4 py-3 align-top">
                          <p className="font-medium text-slate-700 leading-snug">{g.goal}</p>
                          {g.assignedByName && (
                            <div className="mt-1">
                              <AssignedBadge name={g.assignedByName} />
                            </div>
                          )}
                        </td>

                        {/* Specific actions */}
                        <td className="px-4 py-3 align-top">
                          <p
                            className="text-xs leading-snug line-clamp-2"
                            style={{ color: 'rgba(14,14,14,0.55)' }}
                            title={g.specificActions ?? ''}
                          >
                            {g.specificActions || (
                              <span style={{ color: 'rgba(14,14,14,0.25)' }}>—</span>
                            )}
                          </p>
                        </td>

                        {/* Progress % */}
                        <td className="px-4 py-3 align-top">
                          {canEdit ? (
                            <select
                              className="input text-xs py-1 px-2 w-20"
                              value={g.progressPct}
                              onChange={(e) =>
                                handleGoalInlineUpdate(g.id, {
                                  progressPct: Number(e.target.value),
                                })
                              }
                            >
                              {PROGRESS_OPTIONS.map((v) => (
                                <option key={v} value={v}>
                                  {v}%
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs font-medium text-slate-600">
                              {g.progressPct}%
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 align-top">
                          {canEdit ? (
                            <select
                              className="input text-xs py-1 px-2 w-28"
                              value={g.status}
                              onChange={(e) =>
                                handleGoalInlineUpdate(g.id, { status: e.target.value as PdpGoal['status'] })
                              }
                            >
                              {GOAL_STATUS_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={goalStatusStyle(g.status)}
                            >
                              {labelOf(GOAL_STATUS_OPTIONS, g.status)}
                            </span>
                          )}
                        </td>

                        {/* Admin rating */}
                        <td className="px-4 py-3 align-top">
                          <StarRating
                            value={g.adminRating}
                            disabled={!adminFieldsActive}
                            onChange={(v) =>
                              handleGoalInlineUpdate(g.id, { adminRating: v === g.adminRating ? null : v })
                            }
                          />
                        </td>

                        {/* Target date */}
                        <td className="px-4 py-3 align-top">
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={
                              overdue
                                ? { color: '#b91c1c', backgroundColor: 'rgba(220,38,38,0.07)' }
                                : { color: 'rgba(14,14,14,0.55)' }
                            }
                          >
                            {fmtDate(g.targetDate)}
                          </span>
                        </td>

                        {/* Actions */}
                        {showActionsCol && (
                          <td className="px-4 py-3 align-top">
                            {rowHasActions && (
                              <div className="flex items-center gap-2 justify-end">
                                <button
                                  onClick={() => openEditGoal(g)}
                                  className="text-slate-300 hover:text-slate-500 transition-colors"
                                  title="Edit"
                                >
                                  <Pencil size={13} strokeWidth={1.5} />
                                </button>
                                <button
                                  onClick={() => setConfirmDelete({ type: 'goal', id: g.id })}
                                  className="text-slate-300 hover:text-red-400 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 size={13} strokeWidth={1.5} />
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Render: Tasks section ─────────────────────────────────────────────────

  const renderTasks = () => {
    if (!plan) return null;
    const showActionsCol = canEdit || adminFieldsActive;

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-700">Tasks</h3>
            {totalTasks > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: 'rgba(14,14,14,0.07)', color: 'rgba(14,14,14,0.55)' }}
              >
                {completedTasks}/{totalTasks} completed
              </span>
            )}
          </div>
          {(canEdit || adminFieldsActive) && (
            <button className="btn-accent text-xs" onClick={openAddTask}>
              <Plus size={13} strokeWidth={2} className="inline mr-1" />
              {adminFieldsActive ? 'Assign task' : 'Add task'}
            </button>
          )}
        </div>

        {/* Goal filter */}
        {plan.goals.length > 0 && plan.tasks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setTaskGoalFilter(null)}
              className="text-xs px-3 py-1 rounded-lg font-medium transition-all"
              style={
                taskGoalFilter === null
                  ? { backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' }
                  : { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.55)' }
              }
            >
              All tasks
            </button>
            {plan.goals.map((g) => (
              <button
                key={g.id}
                onClick={() => setTaskGoalFilter(taskGoalFilter === g.id ? null : g.id)}
                className="text-xs px-3 py-1 rounded-lg font-medium transition-all max-w-[160px] truncate"
                style={
                  taskGoalFilter === g.id
                    ? { backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' }
                    : { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.55)' }
                }
                title={g.goal}
              >
                {g.goal}
              </button>
            ))}
          </div>
        )}

        {filteredTasks.length === 0 ? (
          plan.tasks.length === 0 ? (
            <EmptyState
              icon={<Check size={36} strokeWidth={1} />}
              message="No tasks yet"
              action={
                canEdit ? (
                  <button className="btn-accent" onClick={openAddTask}>
                    Add first task
                  </button>
                ) : adminFieldsActive ? (
                  <button className="btn-accent" onClick={openAddTask}>
                    Assign first task
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div
              className="py-5 text-center text-sm"
              style={{ color: 'rgba(14,14,14,0.40)' }}
            >
              No tasks linked to this goal
            </div>
          )
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr
                    className="text-xs font-medium uppercase tracking-wide"
                    style={{
                      color: 'rgba(14,14,14,0.40)',
                      borderBottom: '1px solid rgba(14,14,14,0.07)',
                    }}
                  >
                    <th className="px-4 py-2.5 w-8" />
                    <th className="text-left px-4 py-2.5 w-[25%]">Task</th>
                    <th className="text-left px-4 py-2.5 w-[18%]">Related goal</th>
                    <th className="text-left px-4 py-2.5 w-[11%]">Status</th>
                    <th className="text-left px-4 py-2.5 w-[10%]">Grade</th>
                    <th className="text-left px-4 py-2.5 w-[8%]">Comments</th>
                    {showActionsCol && <th className="px-4 py-2.5 w-[8%]" />}
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((t) => {
                    const relatedGoal = plan.goals.find((g) => g.id === t.goalId);
                    const commentCount = t.comments.length;
                    const rowHasActions =
                      (canEdit && !t.assignedByName) ||
                      (adminFieldsActive && !!t.assignedByName);

                    return (
                      <tr
                        key={t.id}
                        className="hover:bg-slate-50 transition-colors"
                        style={{ borderTop: '1px solid rgba(14,14,14,0.05)' }}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-3 align-top">
                          <button
                            onClick={() =>
                              canEdit &&
                              handleTaskInlineUpdate(t.id, {
                                completed: !t.completed,
                                status: !t.completed ? 'completed' : 'not_started',
                              })
                            }
                            disabled={!canEdit}
                            className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                              canEdit ? 'cursor-pointer hover:border-slate-400' : 'cursor-default'
                            }`}
                            style={{
                              borderColor: t.completed ? '#A1F96E' : 'rgba(14,14,14,0.20)',
                              backgroundColor: t.completed ? '#A1F96E' : 'transparent',
                            }}
                          >
                            {t.completed && (
                              <Check size={10} strokeWidth={2.5} style={{ color: '#0E0E0E' }} />
                            )}
                          </button>
                        </td>

                        {/* Task */}
                        <td className="px-4 py-3 align-top">
                          <p
                            className={`font-medium leading-snug ${t.completed ? 'line-through' : ''}`}
                            style={{
                              color: t.completed ? 'rgba(14,14,14,0.40)' : '#0E0E0E',
                            }}
                          >
                            {t.task}
                          </p>
                          {t.assignedByName && (
                            <div className="mt-1">
                              <AssignedBadge name={t.assignedByName} />
                            </div>
                          )}
                        </td>

                        {/* Related goal */}
                        <td className="px-4 py-3 align-top">
                          {canEdit && !t.assignedByName ? (
                            <select
                              className="input text-xs py-1 px-2 w-full max-w-[160px]"
                              value={t.goalId ?? ''}
                              onChange={(e) =>
                                handleTaskInlineUpdate(t.id, {
                                  goalId: e.target.value || null,
                                })
                              }
                            >
                              <option value="">No goal</option>
                              {plan.goals.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.goal.length > 24 ? g.goal.slice(0, 24) + '…' : g.goal}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className="text-xs leading-snug line-clamp-2"
                              style={{ color: 'rgba(14,14,14,0.55)' }}
                              title={relatedGoal?.goal}
                            >
                              {relatedGoal ? relatedGoal.goal : (
                                <span style={{ color: 'rgba(14,14,14,0.25)' }}>—</span>
                              )}
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 align-top">
                          {canEdit ? (
                            <select
                              className="input text-xs py-1 px-2 w-28"
                              value={t.status}
                              onChange={(e) => {
                                const newStatus = e.target.value as PdpTask['status'];
                                handleTaskInlineUpdate(t.id, {
                                  status: newStatus,
                                  completed: newStatus === 'completed',
                                });
                              }}
                            >
                              {TASK_STATUS_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={taskStatusStyle(t.status)}
                            >
                              {labelOf(TASK_STATUS_OPTIONS, t.status)}
                            </span>
                          )}
                        </td>

                        {/* Admin grade */}
                        <td className="px-4 py-3 align-top">
                          <StarRating
                            value={t.adminGrade}
                            disabled={!adminFieldsActive}
                            onChange={(v) =>
                              handleTaskInlineUpdate(t.id, {
                                adminGrade: v === t.adminGrade ? null : v,
                              })
                            }
                          />
                        </td>

                        {/* Comments */}
                        <td className="px-4 py-3 align-top">
                          <button
                            onClick={() => openComments(t)}
                            className="flex items-center gap-1 text-xs transition-colors hover:text-slate-700"
                            style={{
                              color: commentCount > 0 ? '#0E0E0E' : 'rgba(14,14,14,0.30)',
                            }}
                          >
                            <MessageSquare size={13} strokeWidth={1.5} />
                            {commentCount > 0 && (
                              <span className="font-medium">{commentCount}</span>
                            )}
                          </button>
                        </td>

                        {/* Actions */}
                        {showActionsCol && (
                          <td className="px-4 py-3 align-top">
                            {rowHasActions && (
                              <div className="flex items-center gap-2 justify-end">
                                <button
                                  onClick={() => openEditTask(t)}
                                  className="text-slate-300 hover:text-slate-500 transition-colors"
                                  title="Edit"
                                >
                                  <Pencil size={13} strokeWidth={1.5} />
                                </button>
                                <button
                                  onClick={() => setConfirmDelete({ type: 'task', id: t.id })}
                                  className="text-slate-300 hover:text-red-400 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 size={13} strokeWidth={1.5} />
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Render: Feedback section ──────────────────────────────────────────────

  const renderFeedbackReadOnly = (fb: PdpFeedback) => (
    <div className="card space-y-5">
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: 'rgba(14,14,14,0.45)' }}>
          Overall mentor experience
        </p>
        <StarRating value={fb.mentorRating} disabled size={18} />
      </div>
      {[
        { key: 'mostHelpful', label: 'What was most helpful' },
        { key: 'improvements', label: 'What could be improved' },
        { key: 'achievements', label: 'Personal reflection' },
        { key: 'nextFocus', label: 'Next period focus' },
      ].map(({ key, label }) => {
        const val = fb[key as keyof PdpFeedback] as string | null;
        return (
          <div key={key}>
            <p className="text-xs font-medium mb-1" style={{ color: 'rgba(14,14,14,0.45)' }}>
              {label}
            </p>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
              {val || <span style={{ color: 'rgba(14,14,14,0.30)' }}>Not provided</span>}
            </p>
          </div>
        );
      })}
    </div>
  );

  const renderFeedback = () => {
    if (!plan) return null;

    const today = getTodayStr();
    const periodEnd = plan.periodEnd;
    const windowStart = periodEnd ? getFeedbackWindowStart(periodEnd) : null;

    const isLocked = !!periodEnd && today > periodEnd;
    const isInWindow = !!windowStart && today >= windowStart && !isLocked;
    const beforeWindow = !!periodEnd && !isInWindow && !isLocked;

    const feedback = plan.feedback ?? null;
    const isSubmitted = !!feedback?.submittedAt;

    // ── Admin view ─────────────────────────────────────────────────────────
    if (adminFieldsActive) {
      return (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-700">Mentor Feedback</h3>
          {!isSubmitted ? (
            <div
              className="card flex flex-col items-center gap-2 py-10 text-center"
            >
              <ClipboardList
                size={32}
                strokeWidth={1.2}
                style={{ color: 'rgba(14,14,14,0.25)' }}
              />
              <p className="text-sm font-medium text-slate-500">No feedback submitted yet</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs" style={{ color: 'rgba(14,14,14,0.45)' }}>
                  Submitted on {fmtDate(feedback!.submittedAt)}
                </span>
              </div>
              {renderFeedbackReadOnly(feedback!)}
            </>
          )}
        </div>
      );
    }

    // ── Owner view ─────────────────────────────────────────────────────────

    // No period end set yet
    if (!periodEnd) {
      return (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-700">Mentor Feedback</h3>
          <div
            className="card flex flex-col items-center gap-2 py-10 text-center"
          >
            <ClipboardList
              size={32}
              strokeWidth={1.2}
              style={{ color: 'rgba(14,14,14,0.25)' }}
            />
            <p className="text-sm font-medium text-slate-500">Period end date not set</p>
            <p className="text-sm" style={{ color: 'rgba(14,14,14,0.40)' }}>
              Set your PDP period end date to enable the feedback form.
            </p>
          </div>
        </div>
      );
    }

    // Period ended
    if (isLocked) {
      return (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-700">Mentor Feedback</h3>
          {isSubmitted ? (
            <>
              <div className="flex items-center gap-3">
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' }}
                >
                  Submitted
                </span>
                <span className="text-xs" style={{ color: 'rgba(14,14,14,0.40)' }}>
                  {fmtDate(feedback!.submittedAt)} · Period ended {fmtDate(periodEnd)}
                </span>
              </div>
              {renderFeedbackReadOnly(feedback!)}
            </>
          ) : (
            <div className="card flex flex-col items-center gap-2 py-10 text-center">
              <ClipboardList
                size={32}
                strokeWidth={1.2}
                style={{ color: 'rgba(14,14,14,0.25)' }}
              />
              <p className="text-sm font-medium text-slate-500">Feedback window closed</p>
              <p className="text-sm" style={{ color: 'rgba(14,14,14,0.40)' }}>
                The PDP period ended {fmtDate(periodEnd)} without a submitted feedback.
              </p>
            </div>
          )}
        </div>
      );
    }

    // Active form (before window shown disabled, in window shown enabled)
    const formDisabled = beforeWindow;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-700">Mentor Feedback</h3>
          {isSubmitted && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' }}
            >
              Submitted {fmtDate(feedback!.submittedAt)}
            </span>
          )}
        </div>

        {beforeWindow && windowStart && (
          <div
            className="px-4 py-3 rounded-xl text-sm"
            style={{ backgroundColor: 'rgba(14,14,14,0.04)', color: 'rgba(14,14,14,0.55)' }}
          >
            Feedback will be available to submit from{' '}
            <strong>{fmtDate(windowStart)}</strong>{' '}
            (14 days before the period ends).
          </div>
        )}

        {isSubmitted && isInWindow && (
          <p className="text-xs" style={{ color: 'rgba(14,14,14,0.45)' }}>
            You can update your feedback until the period ends on {fmtDate(periodEnd)}.
          </p>
        )}

        <div
          className="card space-y-5"
          style={{ opacity: formDisabled ? 0.5 : 1, pointerEvents: formDisabled ? 'none' : undefined }}
        >
          {/* Overall rating */}
          <div>
            <label className="label">Overall mentor experience</label>
            <StarRating
              value={feedbackDraft.mentorRating}
              onChange={(v) =>
                setFeedbackDraft((f) => ({
                  ...f,
                  mentorRating: v === f.mentorRating ? null : v,
                }))
              }
              size={20}
            />
          </div>

          {/* Text fields */}
          {[
            {
              key: 'mostHelpful' as const,
              label: 'What was most helpful in your mentor sessions?',
              placeholder: 'Describe what helped you the most…',
            },
            {
              key: 'improvements' as const,
              label: 'What could be improved?',
              placeholder: 'Describe what could have been done differently…',
            },
            {
              key: 'achievements' as const,
              label: 'Personal reflection — what did you achieve this period?',
              placeholder: 'Reflect on your progress and achievements…',
            },
            {
              key: 'nextFocus' as const,
              label: 'What would you like to focus on in the next period?',
              placeholder: 'Describe your goals and focus areas for next period…',
            },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="label">{label}</label>
              <textarea
                className="input resize-none"
                rows={3}
                placeholder={placeholder}
                value={feedbackDraft[key]}
                onChange={(e) =>
                  setFeedbackDraft((f) => ({ ...f, [key]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>

        {isInWindow && (
          <div className="flex gap-3">
            <button
              className="btn-secondary flex-1"
              onClick={handleSaveFeedbackDraft}
              disabled={savingFeedback || submittingFeedback}
            >
              {savingFeedback ? 'Saving…' : 'Save draft'}
            </button>
            {isSubmitted ? (
              <button
                className="btn-accent flex-1"
                onClick={handleUpdateFeedback}
                disabled={savingFeedback || submittingFeedback}
              >
                {savingFeedback ? 'Updating…' : 'Update feedback'}
              </button>
            ) : (
              <button
                className="btn-accent flex-1"
                onClick={handleSubmitFeedback}
                disabled={savingFeedback || submittingFeedback}
              >
                {submittingFeedback ? 'Submitting…' : 'Submit feedback'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ─── Render: PDP content ────────────────────────────────────────────────────

  const renderPdpContent = () => (
    <div className="space-y-5">
      {renderPlanHeader()}
      {renderTabBar()}
      {activeSection === 'goals' && renderGoals()}
      {activeSection === 'tasks' && renderTasks()}
      {activeSection === 'feedback' && renderFeedback()}
    </div>
  );

  // ─── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isAdmin && selectedUserId && (
            <button
              onClick={() => {
                setSelectedUserId(null);
                setPlan(null);
              }}
              className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors -ml-1"
              style={{ color: 'rgba(14,14,14,0.45)' }}
            >
              <ChevronLeft size={18} strokeWidth={1.8} />
            </button>
          )}
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              {isAdmin && selectedUserId
                ? `${summaryItems.find((s) => s.userId === selectedUserId)?.userName ?? ''} — PDP`
                : 'PDP'}
            </h2>
            <p className="text-sm text-slate-400">
              {isAdmin
                ? selectedUserId
                  ? isViewingOwnPDP
                    ? 'Your personal development plan'
                    : 'Reviewing agent PDP — admin rating and comments are active'
                  : 'Personal development plans for all agents'
                : 'Your personal development plan'}
            </p>
          </div>
        </div>
      </div>

      {/* Main content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : isAdmin && !selectedUserId ? (
        summaryItems.length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={44} strokeWidth={1} />}
            message="No agents found"
          />
        ) : (
          renderAdminList()
        )
      ) : isAdmin && selectedUserId ? (
        plan ? (
          renderPdpContent()
        ) : isViewingOwnPDP ? (
          <EmptyState
            icon={<TrendingUp size={44} strokeWidth={1} />}
            message="You haven't created your PDP yet"
            action={
              <button className="btn-accent" onClick={() => setShowCreateModal(true)}>
                Create my PDP
              </button>
            }
          />
        ) : (
          <div className="card flex flex-col items-center gap-4 py-12 text-center">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: 'rgba(14,14,14,0.06)' }}
            >
              <TrendingUp size={24} strokeWidth={1.2} style={{ color: 'rgba(14,14,14,0.35)' }} />
            </div>
            <div>
              <p className="font-semibold text-slate-700 mb-1">No PDP yet</p>
              <p className="text-sm text-slate-400">This agent hasn't created their PDP yet.</p>
            </div>
          </div>
        )
      ) : !plan ? (
        <EmptyState
          icon={<TrendingUp size={44} strokeWidth={1} />}
          message="You haven't created your PDP yet"
          action={
            <button className="btn-accent" onClick={() => setShowCreateModal(true)}>
              Create my PDP
            </button>
          }
        />
      ) : (
        renderPdpContent()
      )}

      {/* ── Modals ── */}

      {/* Create PDP */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create my PDP"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Period start</label>
              <input
                type="date"
                className="input"
                value={createForm.periodStart}
                onChange={(e) => setCreateForm((f) => ({ ...f, periodStart: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Period end</label>
              <input
                type="date"
                className="input"
                value={createForm.periodEnd}
                onChange={(e) => setCreateForm((f) => ({ ...f, periodEnd: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-xs" style={{ color: 'rgba(14,14,14,0.45)' }}>
            You can set or change the period later.
          </p>
          <div className="flex gap-3 pt-1">
            <button
              className="btn-secondary flex-1"
              onClick={() => setShowCreateModal(false)}
            >
              Cancel
            </button>
            <button
              className="btn-accent flex-1"
              onClick={handleCreatePDP}
              disabled={creating}
            >
              {creating ? 'Creating…' : 'Create PDP'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit period */}
      <Modal open={showPeriodModal} onClose={() => setShowPeriodModal(false)} title="Edit period">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Period start</label>
              <input
                type="date"
                className="input"
                value={periodForm.periodStart}
                onChange={(e) => setPeriodForm((f) => ({ ...f, periodStart: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Period end</label>
              <input
                type="date"
                className="input"
                value={periodForm.periodEnd}
                onChange={(e) => setPeriodForm((f) => ({ ...f, periodEnd: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              className="btn-secondary flex-1"
              onClick={() => setShowPeriodModal(false)}
            >
              Cancel
            </button>
            <button
              className="btn-accent flex-1"
              onClick={handleSavePeriod}
              disabled={savingPeriod}
            >
              {savingPeriod ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add / Edit goal */}
      <Modal
        open={goalModal.open}
        onClose={() => setGoalModal({ open: false, editing: null })}
        title={
          goalModal.editing
            ? 'Edit goal'
            : adminFieldsActive
            ? `Assign goal`
            : 'Add goal'
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Goal *</label>
            <input
              className="input"
              placeholder="e.g. Improve first-contact resolution rate"
              value={goalForm.goal}
              onChange={(e) => setGoalForm((f) => ({ ...f, goal: e.target.value }))}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Specific actions</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Describe the specific steps to achieve this goal…"
              value={goalForm.specificActions}
              onChange={(e) => setGoalForm((f) => ({ ...f, specificActions: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Target date</label>
            <input
              type="date"
              className="input"
              value={goalForm.targetDate}
              onChange={(e) => setGoalForm((f) => ({ ...f, targetDate: e.target.value }))}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              className="btn-secondary flex-1"
              onClick={() => setGoalModal({ open: false, editing: null })}
            >
              Cancel
            </button>
            <button
              className="btn-accent flex-1"
              onClick={handleSaveGoal}
              disabled={savingGoal || !goalForm.goal.trim()}
            >
              {savingGoal
                ? 'Saving…'
                : goalModal.editing
                ? 'Save changes'
                : adminFieldsActive
                ? 'Assign goal'
                : 'Add goal'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add / Edit task */}
      <Modal
        open={taskModal.open}
        onClose={() => setTaskModal({ open: false, editing: null })}
        title={
          taskModal.editing
            ? 'Edit task'
            : adminFieldsActive
            ? 'Assign task'
            : 'Add task'
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Task *</label>
            <input
              className="input"
              placeholder="e.g. Complete e-learning module on de-escalation"
              value={taskForm.task}
              onChange={(e) => setTaskForm((f) => ({ ...f, task: e.target.value }))}
              autoFocus
            />
          </div>
          {plan && plan.goals.length > 0 && (
            <div>
              <label className="label">Related goal</label>
              <select
                className="input"
                value={taskForm.goalId}
                onChange={(e) => setTaskForm((f) => ({ ...f, goalId: e.target.value }))}
              >
                <option value="">No goal</option>
                {plan.goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.goal}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button
              className="btn-secondary flex-1"
              onClick={() => setTaskModal({ open: false, editing: null })}
            >
              Cancel
            </button>
            <button
              className="btn-accent flex-1"
              onClick={handleSaveTask}
              disabled={savingTask || !taskForm.task.trim()}
            >
              {savingTask
                ? 'Saving…'
                : taskModal.editing
                ? 'Save changes'
                : adminFieldsActive
                ? 'Assign task'
                : 'Add task'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Comments */}
      <Modal
        open={!!commentsTask}
        onClose={() => setCommentsTask(null)}
        title="Task comments"
        maxWidth="max-w-md"
      >
        {commentsTask && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-700 pb-2" style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}>
              {commentsTask.task}
            </p>

            {commentsTask.comments.length === 0 ? (
              <p className="text-sm text-center py-3" style={{ color: 'rgba(14,14,14,0.35)' }}>
                No comments yet
              </p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {commentsTask.comments.map((c, i) => (
                  <div key={i} className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-600">{c.authorName}</span>
                      <span className="text-xs" style={{ color: 'rgba(14,14,14,0.35)' }}>
                        {format(new Date(c.createdAt), 'dd MMM yyyy, HH:mm')}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 leading-snug">{c.text}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-1 space-y-2" style={{ borderTop: '1px solid rgba(14,14,14,0.07)' }}>
              <textarea
                className="input resize-none"
                rows={2}
                placeholder="Add a comment…"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddComment();
                }}
              />
              <div className="flex gap-2">
                <button
                  className="btn-secondary flex-1"
                  onClick={() => setCommentsTask(null)}
                >
                  Close
                </button>
                <button
                  className="btn-accent flex-1"
                  onClick={handleAddComment}
                  disabled={addingComment || !newComment.trim()}
                >
                  {addingComment ? 'Adding…' : 'Add comment'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!confirmDelete}
        message={
          confirmDelete?.type === 'goal'
            ? 'Delete this goal? Any tasks linked to it will be unlinked.'
            : 'Delete this task?'
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
