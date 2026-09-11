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
import { useAuth } from '../context/AuthContext';
import { getRequestSchedule, swapRequestScheduleDay, assignRequestScheduleDay, RequestScheduleDay, RequestScheduleData } from '../api';
import { Spinner, Modal } from '../components/ui';

interface AssigneeStyle { bg: string; text: string; border: string; dot: string }

// Iryna/Victoria Horopeka reuse the exact colors PeekRequestsCalendar.tsx
// already uses for them, for visual consistency across the app.
const ASSIGNEE_STYLES: Record<string, AssigneeStyle> = {
  'Iryna Kolodienko':     { bg: 'bg-indigo-100',  text: 'text-indigo-700',  border: 'border-indigo-200',  dot: 'bg-indigo-400' },
  'Victoria Horopeka':    { bg: 'bg-red-100',     text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-400' },
  'Tetyana Veremeyenko':  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-400' },
  'Yana Fedorova':        { bg: 'bg-amber-100',   text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-400' },
};
const DEFAULT_STYLE: AssigneeStyle = { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' };
const styleForAssignee = (name: string) => ASSIGNEE_STYLES[name] ?? DEFAULT_STYLE;

function AssigneeChip({ day, canEdit, onClick }: { day: RequestScheduleDay; canEdit: boolean; onClick: () => void }) {
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
      title={day.userName}
      className={`px-1.5 py-1 rounded text-[11px] font-medium select-none border truncate ${s.bg} ${s.text} ${s.border}
        ${canEdit ? 'cursor-pointer active:cursor-grabbing' : ''} ${isDragging ? 'opacity-50' : ''}`}
    >
      {day.userName.split(' ')[0]}
    </div>
  );
}

function DayCell({ date, day, isCurrentMonth, canEdit, onChipClick }: {
  date: Date; day: RequestScheduleDay | undefined; isCurrentMonth: boolean; canEdit: boolean; onChipClick: () => void;
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
      {day && <AssigneeChip day={day} canEdit={canEdit} onClick={onChipClick} />}
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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
