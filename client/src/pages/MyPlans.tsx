// client/src/pages/MyPlans.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, Trash2, CheckCircle2, Circle, ChevronDown, ChevronRight, X, Clock } from 'lucide-react';
import { format, getDaysInMonth } from 'date-fns';
import { getPlans, createPlan, updatePlan, deletePlan } from '../api';
import type { Plan } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

type Priority = 'high' | 'medium' | 'low';
type Category = 'work' | 'learning' | 'personal';
type PlanView = 'daily' | 'monthly';

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

// ─── AddTaskInput ─────────────────────────────────────────────────────────────

interface AddTaskInputProps {
  view: PlanView;
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

  // Reset task date when view changes
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
      {/* Main text input row */}
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

      {/* Expanded options */}
      {expanded && (
        <div className="pt-3 space-y-2.5">
          {/* Priority */}
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

          {/* Category + Date (monthly) + Time */}
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

          {/* Action buttons */}
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
      {/* Checkbox */}
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

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Priority dot */}
          <span
            className="shrink-0 w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: pm.dot }}
          />
          {/* Title */}
          <span
            className={`text-sm leading-snug ${plan.completed ? 'line-through' : 'text-slate-700'}`}
            style={{ color: plan.completed ? 'rgba(14,14,14,0.40)' : undefined }}
          >
            {plan.title}
          </span>
        </div>

        {/* Badges row */}
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

      {/* Delete */}
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

  // Month info
  const [nowYear, nowMonth] = thisMonth.split('-').map(Number);
  const daysInCurrentMonth = getDaysInMonth(new Date(nowYear, nowMonth - 1));

  const load = useCallback(async () => {
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

  useEffect(() => { load(); }, [load]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleAdd = async (data: {
    title: string;
    priority: Priority;
    category: Category;
    dueTime: string | null;
    date: string;
  }) => {
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

  // ── Today view ───────────────────────────────────────────────────────────────

  const pending = plans.filter((p) => !p.completed);
  const done = plans.filter((p) => p.completed);
  const allDone = plans.length > 0 && pending.length === 0;

  const renderTodayView = () => (
    <div className="space-y-1">
      {/* All-done celebration */}
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

      {/* Pending */}
      {pending.map((plan) => (
        <PlanItem
          key={plan.id}
          plan={plan}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onDismissCarryOver={handleDismissCarryOver}
        />
      ))}

      {/* Completed section */}
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
            {/* Week header */}
            <button
              onClick={() => toggleWeek(week)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
            >
              <span className="text-sm font-semibold text-slate-700">
                Week {week}
              </span>
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

            {/* Week tasks */}
            {isExpanded && (
              <div
                style={{ borderTop: '1px solid rgba(14,14,14,0.06)' }}
              >
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

  // ── Render ────────────────────────────────────────────────────────────────────

  const totalCount = plans.length;
  const completedCount = done.length;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">My Plans</h2>
          <p className="text-sm text-slate-400">Personal task list — visible only to you</p>
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

      {/* Daily / Monthly toggle */}
      <div
        className="flex rounded-lg overflow-hidden text-sm w-fit"
        style={{ border: '1px solid rgba(14,14,14,0.12)' }}
      >
        {(['daily', 'monthly'] as PlanView[]).map((v) => (
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
            {v === 'daily' ? 'Today' : 'This Month'}
          </button>
        ))}
      </div>

      {/* Add task input */}
      <AddTaskInput
        view={view}
        today={today}
        thisMonth={thisMonth}
        daysInMonth={daysInCurrentMonth}
        onAdd={handleAdd}
      />

      {/* Task list */}
      {loading ? (
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
