// client/src/pages/MyPlans.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, Trash2, CheckCircle2, Circle, ChevronDown, ChevronRight, X, Clock, Globe } from 'lucide-react';
import { format, getDaysInMonth } from 'date-fns';
import { getPlans, createPlan, updatePlan, deletePlan, getQuickLinks, createQuickLink, deleteQuickLink } from '../api';
import type { Plan, QuickLink } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

type Priority = 'high' | 'medium' | 'low';
type Category = 'work' | 'learning' | 'personal';
type PlanView = 'daily' | 'monthly' | 'links';

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

const VIEW_LABELS: Record<PlanView, string> = {
  daily: 'Today',
  monthly: 'This Month',
  links: 'Quick Links',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getThisMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getWeekForDay(day: number): 1 | 2 | 3 | 4 {
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

function sortPlans(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueTime && b.dueTime) {
      const tc = a.dueTime.localeCompare(b.dueTime);
      if (tc !== 0) return tc;
    } else if (a.dueTime) return -1;
    else if (b.dueTime) return 1;
    return (PRIORITY_SORT[a.priority] ?? 1) - (PRIORITY_SORT[b.priority] ?? 1);
  });
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

// ─── AddTaskInput ─────────────────────────────────────────────────────────────

interface AddTaskInputProps {
  view: 'daily' | 'monthly';
  today: string;
  thisMonth: string;
  daysInMonth: number;
  onAdd: (data: {
    title: string;
    priority: Priority;
    category: Category;
    dueTime: string | null;
    date: string;
  }) => Promise<void>;
}

function AddTaskInput({ view, today, thisMonth, daysInMonth, onAdd }: AddTaskInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [priority, setPriority] = useState<Priority>('medium');
  const [category, setCategory] = useState<Category>('work');
  const [dueTime, setDueTime] = useState('');
  const [showTime, setShowTime] = useState(false);
  const [taskDate, setTaskDate] = useState(today);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setTaskDate(today);
  }, [view, today]);

  const reset = () => {
    setText('');
    setPriority('medium');
    setCategory('work');
    setDueTime('');
    setShowTime(false);
    setTaskDate(today);
    setExpanded(false);
  };

  const handleSave = async () => {
    const title = text.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await onAdd({ title, priority, category, dueTime: dueTime || null, date: taskDate });
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

  const maxDate = `${thisMonth}-${String(daysInMonth).padStart(2, '0')}`;
  const minDate = `${thisMonth}-01`;

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
          placeholder={view === 'daily' ? 'Add a task for today…' : 'Add a goal for this month…'}
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
            Add
          </button>
        )}
      </div>

      {expanded && (
        <div className="pt-3 space-y-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium w-16 shrink-0" style={{ color: 'rgba(14,14,14,0.45)' }}>
              Priority
            </span>
            <div className="flex gap-1">
              {(['high', 'medium', 'low'] as Priority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
                  style={
                    priority === p
                      ? { ...PRIORITY_META[p].badge, outline: `1.5px solid currentColor` }
                      : { backgroundColor: 'rgba(14,14,14,0.05)', color: 'rgba(14,14,14,0.50)' }
                  }
                >
                  {PRIORITY_META[p].label}
                </button>
              ))}
            </div>
          </div>

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

            {view === 'monthly' && (
              <input
                type="date"
                className="input text-xs py-1 px-2 w-36"
                value={taskDate}
                min={minDate}
                max={maxDate}
                onChange={(e) => setTaskDate(e.target.value || today)}
              />
            )}

            {!showTime ? (
              <button
                type="button"
                className="text-xs flex items-center gap-1 transition-colors"
                style={{ color: 'rgba(14,14,14,0.40)' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowTime(true)}
              >
                <Clock size={12} strokeWidth={1.5} />
                Add time
              </button>
            ) : (
              <input
                type="time"
                className="input text-xs py-1 px-2 w-28"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
              />
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

function PlanItem({
  plan,
  showDate,
  onToggle,
  onDelete,
  onDismissCarryOver,
}: {
  plan: Plan;
  showDate?: boolean;
  onToggle: (p: Plan) => void;
  onDelete: (id: string) => void;
  onDismissCarryOver: (id: string) => void;
}) {
  const pm = PRIORITY_META[plan.priority] ?? PRIORITY_META.medium;
  const cm = CATEGORY_META[plan.category] ?? CATEGORY_META.work;
  const dateLabel = plan.date
    ? (() => { try { return format(new Date(plan.date + 'T00:00:00'), 'MMM d'); } catch { return plan.date; } })()
    : null;

  return (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 rounded-xl group transition-colors ${
        plan.completed ? '' : 'hover:bg-slate-50'
      }`}
      style={{ opacity: plan.completed ? 0.52 : 1 }}
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
          {showDate && dateLabel && (
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

      <button
        onClick={() => onDelete(plan.id)}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-all mt-0.5"
        style={{ color: 'rgba(14,14,14,0.25)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(14,14,14,0.25)')}
      >
        <Trash2 size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MyPlans() {
  const today = getTodayStr();
  const thisMonth = getThisMonthStr();

  const [view, setView] = useState<PlanView>('daily');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  // For monthly week expand/collapse
  const todayDay = new Date().getDate();
  const currentWeekNum = getWeekForDay(todayDay);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(() => {
    const s = new Set<number>();
    for (let w = currentWeekNum; w <= 4; w++) s.add(w);
    return s;
  });

  const [nowYear, nowMonth] = thisMonth.split('-').map(Number);
  const daysInCurrentMonth = getDaysInMonth(new Date(nowYear, nowMonth - 1));

  // ── Quick Links state ────────────────────────────────────────────────────────
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linkForm, setLinkForm] = useState({ title: '', url: '', category: '' });
  const [linkErrors, setLinkErrors] = useState({ title: false, url: false });
  const [linkSaving, setLinkSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── Load callbacks ───────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (view === 'links') return;
    setLoading(true);
    try {
      const date = view === 'daily' ? today : thisMonth;
      const data = await getPlans({ type: view, date });
      setPlans(sortPlans(data));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [view, today, thisMonth]);

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
  useEffect(() => { if (view === 'links') loadLinks(); }, [view, loadLinks]);

  // ── Plan handlers ────────────────────────────────────────────────────────────

  const handleAdd = async (data: {
    title: string;
    priority: Priority;
    category: Category;
    dueTime: string | null;
    date: string;
  }) => {
    if (view === 'links') return;
    const plan = await createPlan({ ...data, type: view });
    setPlans((prev) => sortPlans([plan, ...prev]));
  };

  const handleToggle = async (plan: Plan) => {
    const optimistic = { ...plan, completed: !plan.completed };
    setPlans((prev) => sortPlans(prev.map((p) => (p.id === plan.id ? optimistic : p))));
    try {
      const updated = await updatePlan(plan.id, { completed: !plan.completed });
      setPlans((prev) => sortPlans(prev.map((p) => (p.id === plan.id ? updated : p))));
    } catch (e) {
      console.error(e);
      setPlans((prev) => sortPlans(prev.map((p) => (p.id === plan.id ? plan : p))));
    }
  };

  const handleDelete = async (id: string) => {
    setPlans((prev) => prev.filter((p) => p.id !== id));
    try { await deletePlan(id); } catch (e) { console.error(e); load(); }
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

  // ── Today view ───────────────────────────────────────────────────────────────

  const pending = plans.filter((p) => !p.completed);
  const done = plans.filter((p) => p.completed);
  const allDone = plans.length > 0 && pending.length === 0;

  const renderTodayView = () => (
    <div className="space-y-1">
      {allDone && (
        <div className="py-5 text-center space-y-1">
          <div className="flex items-center justify-center gap-2">
            <CheckCircle2 size={20} strokeWidth={1.5} style={{ color: '#A1F96E' }} />
            <span className="text-sm font-semibold text-slate-700">All done for today</span>
          </div>
          <p className="text-xs" style={{ color: 'rgba(14,14,14,0.40)' }}>
            Great work — everything is checked off.
          </p>
        </div>
      )}

      {pending.map((plan) => (
        <PlanItem
          key={plan.id}
          plan={plan}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onDismissCarryOver={handleDismissCarryOver}
        />
      ))}

      {done.length > 0 && (
        <>
          {pending.length > 0 && <div className="h-px my-2" style={{ backgroundColor: 'rgba(14,14,14,0.06)' }} />}
          <p className="text-xs px-3 mb-0.5" style={{ color: 'rgba(14,14,14,0.38)' }}>
            Completed ({done.length})
          </p>
          {done.map((plan) => (
            <PlanItem
              key={plan.id}
              plan={plan}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onDismissCarryOver={handleDismissCarryOver}
            />
          ))}
        </>
      )}
    </div>
  );

  // ── Monthly view ─────────────────────────────────────────────────────────────

  interface WeekGroup {
    week: 1 | 2 | 3 | 4;
    label: string;
    startDay: number;
    endDay: number;
    tasks: Plan[];
    isPast: boolean;
    isCurrent: boolean;
  }

  const weekGroups: WeekGroup[] = ([1, 2, 3, 4] as const).reduce<WeekGroup[]>((acc, w) => {
    const startDays = [1, 8, 15, 22] as const;
    const endDays = [7, 14, 21, daysInCurrentMonth] as const;
    const startDay = startDays[w - 1];
    const endDay = endDays[w - 1];

    if (startDay > daysInCurrentMonth) return acc;

    const fmt = (d: number) =>
      format(new Date(nowYear, nowMonth - 1, Math.min(d, daysInCurrentMonth)), 'MMM d');
    const label = `${fmt(startDay)}–${fmt(endDay)}`;

    const weekTasks = sortPlans(
      plans.filter((p) => {
        const day = parseInt((p.date ?? '').split('-')[2] ?? '1', 10) || 1;
        return getWeekForDay(day) === w;
      }),
    );

    acc.push({
      week: w,
      label,
      startDay,
      endDay,
      tasks: weekTasks,
      isPast: w < currentWeekNum,
      isCurrent: w === currentWeekNum,
    });
    return acc;
  }, []);

  const toggleWeek = (w: number) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(w)) next.delete(w); else next.add(w);
      return next;
    });
  };

  const renderMonthView = () => (
    <div className="space-y-2">
      {weekGroups.map(({ week, label, tasks, isPast, isCurrent }) => {
        const isExpanded = expandedWeeks.has(week);
        const doneTasks = tasks.filter((t) => t.completed).length;
        const isFuture = !isPast && !isCurrent;

        return (
          <div
            key={week}
            className="card p-0 overflow-hidden"
            style={{ opacity: isFuture ? 0.75 : 1 }}
          >
            <button
              onClick={() => toggleWeek(week)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
            >
              <span className="text-sm font-semibold text-slate-700">Week {week}</span>
              <span className="text-xs font-medium" style={{ color: 'rgba(14,14,14,0.45)' }}>
                {label}
              </span>
              {isCurrent && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' }}
                >
                  This week
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {tasks.length > 0 && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: 'rgba(14,14,14,0.07)', color: 'rgba(14,14,14,0.55)' }}
                  >
                    {doneTasks}/{tasks.length} done
                  </span>
                )}
                {isExpanded ? (
                  <ChevronDown size={15} strokeWidth={1.8} style={{ color: 'rgba(14,14,14,0.35)' }} />
                ) : (
                  <ChevronRight size={15} strokeWidth={1.8} style={{ color: 'rgba(14,14,14,0.35)' }} />
                )}
              </div>
            </button>

            {isExpanded && (
              <div style={{ borderTop: '1px solid rgba(14,14,14,0.06)' }}>
                {tasks.length === 0 ? (
                  <p className="px-4 py-3 text-xs" style={{ color: 'rgba(14,14,14,0.35)' }}>
                    No tasks for this week
                  </p>
                ) : (
                  <div className="py-1 space-y-0.5">
                    {tasks.map((plan) => (
                      <PlanItem
                        key={plan.id}
                        plan={plan}
                        showDate
                        onToggle={handleToggle}
                        onDelete={handleDelete}
                        onDismissCarryOver={handleDismissCarryOver}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
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
  const completedCount = done.length;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">My Plans</h2>
          <p className="text-sm text-slate-400">Personal — visible only to you</p>
        </div>
        {view === 'daily' && totalCount > 0 && (
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
        {(['daily', 'monthly', 'links'] as PlanView[]).map((v) => (
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

      {/* Add task input — plan views only */}
      {view !== 'links' && (
        <AddTaskInput
          view={view as 'daily' | 'monthly'}
          today={today}
          thisMonth={thisMonth}
          daysInMonth={daysInCurrentMonth}
          onAdd={handleAdd}
        />
      )}

      {/* Content */}
      {view === 'links' ? (
        renderLinksView()
      ) : loading ? (
        <div className="py-10 text-center text-sm" style={{ color: 'rgba(14,14,14,0.38)' }}>
          Loading…
        </div>
      ) : plans.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: 'rgba(14,14,14,0.38)' }}>
          No {view === 'daily' ? 'tasks for today' : 'goals this month'} yet — add one above.
        </div>
      ) : view === 'daily' ? (
        renderTodayView()
      ) : (
        renderMonthView()
      )}
    </div>
  );
}
