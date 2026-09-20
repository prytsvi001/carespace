// client/src/pages/RequestSchedule.tsx
// Peekviewer Team — "Request Schedule" tab: who's on duty to submit new-profile
// requests each day, among the 4 rotating agents (order: Tetyana - Iryna -
// Victoria Horopeka - Yana). This calendar is independent of the "Перерозподіл
// активних профілів" reference list below it — same 4 people, different
// rotation order, not derived from one another. Both are fixed day-of-month
// formulas computed server-side — no spreadsheet involved.
// Agents drag their own day onto another to swap, or click a day's chip to
// reassign it directly; peekviewerAdmin can do either for anyone. Same
// @dnd-kit pattern as PeekRequestsCalendar.tsx.
import React, { useCallback, useEffect, useState } from 'react';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
} from '@dnd-kit/core';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, addMonths, subMonths } from 'date-fns';
import { Megaphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getRequestSchedule, swapRequestScheduleDay, assignRequestScheduleDay, getTodayRequestScheduleAssignee,
  RequestScheduleDay, RequestScheduleData,
} from '../api';
import { Spinner, Modal } from '../components/ui';

interface AssigneeStyle { bg: string; text: string; border: string; dot: string }

// Iryna/Victoria Horopeka reuse the exact colors PeekRequestsCalendar.tsx
// already uses for them, for visual consistency across the app. Zlata
// Alekseenko worked the rotation briefly at the start of Sept 2026 before
// leaving — kept here purely so her historical days render with a color
// instead of falling back to the generic gray "inactive" look.
const ASSIGNEE_STYLES: Record<string, AssigneeStyle> = {
  'Iryna Kolodienko':     { bg: 'bg-indigo-100',  text: 'text-indigo-700',  border: 'border-indigo-200',  dot: 'bg-indigo-400' },
  'Victoria Horopeka':    { bg: 'bg-red-100',     text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-400' },
  'Tetyana Veremeyenko':  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-400' },
  'Yana Fedorova':        { bg: 'bg-amber-100',   text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-400' },
  'Zlata Alekseenko':     { bg: 'bg-violet-100',  text: 'text-violet-700',  border: 'border-violet-200',  dot: 'bg-violet-400' },
};
const DEFAULT_STYLE: AssigneeStyle = { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' };
const styleForAssignee = (name: string) => ASSIGNEE_STYLES[name] ?? DEFAULT_STYLE;

// Fixed redistribution-day/validity note shown at the top of the
// "Перерозподіл активних профілів" card, above its per-agent day list —
// same "no spreadsheet, just hardcode it" approach as the reference list
// below it.
const PROFILE_REDISTRIBUTION_DAY = '21.09.2026';
const PROFILE_REDISTRIBUTION_VALID_RANGE = '18.09.2026 - 01.04.2026';

// "Розподіл неактивних профілів" — a separate, fixed historical reference
// list (who owned inactive-profile redistribution during which period), not
// a rotating formula like the two lists above it, so it's just hardcoded
// here rather than computed server-side — same "no spreadsheet" approach,
// just no periodic recurrence to derive.
const INACTIVE_REDISTRIBUTION_DAY = '21.09.2026';
const INACTIVE_REDISTRIBUTION_VALID_RANGE = '31.03.2026 - 30.09.2022';
const INACTIVE_PROFILE_REDISTRIBUTION: { fullName: string; label: string; range: string }[] = [
  { fullName: 'Iryna Kolodienko',    label: 'Iryna', range: '31.03.2026 — 16.05.2025' },
  { fullName: 'Tetyana Veremeyenko', label: 'Tanya', range: '15.05.2025 — 30.06.2024' },
  { fullName: 'Yana Fedorova',       label: 'Yana',  range: '29.06.2024 — 15.08.2023' },
  { fullName: 'Victoria Horopeka',   label: 'Vika',  range: '14.08.2023 — 30.09.2022' },
];

function AssigneeChip({ day, canEdit, isActive, onClick }: {
  day: RequestScheduleDay; canEdit: boolean; isActive: boolean; onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: day.date, disabled: !canEdit });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const s = styleForAssignee(day.userName);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); if (canEdit) onClick(); }}
      title={isActive ? day.userName : `${day.userName} (inactive)`}
      className={`px-1.5 py-1 rounded text-[11px] font-medium select-none border truncate ${s.bg} ${s.text} ${s.border}
        ${!isActive ? 'opacity-60' : ''}
        ${canEdit ? 'cursor-pointer active:cursor-grabbing' : ''} ${isDragging ? 'opacity-50' : ''}`}
    >
      {day.userName.split(' ')[0]}{!isActive && <span className="opacity-70"> · inactive</span>}
    </div>
  );
}

function DayCell({ date, day, isCurrentMonth, canEdit, isActiveAgent, onChipClick }: {
  date: Date; day: RequestScheduleDay | undefined; isCurrentMonth: boolean; canEdit: boolean; isActiveAgent: boolean; onChipClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: format(date, 'yyyy-MM-dd'), disabled: !day });

  return (
    <div
      ref={setNodeRef}
      className={`relative min-h-[68px] sm:min-h-[80px] p-1.5 rounded-lg transition-colors
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
      </div>
      {day && <AssigneeChip day={day} canEdit={canEdit} isActive={isActiveAgent} onClick={onChipClick} />}
    </div>
  );
}

export default function RequestSchedule() {
  const { user } = useAuth();
  const isAdmin = !!user?.peekviewerAdmin;

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [data, setData] = useState<RequestScheduleData>({ days: [], redistribution: [], calendarAgents: [] });
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState<RequestScheduleDay | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [isMyTurnToday, setIsMyTurnToday] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Independent of `currentMonth` (the calendar view being browsed) — always
  // reflects today (Kyiv-local), so the banner doesn't disappear just
  // because someone navigated the calendar to a different month.
  useEffect(() => {
    if (!user?.id) return;
    getTodayRequestScheduleAssignee()
      .then((a) => setIsMyTurnToday(a.userId === user.id))
      .catch((e) => console.error(e));
  }, [user?.id]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getRequestSchedule(currentMonth.getFullYear(), currentMonth.getMonth() + 1);
      setData(result);
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

  const dayByDate = new Map(data.days.map((d) => [d.date, d]));
  const isRotationMember = data.calendarAgents.some((a) => a.userId === user?.id);
  const canEditDay = () => isAdmin || isRotationMember;

  const handleDragStart = (event: DragStartEvent) => {
    const found = dayByDate.get(event.active.id as string);
    setActiveDay(found ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDay(null);
    const { active, over } = event;
    if (!over || !active || active.id === over.id) return;

    const date = active.id as string;
    const targetDate = over.id as string;

    // Optimistic swap
    setData((prev) => {
      const a = prev.days.find((d) => d.date === date);
      const b = prev.days.find((d) => d.date === targetDate);
      if (!a || !b) return prev;
      return {
        ...prev,
        days: prev.days.map((d) => {
          if (d.date === date) return { ...d, userId: b.userId, userName: b.userName, isOverride: true };
          if (d.date === targetDate) return { ...d, userId: a.userId, userName: a.userName, isOverride: true };
          return d;
        }),
      };
    });

    try {
      await swapRequestScheduleDay(date, targetDate);
    } catch (e) {
      console.error(e);
      await loadData();
    }
  };

  const handleAssign = async (userId: string) => {
    if (!editingDate) return;
    const date = editingDate;
    setEditingDate(null);
    const agent = data.calendarAgents.find((a) => a.userId === userId);
    if (!agent) return;

    setData((prev) => ({
      ...prev,
      days: prev.days.map((d) => (d.date === date ? { ...d, userId: agent.userId, userName: agent.userName, isOverride: true } : d)),
    }));

    try {
      await assignRequestScheduleDay(date, userId);
    } catch (e) {
      console.error(e);
      await loadData();
    }
  };

  return (
    <div className="space-y-4">
      {isMyTurnToday && (
        <div
          className="flex items-center gap-2.5 rounded-lg px-3.5 py-3"
          style={{ backgroundColor: 'rgba(161,249,110,0.22)', border: '1px solid rgba(161,249,110,0.55)' }}
        >
          <Megaphone size={18} strokeWidth={1.8} className="shrink-0" style={{ color: '#166534' }} />
          <p className="text-sm font-semibold" style={{ color: '#0E0E0E' }}>
            Твоя черга кидати запити на нові профілі!
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Request Schedule</h2>
          <p className="text-sm" style={{ color: 'rgba(14,14,14,0.40)' }}>Drag a day to swap, or click an agent to reassign</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary px-3" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>‹</button>
          <span className="text-sm font-semibold text-ink min-w-[120px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button className="btn-secondary px-3" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>›</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {data.calendarAgents.map((a) => {
          const s = styleForAssignee(a.userName);
          return (
            <span key={a.userId} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
              {a.userName}
            </span>
          );
        })}
      </div>

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
                day={dayByDate.get(format(date, 'yyyy-MM-dd'))}
                isCurrentMonth={isSameMonth(date, currentMonth)}
                canEdit={canEditDay()}
                isActiveAgent={(() => {
                  const d = dayByDate.get(format(date, 'yyyy-MM-dd'));
                  return !!d && data.calendarAgents.some((a) => a.userId === d.userId);
                })()}
                onChipClick={() => setEditingDate(format(date, 'yyyy-MM-dd'))}
              />
            ) : (
              <div key={`pad-${i}`} className="min-h-[68px] sm:min-h-[80px]" />
            ))}
          </div>

          <DragOverlay>
            {activeDay && (() => {
              const s = styleForAssignee(activeDay.userName);
              return (
                <div className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium shadow-lg border ${s.bg} ${s.text} ${s.border}`}>
                  {activeDay.userName.split(' ')[0]}
                </div>
              );
            })()}
          </DragOverlay>
        </DndContext>
      )}

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Перерозподіл активних профілів</h3>
        <div className="text-xs space-y-0.5" style={{ color: 'rgba(14,14,14,0.55)' }}>
          <p>День перерозподілу: <span className="font-semibold" style={{ color: 'rgba(14,14,14,0.75)' }}>{PROFILE_REDISTRIBUTION_DAY}</span></p>
          <p>Актуально з {PROFILE_REDISTRIBUTION_VALID_RANGE}</p>
        </div>
        <div className="space-y-2">
          {data.redistribution.map((r) => {
            const s = styleForAssignee(r.userName);
            return (
              <div key={r.userId} className="flex items-center gap-2 flex-wrap">
                <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${s.bg} ${s.text} ${s.border}`}>
                  {r.userName}
                </span>
                <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>
                  {r.days.join(' · ')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Розподіл неактивних профілів</h3>
        <div className="text-xs space-y-0.5" style={{ color: 'rgba(14,14,14,0.55)' }}>
          <p>День перерозподілу: <span className="font-semibold" style={{ color: 'rgba(14,14,14,0.75)' }}>{INACTIVE_REDISTRIBUTION_DAY}</span></p>
          <p>Актуально з {INACTIVE_REDISTRIBUTION_VALID_RANGE}</p>
        </div>
        <div className="space-y-2">
          {INACTIVE_PROFILE_REDISTRIBUTION.map((r) => {
            const s = styleForAssignee(r.fullName);
            return (
              <div key={r.fullName} className="flex items-center gap-2 flex-wrap">
                <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${s.bg} ${s.text} ${s.border}`}>
                  {r.label}
                </span>
                <span className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>
                  {r.range}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Modal open={!!editingDate} onClose={() => setEditingDate(null)} title={editingDate ? `Reassign — ${format(new Date(editingDate), 'dd MMM yyyy')}` : ''}>
        <div className="grid grid-cols-1 gap-2">
          {data.calendarAgents.map((a) => {
            const s = styleForAssignee(a.userName);
            const current = editingDate ? dayByDate.get(editingDate)?.userId === a.userId : false;
            return (
              <button
                key={a.userId}
                type="button"
                onClick={() => handleAssign(a.userId)}
                className={`p-2 rounded-lg border-2 text-xs font-medium transition-all text-left flex items-center gap-2 ${
                  current ? `${s.bg} ${s.text} ${s.border}` : 'border-slate-200 text-slate-500'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
                {a.userName}
              </button>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
