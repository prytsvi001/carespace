// client/src/pages/MyPlans.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, Trash2, Pencil, CheckCircle2, Circle, X, Clock, Globe } from 'lucide-react';
import { format, addDays, endOfWeek, isSameDay, isSameMonth } from 'date-fns';
import { getPlans, createPlan, updatePlan, deletePlan, getQuickLinks, createQuickLink, deleteQuickLink } from '../api';
import type { Plan, QuickLink } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

type Priority = 'high' | 'medium' | 'low';
type Category = 'work' | 'learning' | 'personal';
type TopView = 'tasks' | 'links';
type BucketKey = 'today' | 'tomorrow' | 'thisWeek' | 'thisMonth' | 'later' | 'noDate';

const PRIORITY_SORT: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

const PRIORITY_META: Record<Priority, { label: string; dot: string; badge: React.CSSProperties }> = {
  high: {
    label: 'High',
    dot: '#f87171',
    badge: { backgroundColor: 'rgba(239,68,68,0.10)', color: '#b91c1c' },
  },
  medium: {
    label: 'Medium',
    dot: '#fbbf24',
    badge: { backgroundColor: 'rgba(245,158,11,0.10)', color: '#b45309' },
  },
  low: {
    label: 'Low',
    dot: 'rgba(14,14,14,0.22)',
    badge: { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.45)' },
  },
};

const CATEGORY_META: Record<Category, { label: string; style: React.CSSProperties }> = {
  work: { label: 'Work', style: { backgroundColor: 'rgba(59,130,246,0.10)', color: '#2563eb' } },
  learning: { label: 'Learning', style: { backgroundColor: 'rgba(139,92,246,0.10)', color: '#7c3aed' } },
  personal: { label: 'Personal', style: { backgroundColor: 'rgba(161,249,110,0.22)', color: 'rgba(14,14,14,0.65)' } },
};

const LINK_CAT_META: Record<string, { label: string; style: React.CSSProperties }> = {
  sheets: { label: 'Sheets', style: { backgroundColor: 'rgba(34,197,94,0.10)', color: '#15803d' } },
  docs:   { label: 'Docs',   style: { backgroundColor: 'rgba(59,130,246,0.10)', color: '#2563eb' } },
  tools:  { label: 'Tools',  style: { backgroundColor: 'rgba(139,92,246,0.10)', color: '#7c3aed' } },
  jira:   { label: 'Jira',   style: { backgroundColor: 'rgba(37,99,235,0.12)', color: '#1e40af' } },
  other:  { label: 'Other',  style: { backgroundColor: 'rgba(14,14,14,0.07)', color: 'rgba(14,14,14,0.55)' } },
};

const LINK_KNOWN_CATS = ['sheets', 'docs', 'tools', 'jira'] as const;

const VIEW_LABELS: Record<TopView, string> = {
  tasks: 'Tasks',
  links: 'Quick Links',
};

const SECTIONS: { key: BucketKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'later', label: 'Later' },
  { key: 'noDate', label: 'No date' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getBucket(
  plan: Plan,
  ctx: { today: Date; tomorrow: Date; weekEnd: Date },
): BucketKey {
  if (!plan.date) return 'noDate';

  // Legacy "YYYY-MM" (month-only) values from the old monthly-goals view have no day component.
  if (plan.date.length < 10) {
    const [y, m] = plan.date.split('-').map(Number);
    const isCurrentMonth = y === ctx.today.getFullYear() && m === ctx.today.getMonth() + 1;
    return isCurrentMonth ? 'thisMonth' : 'later';
  }

  let d: Date;
  try {
    d = new Date(plan.date + 'T00:00:00');
  } catch {
    return 'noDate';
  }
  if (isNaN(d.getTime())) return 'noDate';

  if (d < ctx.today || isSameDay(d, ctx.today)) return 'today';
  if (isSameDay(d, ctx.tomorrow)) return 'tomorrow';
  if (d <= ctx.weekEnd) return 'thisWeek';
  if (isSameMonth(d, ctx.today)) return 'thisMonth';
  return 'later';
}

function sortWithinSection(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const pd = (PRIORITY_SORT[a.priority] ?? 1) - (PRIORITY_SORT[b.priority] ?? 1);
    if (pd !== 0) return pd;
    if (a.dueTime && b.dueTime) return a.dueTime.localeCompare(b.dueTime);
    if (a.dueTime) return -1;
    if (b.dueTime) return 1;
    return 0;
  });
}

function formatDateLabel(dateStr: string): string {
  if (dateStr.length < 10) {
    const [y, m] = dateStr.split('-').map(Number);
    try { return format(new Date(y, m - 1, 1), 'MMM yyyy'); } catch { return dateStr; }
  }
  try { return format(new Date(dateStr + 'T00:00:00'), 'MMM d'); } catch { return dateStr; }
}

function validateUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

// ─── Favicon ──────────────────────────────────────────────────────────────────

function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  let domain = '';
  try { domain = new URL(url).hostname; } catch { /* ignore */ }
  if (!domain || failed) {
    return <Globe size={14} strokeWidth={1.5} className="shrink-0" style={{ color: 'rgba(14,14,14,0.30)' }} />;
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
      alt=""
      className="w-4 h-4 rounded-sm shrink-0 object-contain"
      onError={() => setFailed(true)}
    />
  );
}

// ─── Shared field controls (add form + edit form) ──────────────────────────────

function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-medium w-16 shrink-0" style={{ color: 'rgba(14,14,14,0.45)' }}>
        Priority
      </span>
      <div className="flex gap-1">
        {(['high', 'medium', 'low'] as Priority[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
            style={
              value === p
                ? { ...PRIORITY_META[p].badge, outline: `1.5px solid currentColor` }
                : { backgroundColor: 'rgba(14,14,14,0.05)', color: 'rgba(14,14,14,0.50)' }
            }
          >
            {PRIORITY_META[p].label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── AddTaskInput ─────────────────────────────────────────────────────────────

interface AddTaskInputProps {
  onAdd: (data: {
    title: string;
    priority: Priority;
    category: Category;
    date: string | null;
    dueTime: string | null;
  }) => Promise<void>;
}

function AddTaskInput({ onAdd }: AddTaskInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [priority, setPriority] = useState<Priority>('medium');
  const [category, setCategory] = useState<Category>('work');
  const [showDueDate, setShowDueDate] = useState(false);
  const [taskDate, setTaskDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [adding, setAdding] = useState(false);

  const reset = () => {
    setText('');
    setPriority('medium');
    setCategory('work');
    setShowDueDate(false);
    setTaskDate('');
    setDueTime('');
    setExpanded(false);
  };

  const handleSave = async () => {
    const title = text.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await onAdd({ title, priority, category, date: taskDate || null, dueTime: dueTime || null });
      reset();
    } catch (e) {
      console.error(e);
    } finally {
      setAdding(false);
    }
  };

  const handleContainerBlur = (e: React.FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      if (!text.trim()) reset();
    }
  };

  return (
    <div
      ref={containerRef}
      onBlur={handleContainerBlur}
      className="card p-3 space-y-0"
      style={{ transition: 'all 0.15s ease' }}
    >
      <div className="flex gap-2">
        <input
          ref={inputRef}
          className="input flex-1 text-sm"
          placeholder="Add a task…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') { reset(); inputRef.current?.blur(); }
          }}
        />
        {!expanded && (
          <button
            className="btn-accent flex items-center gap-1.5 shrink-0 text-sm"
            onClick={() => { setExpanded(true); inputRef.current?.focus(); }}
          >
            <Plus size={15} strokeWidth={2} />
            Add task
          </button>
        )}
      </div>

      {expanded && (
        <div className="pt-3 space-y-2.5">
          <PriorityPicker value={priority} onChange={setPriority} />

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium w-16 shrink-0" style={{ color: 'rgba(14,14,14,0.45)' }}>
              Category
            </span>
            <select
              className="input text-xs py-1 px-2 w-32"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              <option value="work">Work</option>
              <option value="learning">Learning</option>
              <option value="personal">Personal</option>
            </select>

            {!showDueDate ? (
              <button
                type="button"
                className="text-xs flex items-center gap-1 transition-colors"
                style={{ color: 'rgba(14,14,14,0.40)' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowDueDate(true)}
              >
                <Clock size={12} strokeWidth={1.5} />
                Add due date
              </button>
            ) : (
              <>
                <input
                  type="date"
                  className="input text-xs py-1 px-2 w-36"
                  value={taskDate}
                  onChange={(e) => setTaskDate(e.target.value)}
                />
                <input
                  type="time"
                  className="input text-xs py-1 px-2 w-28"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                />
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setShowDueDate(false); setTaskDate(''); setDueTime(''); }}
                  style={{ color: 'rgba(14,14,14,0.35)' }}
                  title="Remove due date"
                >
                  <X size={13} strokeWidth={1.5} />
                </button>
              </>
            )}
          </div>

          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              className="btn-secondary text-xs"
              onMouseDown={(e) => e.preventDefault()}
              onClick={reset}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-accent text-xs flex-1 flex items-center justify-center gap-1.5"
              onClick={handleSave}
              disabled={adding || !text.trim()}
            >
              <Plus size={13} strokeWidth={2} />
              {adding ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PlanItem ─────────────────────────────────────────────────────────────────

interface PlanEditData {
  title: string;
  priority: Priority;
  category: Category;
  date: string | null;
  dueTime: string | null;
}

function PlanItem({
  plan,
  isFirst,
  onToggle,
  onSave,
  onDelete,
  onDismissCarryOver,
}: {
  plan: Plan;
  isFirst: boolean;
  onToggle: (p: Plan) => void;
  onSave: (id: string, data: PlanEditData) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDismissCarryOver: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [eText, setEText] = useState(plan.title);
  const [ePriority, setEPriority] = useState<Priority>(plan.priority);
  const [eCategory, setECategory] = useState<Category>(plan.category);
  const [eDate, setEDate] = useState(plan.date && plan.date.length >= 10 ? plan.date : '');
  const [eTime, setETime] = useState(plan.dueTime ?? '');

  const borderStyle = isFirst ? undefined : { borderTop: '1px solid rgba(14,14,14,0.06)' };

  const startEdit = () => {
    setEText(plan.title);
    setEPriority(plan.priority);
    setECategory(plan.category);
    setEDate(plan.date && plan.date.length >= 10 ? plan.date : '');
    setETime(plan.dueTime ?? '');
    setConfirmingDelete(false);
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    const title = eText.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      await onSave(plan.id, { title, priority: ePriority, category: eCategory, date: eDate || null, dueTime: eTime || null });
      setEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(plan.id);
    } catch (e) {
      console.error(e);
      setDeleting(false);
    }
  };

  if (editing) {
    return (
      <div className="px-3 py-3 space-y-2.5" style={borderStyle}>
        <input
          className="input text-sm w-full"
          value={eText}
          autoFocus
          onChange={(e) => setEText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <PriorityPicker value={ePriority} onChange={setEPriority} />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium w-16 shrink-0" style={{ color: 'rgba(14,14,14,0.45)' }}>
            Category
          </span>
          <select
            className="input text-xs py-1 px-2 w-32"
            value={eCategory}
            onChange={(e) => setECategory(e.target.value as Category)}
          >
            <option value="work">Work</option>
            <option value="learning">Learning</option>
            <option value="personal">Personal</option>
          </select>
          <input
            type="date"
            className="input text-xs py-1 px-2 w-36"
            value={eDate}
            onChange={(e) => setEDate(e.target.value)}
          />
          <input
            type="time"
            className="input text-xs py-1 px-2 w-28"
            value={eTime}
            onChange={(e) => setETime(e.target.value)}
          />
        </div>
        <div className="flex gap-2 pt-0.5">
          <button type="button" className="btn-secondary text-xs" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-accent text-xs flex-1 flex items-center justify-center gap-1.5"
            onClick={handleSaveEdit}
            disabled={saving || !eText.trim()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  const pm = PRIORITY_META[plan.priority] ?? PRIORITY_META.medium;
  const cm = CATEGORY_META[plan.category] ?? CATEGORY_META.work;
  const dateLabel = plan.date ? formatDateLabel(plan.date) : null;

  return (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 group transition-colors ${
        plan.completed ? '' : 'hover:bg-slate-50'
      }`}
      style={{ opacity: plan.completed ? 0.52 : 1, ...borderStyle }}
    >
      <button
        onClick={() => onToggle(plan)}
        className="shrink-0 mt-0.5 transition-colors"
        style={{ color: plan.completed ? '#A1F96E' : 'rgba(14,14,14,0.28)' }}
      >
        {plan.completed ? (
          <CheckCircle2 size={18} strokeWidth={1.5} />
        ) : (
          <Circle size={18} strokeWidth={1.5} />
        )}
      </button>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="shrink-0 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pm.dot }} />
          <span
            className={`text-sm leading-snug ${plan.completed ? 'line-through' : 'text-slate-700'}`}
            style={{ color: plan.completed ? 'rgba(14,14,14,0.40)' : undefined }}
          >
            {plan.title}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {plan.dueTime && (
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5"
              style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.55)' }}
            >
              <Clock size={10} strokeWidth={1.5} />
              {plan.dueTime}
            </span>
          )}
          <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={cm.style}>
            {cm.label}
          </span>
          {dateLabel && (
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: 'rgba(14,14,14,0.05)', color: 'rgba(14,14,14,0.45)' }}
            >
              {dateLabel}
            </span>
          )}
          {plan.carriedOver && !plan.carriedOverDismissed && (
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium flex items-center gap-1"
              style={{ backgroundColor: 'rgba(245,158,11,0.10)', color: '#b45309' }}
            >
              carried over
              <button
                onClick={(e) => { e.stopPropagation(); onDismissCarryOver(plan.id); }}
                className="hover:opacity-60 transition-opacity"
                title="Dismiss"
              >
                <X size={10} strokeWidth={2} />
              </button>
            </span>
          )}
        </div>
      </div>

      {confirmingDelete ? (
        <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
          <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>
            Delete this task?
          </span>
          <button
            onClick={handleConfirmDelete}
            disabled={deleting}
            className="text-xs text-red-500 font-medium hover:text-red-700 transition-colors"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirmingDelete(false)}
            className="text-xs hover:text-slate-600 transition-colors"
            style={{ color: 'rgba(14,14,14,0.40)' }}
          >
            No
          </button>
        </div>
      ) : (
        <div className="shrink-0 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all mt-0.5">
          <button
            onClick={startEdit}
            style={{ color: 'rgba(14,14,14,0.30)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#0E0E0E')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(14,14,14,0.30)')}
            title="Edit"
          >
            <Pencil size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            style={{ color: 'rgba(14,14,14,0.25)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(14,14,14,0.25)')}
            title="Delete"
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MyPlans() {
  const [view, setView] = useState<TopView>('tasks');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Quick Links state ────────────────────────────────────────────────────────
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linkForm, setLinkForm] = useState({ title: '', url: '', category: '' });
  const [linkErrors, setLinkErrors] = useState({ title: false, url: false });
  const [linkSaving, setLinkSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── Load callbacks ───────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPlans();
      setPlans(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLinks = useCallback(async () => {
    setLinksLoading(true);
    try {
      const data = await getQuickLinks();
      setLinks(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLinksLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (view === 'links' && links.length === 0) loadLinks(); }, [view, loadLinks, links.length]);

  // ── Plan handlers ────────────────────────────────────────────────────────────

  const handleAdd = async (data: {
    title: string;
    priority: Priority;
    category: Category;
    date: string | null;
    dueTime: string | null;
  }) => {
    const plan = await createPlan(data);
    setPlans((prev) => [plan, ...prev]);
  };

  const handleToggle = async (plan: Plan) => {
    const optimistic = { ...plan, completed: !plan.completed };
    setPlans((prev) => prev.map((p) => (p.id === plan.id ? optimistic : p)));
    try {
      const updated = await updatePlan(plan.id, { completed: !plan.completed });
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? updated : p)));
    } catch (e) {
      console.error(e);
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? plan : p)));
    }
  };

  const handleSaveEdit = async (id: string, data: PlanEditData) => {
    const updated = await updatePlan(id, data);
    setPlans((prev) => prev.map((p) => (p.id === id ? updated : p)));
  };

  const handleDelete = async (id: string) => {
    await deletePlan(id);
    setPlans((prev) => prev.filter((p) => p.id !== id));
  };

  const handleDismissCarryOver = async (id: string) => {
    setPlans((prev) =>
      prev.map((p) => (p.id === id ? { ...p, carriedOverDismissed: true } : p)),
    );
    try { await updatePlan(id, { carriedOverDismissed: true }); } catch (e) { console.error(e); }
  };

  // ── Link handlers ────────────────────────────────────────────────────────────

  const handleAddLink = async () => {
    const errors = {
      title: !linkForm.title.trim(),
      url: !linkForm.url.trim() || !validateUrl(linkForm.url),
    };
    setLinkErrors(errors);
    if (errors.title || errors.url) return;

    setLinkSaving(true);
    try {
      const link = await createQuickLink(linkForm);
      setLinks((prev) => [link, ...prev]);
      setLinkForm({ title: '', url: '', category: '' });
      setLinkErrors({ title: false, url: false });
    } catch (e) {
      console.error(e);
    } finally {
      setLinkSaving(false);
    }
  };

  const handleDeleteLink = async (id: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== id));
    setConfirmDeleteId(null);
    try {
      await deleteQuickLink(id);
    } catch (e) {
      console.error(e);
      loadLinks();
    }
  };

  // ── Task grouping ────────────────────────────────────────────────────────────

  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowDate = addDays(todayDate, 1);
  const weekEndDate = endOfWeek(todayDate, { weekStartsOn: 1 });

  const grouped: Record<BucketKey, Plan[]> = {
    today: [], tomorrow: [], thisWeek: [], thisMonth: [], later: [], noDate: [],
  };
  for (const p of plans) {
    grouped[getBucket(p, { today: todayDate, tomorrow: tomorrowDate, weekEnd: weekEndDate })].push(p);
  }
  for (const key of Object.keys(grouped) as BucketKey[]) {
    grouped[key] = sortWithinSection(grouped[key]);
  }

  const renderTasksView = () => (
    <div className="space-y-4">
      {SECTIONS.map(({ key, label }) => {
        const items = grouped[key];
        if (items.length === 0) return null;
        return (
          <div key={key} className="space-y-1.5">
            <p
              className="text-[10px] uppercase tracking-widest font-semibold px-1"
              style={{ color: 'rgba(14,14,14,0.38)' }}
            >
              {label} <span style={{ opacity: 0.65 }}>({items.length})</span>
            </p>
            <div className="card p-0 overflow-hidden">
              {items.map((plan, idx) => (
                <PlanItem
                  key={plan.id}
                  plan={plan}
                  isFirst={idx === 0}
                  onToggle={handleToggle}
                  onSave={handleSaveEdit}
                  onDelete={handleDelete}
                  onDismissCarryOver={handleDismissCarryOver}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ── Links view ───────────────────────────────────────────────────────────────

  const renderLinksView = () => {
    // Group links: known categories first, then "Other" (category 'other' or '')
    const knownCatSet = new Set(LINK_KNOWN_CATS as readonly string[]);
    const groups: { key: string; label: string; items: QuickLink[] }[] = [];

    for (const cat of LINK_KNOWN_CATS) {
      const items = links.filter((l) => l.category === cat);
      if (items.length > 0) {
        groups.push({ key: cat, label: LINK_CAT_META[cat].label, items });
      }
    }

    const otherItems = links.filter((l) => !knownCatSet.has(l.category));
    if (otherItems.length > 0) {
      groups.push({ key: '__other', label: 'Other', items: otherItems });
    }

    return (
      <div className="space-y-4">
        {/* Add link form */}
        <div className="card p-3">
          <div className="flex flex-wrap gap-2 items-start">
            {/* Title */}
            <div className="flex-1 min-w-[130px]">
              <input
                className={`input text-sm w-full ${linkErrors.title ? 'border-red-300 focus:border-red-400' : ''}`}
                placeholder="Title"
                value={linkForm.title}
                onChange={(e) => {
                  setLinkForm((f) => ({ ...f, title: e.target.value }));
                  setLinkErrors((f) => ({ ...f, title: false }));
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddLink(); }}
              />
              {linkErrors.title && (
                <p className="text-[10px] text-red-500 mt-1 pl-0.5">Title is required</p>
              )}
            </div>

            {/* URL */}
            <div className="flex-1 min-w-[160px]">
              <input
                className={`input text-sm w-full ${linkErrors.url ? 'border-red-300 focus:border-red-400' : ''}`}
                placeholder="https://…"
                value={linkForm.url}
                onChange={(e) => {
                  setLinkForm((f) => ({ ...f, url: e.target.value }));
                  setLinkErrors((f) => ({ ...f, url: false }));
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddLink(); }}
              />
              {linkErrors.url && (
                <p className="text-[10px] text-red-500 mt-1 pl-0.5">
                  {!linkForm.url.trim() ? 'URL is required' : 'Must start with http:// or https://'}
                </p>
              )}
            </div>

            {/* Category */}
            <select
              className="input text-sm py-2 px-2.5 w-32 shrink-0"
              value={linkForm.category}
              onChange={(e) => setLinkForm((f) => ({ ...f, category: e.target.value }))}
            >
              <option value="">No category</option>
              <option value="sheets">Sheets</option>
              <option value="docs">Docs</option>
              <option value="tools">Tools</option>
              <option value="jira">Jira</option>
              <option value="other">Other</option>
            </select>

            {/* Save */}
            <button
              className="btn-accent text-sm shrink-0 flex items-center gap-1.5"
              onClick={handleAddLink}
              disabled={linkSaving}
            >
              <Plus size={14} strokeWidth={2} />
              {linkSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Link list */}
        {linksLoading ? (
          <div className="py-8 text-center text-sm" style={{ color: 'rgba(14,14,14,0.38)' }}>
            Loading…
          </div>
        ) : links.length === 0 ? (
          <div className="py-10 text-center text-sm" style={{ color: 'rgba(14,14,14,0.38)' }}>
            No links yet — add your first above.
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.key}>
                <p
                  className="text-[10px] uppercase tracking-widest font-semibold mb-1.5 px-1"
                  style={{ color: 'rgba(14,14,14,0.38)' }}
                >
                  {group.label}
                </p>
                <div className="card p-0 overflow-hidden">
                  {group.items.map((link, idx) => (
                    <div
                      key={link.id}
                      className="flex items-center gap-3 px-3 py-2.5 group"
                      style={idx > 0 ? { borderTop: '1px solid rgba(14,14,14,0.06)' } : undefined}
                    >
                      <Favicon url={link.url} />

                      <div className="flex-1 min-w-0">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors block truncate"
                        >
                          {link.title}
                        </a>
                        <span
                          className="text-xs block truncate"
                          style={{ color: 'rgba(14,14,14,0.38)' }}
                        >
                          {link.url}
                        </span>
                      </div>

                      {link.category && LINK_CAT_META[link.category] && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium shrink-0"
                          style={LINK_CAT_META[link.category].style}
                        >
                          {LINK_CAT_META[link.category].label}
                        </span>
                      )}

                      {confirmDeleteId === link.id ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>Delete?</span>
                          <button
                            onClick={() => handleDeleteLink(link.id)}
                            className="text-xs text-red-500 font-medium hover:text-red-700 transition-colors"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs hover:text-slate-600 transition-colors"
                            style={{ color: 'rgba(14,14,14,0.40)' }}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(link.id)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 transition-all"
                          style={{ color: 'rgba(14,14,14,0.25)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(14,14,14,0.25)')}
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <p className="text-xs text-center" style={{ color: 'rgba(14,14,14,0.30)' }}>
              To edit a link, delete and re-add it.
            </p>
          </div>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const totalCount = plans.length;
  const completedCount = plans.filter((p) => p.completed).length;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">My Plans</h2>
          <p className="text-sm text-slate-400">Personal — visible only to you</p>
        </div>
        {view === 'tasks' && totalCount > 0 && (
          <span
            className="text-xs px-2 py-1 rounded-full font-medium shrink-0"
            style={{ backgroundColor: 'rgba(14,14,14,0.07)', color: 'rgba(14,14,14,0.55)' }}
          >
            {completedCount} / {totalCount} completed
          </span>
        )}
      </div>

      {/* Tab toggle */}
      <div
        className="flex rounded-lg overflow-hidden text-sm w-fit"
        style={{ border: '1px solid rgba(14,14,14,0.12)' }}
      >
        {(['tasks', 'links'] as TopView[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-4 py-1.5 font-medium transition-colors"
            style={
              view === v
                ? { backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' }
                : { backgroundColor: '#ffffff', color: 'rgba(14,14,14,0.50)' }
            }
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>

      {/* Add task input — tasks view only */}
      {view === 'tasks' && <AddTaskInput onAdd={handleAdd} />}

      {/* Content */}
      {view === 'links' ? (
        renderLinksView()
      ) : loading ? (
        <div className="py-10 text-center text-sm" style={{ color: 'rgba(14,14,14,0.38)' }}>
          Loading…
        </div>
      ) : plans.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: 'rgba(14,14,14,0.38)' }}>
          No tasks yet — add one above.
        </div>
      ) : (
        renderTasksView()
      )}
    </div>
  );
}
