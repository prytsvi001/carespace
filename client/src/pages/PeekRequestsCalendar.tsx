// client/src/pages/PeekRequestsCalendar.tsx
// Who's covering Peek Requests each day — a simpler sibling to the Support Agents
// Shift Calendar: just an assignee (one of 3 fixed people) + optional hours, up to
// 2 per day, no leave types. Same card design/legend/navigation as ShiftCalendar.
import React, { useEffect, useState, useCallback } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, addMonths, subMonths } from 'date-fns';
import {
  getPeekCalendarAssignees, getPeekCalendarEntries, getPeekResolutionStats,
  createPeekCalendarEntry, updatePeekCalendarEntry, deletePeekCalendarEntry,
} from '../api';
import { PeekCalendarEntry, PeekResolutionStats } from '../types';
import { Modal, Spinner, ConfirmDialog } from '../components/ui';

// Each agent's color is pinned to an existing Support Calendar event color, per
// request — Iryna = Night Shift, Victoria H. = Sick leave without note, Julia =
// Birthday off (see LEAVE_COLORS / getEventColor in ShiftCalendar.tsx) — so these
// reuse the exact same Tailwind classes rather than approximating with hex values.
interface AssigneeStyle { bg: string; text: string; border: string; dot: string }

const ASSIGNEE_STYLES: Record<string, AssigneeStyle> = {
  'Iryna Kolodienko': { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-400' },
  'Victoria Horopeka': { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-400' },
  'Julia Manson': { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200', dot: 'bg-violet-400' },
};
const DEFAULT_STYLE: AssigneeStyle = { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' };
const styleForAssignee = (name: string) => ASSIGNEE_STYLES[name] ?? DEFAULT_STYLE;

// Short display names for the resolution-count summary line and day-cell
// badges — "Victoria H" disambiguates from Victoria Davis (lead), even though
// only peek-team names ever actually appear here.
const SHORT_NAMES: Record<string, string> = {
  'Iryna Kolodienko': 'Iryna',
  'Victoria Horopeka': 'Victoria H',
  'Julia Manson': 'Julia',
};
const shortNameFor = (name: string) => SHORT_NAMES[name] ?? name.split(' ')[0];

const MAX_PER_DAY = 2;

function TrashIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 3h9" />
      <path d="M4 3V2a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1" />
      <path d="M2.5 3l.5 7h6l.5-7" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1l2 2-5.5 5.5L1 9l.5-2.5L7 1z" />
    </svg>
  );
}

function EntryChip({ entry, onDelete, onEdit }: {
  entry: PeekCalendarEntry;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: entry.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const s = styleForAssignee(entry.user.name);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onEdit(); }}
      className={`group flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium select-none cursor-pointer border ${s.bg} ${s.text} ${s.border} ${isDragging ? 'opacity-50' : ''}`}
    >
      <span className="truncate min-w-0 flex-1" title={entry.user.name}>
        {entry.user.name.split(' ')[0]}{entry.hours ? ` · ${entry.hours}` : ''}
      </span>
      <span className="opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0 pointer-events-none">
        <PencilIcon />
      </span>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="flex-shrink-0 opacity-50 hover:opacity-100 hover:text-red-600 transition-all"
        title="Delete entry"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function DayCell({ date, entries, resolvedCounts, onAdd, onRequestDelete, onEditEntry, isCurrentMonth }: {
  date: Date;
  entries: PeekCalendarEntry[];
  resolvedCounts: { name: string; count: number }[];
  onAdd: (date: Date) => void;
  onRequestDelete: (id: string) => void;
  onEditEntry: (entry: PeekCalendarEntry) => void;
  isCurrentMonth: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: format(date, 'yyyy-MM-dd') });

  return (
    <div
      ref={setNodeRef}
      onClick={() => onAdd(date)}
      className={`relative min-h-[80px] sm:min-h-[100px] p-1.5 rounded-lg transition-colors cursor-pointer group
        ${isOver ? 'ring-1 ring-inset ring-[#A1F96E]/70' : ''}
        ${!isCurrentMonth ? 'opacity-35' : ''}
        ${isToday(date) ? 'ring-2 ring-inset ring-[#0E0E0E]/20' : ''}
      `}
      style={{
        border: '1px solid rgba(14,14,14,0.09)',
        backgroundColor: isOver ? 'rgba(161,249,110,0.10)' : undefined,
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-bold ${isToday(date) ? 'text-ink' : ''}`}
              style={!isToday(date) ? { color: 'rgba(14,14,14,0.55)' } : undefined}>
          {format(date, 'd')}
        </span>
        <span className="text-[10px] transition-colors" style={{ color: 'rgba(14,14,14,0.15)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(14,14,14,0.45)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(14,14,14,0.15)')}>+</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {entries.map((entry) => (
          <EntryChip key={entry.id} entry={entry} onDelete={() => onRequestDelete(entry.id)} onEdit={() => onEditEntry(entry)} />
        ))}
      </div>
      {resolvedCounts.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mt-1" onClick={(e) => e.stopPropagation()}>
          {resolvedCounts.map((r) => {
            const s = styleForAssignee(r.name); // r.name is already the full name (e.g. "Iryna Kolodienko")
            return (
              <span
                key={r.name}
                className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold ${s.bg} ${s.text}`}
                title={`${r.name}: ${r.count} resolved`}
              >
                {shortNameFor(r.name)}: {r.count}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PeekRequestsCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [entries, setEntries] = useState<PeekCalendarEntry[]>([]);
  // Already filtered server-side to what the viewer is allowed to see (own
  // counts only for the 3 peek agents, everyone's for head/lead).
  const [stats, setStats] = useState<PeekResolutionStats>({ byDay: {}, totals: [] });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [activeEntry, setActiveEntry] = useState<PeekCalendarEntry | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<PeekCalendarEntry | null>(null);
  const [editHours, setEditHours] = useState('');

  const [form, setForm] = useState({ userId: '', hours: '' });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [assigneeData, entryData, statsData] = await Promise.all([
        getPeekCalendarAssignees(),
        getPeekCalendarEntries({ year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1 }),
        getPeekResolutionStats({ year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1 }),
      ]);
      setAssignees(assigneeData);
      setEntries(entryData);
      setStats(statsData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => { loadData(); }, [loadData]);

  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const startPad = startOfMonth(currentMonth).getDay();
  const paddedDays: (Date | null)[] = [...Array(startPad).fill(null), ...days];

  const getEntriesForDate = (date: Date) =>
    entries.filter((e) => format(new Date(e.eventDate), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'));

  const getResolvedCountsForDate = (date: Date) => stats.byDay[format(date, 'yyyy-MM-dd')] ?? [];

  const handleDragStart = (event: DragStartEvent) => {
    const found = entries.find((e) => e.id === event.active.id);
    setActiveEntry(found || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveEntry(null);
    const { active, over } = event;
    if (!over || !active) return;
    const newDate = over.id as string;
    const dragged = entries.find((e) => e.id === active.id);
    if (!dragged) return;
    const oldDate = format(new Date(dragged.eventDate), 'yyyy-MM-dd');
    if (oldDate === newDate) return;

    const targetCount = entries.filter(
      (e) => e.id !== dragged.id && format(new Date(e.eventDate), 'yyyy-MM-dd') === newDate
    ).length;
    if (targetCount >= MAX_PER_DAY) {
      alert(`${format(new Date(newDate), 'MMM d')} already has ${MAX_PER_DAY} agents assigned.`);
      return;
    }

    try {
      const updated = await updatePeekCalendarEntry(dragged.id, { eventDate: newDate });
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (e) {
      console.error(e);
      await loadData();
    }
  };

  const dayIsFull = (date: Date) => getEntriesForDate(date).length >= MAX_PER_DAY;

  const handleAddEntry = async () => {
    if (!selectedDate || !form.userId) return;
    try {
      const created = await createPeekCalendarEntry({
        userId: form.userId,
        eventDate: format(selectedDate, 'yyyy-MM-dd'),
        hours: form.hours || undefined,
      });
      setEntries((prev) => [...prev, created]);
      setShowForm(false);
      setForm({ userId: '', hours: '' });
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    try {
      const updated = await updatePeekCalendarEntry(editingEntry.id, { hours: editHours });
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setEditingEntry(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleConfirmDelete = async () => {
    const id = confirmDeleteId;
    if (!id) return;
    setConfirmDeleteId(null);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await deletePeekCalendarEntry(id);
    } catch {
      await loadData();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Peek Requests Calendar</h2>
          <p className="text-sm" style={{ color: 'rgba(14,14,14,0.40)' }}>Drag & drop to reschedule</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary px-3" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>‹</button>
          <span className="text-sm font-semibold text-ink min-w-[120px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button className="btn-secondary px-3" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>›</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {(['Iryna Kolodienko', 'Victoria Horopeka', 'Julia Manson']).map((name) => {
          const s = styleForAssignee(name);
          return (
            <span
              key={name}
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}
            >
              {name}
            </span>
          );
        })}
      </div>

      {/* Monthly resolved-request totals — already scoped server-side to what
          the viewer is allowed to see (own count only for the 3 peek agents,
          everyone's for head/lead). */}
      {stats.totals.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>
          <span className="font-semibold" style={{ color: 'rgba(14,14,14,0.40)' }}>Resolved this month:</span>
          {stats.totals.map((t, i) => (
            <span key={t.name}>
              {i > 0 && <span className="mx-1" style={{ color: 'rgba(14,14,14,0.25)' }}>·</span>}
              <span className="font-semibold text-ink">{shortNameFor(t.name)}</span>: {t.count}
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="text-center text-xs font-bold py-1" style={{ color: 'rgba(14,14,14,0.55)' }}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {paddedDays.map((date, i) => date ? (
              <DayCell
                key={format(date, 'yyyy-MM-dd')}
                date={date}
                entries={getEntriesForDate(date)}
                resolvedCounts={getResolvedCountsForDate(date)}
                onAdd={(d) => { setSelectedDate(d); setForm({ userId: '', hours: '' }); setShowForm(true); }}
                onRequestDelete={setConfirmDeleteId}
                onEditEntry={(entry) => { setEditingEntry(entry); setEditHours(entry.hours || ''); }}
                isCurrentMonth={isSameMonth(date, currentMonth)}
              />
            ) : (
              <div key={`pad-${i}`} className="min-h-[80px] sm:min-h-[100px]" />
            ))}
          </div>

          <DragOverlay>
            {activeEntry && (() => {
              const s = styleForAssignee(activeEntry.user.name);
              return (
                <div
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium shadow-lg border ${s.bg} ${s.text} ${s.border}`}
                >
                  {activeEntry.user.name.split(' ')[0]}{activeEntry.hours ? ` · ${activeEntry.hours}` : ''}
                </div>
              );
            })()}
          </DragOverlay>
        </DndContext>
      )}

      {/* Add Entry Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={`Add Agent — ${selectedDate ? format(selectedDate, 'dd MMM yyyy') : ''}`}>
        {selectedDate && dayIsFull(selectedDate) ? (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'rgba(14,14,14,0.55)' }}>
              This day already has {MAX_PER_DAY} agents assigned. Remove one before adding another.
            </p>
            <button className="btn-secondary w-full" onClick={() => setShowForm(false)}>Close</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label">Agent *</label>
              <div className="grid grid-cols-1 gap-2">
                {assignees.map((a) => {
                  const s = styleForAssignee(a.name);
                  const active = form.userId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, userId: a.id }))}
                      className={`p-2 rounded-lg border-2 text-xs font-medium transition-all text-left flex items-center gap-2 ${
                        active ? `${s.bg} ${s.text} ${s.border}` : 'border-slate-200 text-slate-500'
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
                      {a.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="label">Working hours</label>
              <input
                className="input"
                placeholder="e.g. 09:00-17:00 (optional)"
                value={form.hours}
                onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-accent flex-1" onClick={handleAddEntry} disabled={!form.userId}>Add Agent</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Entry Modal */}
      <Modal
        open={editingEntry !== null}
        onClose={() => setEditingEntry(null)}
        title={editingEntry ? `Edit — ${editingEntry.user.name} · ${format(new Date(editingEntry.eventDate), 'dd MMM yyyy')}` : ''}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Working hours</label>
            <input
              className="input"
              placeholder="e.g. 09:00-17:00 (optional)"
              value={editHours}
              onChange={(e) => setEditHours(e.target.value)}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={() => setEditingEntry(null)}>Cancel</button>
            <button className="btn-accent flex-1" onClick={handleSaveEdit}>Save Changes</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        message="Delete this calendar entry permanently?"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
