// client/src/pages/ShiftCalendar.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Sun, Moon, TreePalm, FileText, Ban, Gift, Star } from 'lucide-react';
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
import { getAgents, getCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../api';
import { Agent, CalendarEvent, LeaveType, ShiftType } from '../types';
import { Modal, Spinner, ConfirmDialog } from '../components/ui';
import { useAuth } from '../context/AuthContext';

const LEAVE_COLORS: Record<LeaveType, string> = {
  SHIFT:                    'bg-amber-100 text-amber-800 border border-amber-200',
  VACATION:                 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  SICK_LEAVE_WITH_NOTE:     'bg-pink-100 text-pink-700 border border-pink-200',
  SICK_LEAVE_WITHOUT_NOTE:  'bg-red-100 text-red-700 border border-red-200',
  BIRTHDAY_OFF:             'bg-violet-100 text-violet-700 border border-violet-200',
};

function getEventColor(leaveType: LeaveType, shiftType?: string | null): string {
  if (leaveType === 'SHIFT') {
    return shiftType === 'NIGHT'
      ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
      : 'bg-amber-100 text-amber-800 border border-amber-200';
  }
  return LEAVE_COLORS[leaveType] ?? 'bg-slate-100 text-slate-600 border border-slate-200';
}

const LEAVE_LABELS: Record<LeaveType, string> = {
  SHIFT: 'Shift',
  VACATION: 'Vacation',
  SICK_LEAVE_WITH_NOTE: 'Sick leave with note',
  SICK_LEAVE_WITHOUT_NOTE: 'Sick leave without note',
  BIRTHDAY_OFF: 'Birthday off',
};

const LEAVE_ICON_MAP: Record<LeaveType, React.ElementType> = {
  SHIFT: Sun,
  VACATION: TreePalm,
  SICK_LEAVE_WITH_NOTE: FileText,
  SICK_LEAVE_WITHOUT_NOTE: Ban,
  BIRTHDAY_OFF: Gift,
};

function EventIcon({ leaveType, shiftType, size = 10 }: { leaveType: LeaveType; shiftType?: string | null; size?: number }) {
  if (leaveType === 'SHIFT') {
    const Icon = shiftType === 'NIGHT' ? Moon : Sun;
    return <Icon size={size} strokeWidth={1.8} />;
  }
  const Icon = LEAVE_ICON_MAP[leaveType] ?? Star;
  return <Icon size={size} strokeWidth={1.8} />;
}


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

function EventChip({ event, onDelete, onEdit, readOnly }: {
  event: CalendarEvent;
  onDelete: () => void;
  onEdit: () => void;
  readOnly?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: event.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(readOnly ? {} : listeners)}
      {...(readOnly ? {} : attributes)}
      onClick={readOnly ? undefined : (e) => { e.stopPropagation(); onEdit(); }}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium select-none
        ${getEventColor(event.leaveType, event.shiftType)}
        ${isDragging ? 'opacity-50' : ''}
        ${readOnly ? 'cursor-default' : 'group cursor-pointer'}`}
    >
      <EventIcon leaveType={event.leaveType} shiftType={event.shiftType} size={9} />
      <span className="truncate min-w-0 flex-1" title={event.agent.name.split(' ')[0]}>{event.agent.name.split(' ')[0]}</span>
      {event.isExtraShift && <span title="Extra shift" className="flex-shrink-0"><Star size={8} strokeWidth={2} className="text-amber-500" /></span>}
      {!readOnly && (
        <>
          <span className="opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0 pointer-events-none">
            <PencilIcon />
          </span>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="flex-shrink-0 opacity-50 hover:opacity-100 hover:text-red-600 transition-all"
            title="Delete entry"
          >
            <TrashIcon />
          </button>
        </>
      )}
    </div>
  );
}

function DayCell({ date, events, onAdd, onRequestDelete, onEditEvent, isCurrentMonth, readOnly }: {
  date: Date;
  events: CalendarEvent[];
  onAdd: (date: Date) => void;
  onRequestDelete: (id: string) => void;
  onEditEvent: (ev: CalendarEvent) => void;
  isCurrentMonth: boolean;
  readOnly?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: format(date, 'yyyy-MM-dd') });

  return (
    <div
      ref={setNodeRef}
      onClick={readOnly ? undefined : () => onAdd(date)}
      className={`min-h-[80px] sm:min-h-[100px] p-1.5 rounded-lg transition-colors
        ${readOnly ? 'cursor-default' : 'cursor-pointer group'}
        ${isOver && !readOnly ? 'ring-1 ring-inset ring-[#A1F96E]/70' : ''}
        ${!isCurrentMonth ? 'opacity-35' : ''}
        ${isToday(date) ? 'ring-2 ring-inset ring-[#0E0E0E]/20' : ''}
      `}
      style={{
        border: '1px solid rgba(14,14,14,0.09)',
        backgroundColor: isOver && !readOnly ? 'rgba(161,249,110,0.10)' : undefined,
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-medium ${isToday(date) ? 'text-ink font-bold' : ''}`}
              style={!isToday(date) ? { color: 'rgba(14,14,14,0.45)' } : undefined}>
          {format(date, 'd')}
        </span>
        {!readOnly && (
          <span className="text-[10px] transition-colors" style={{ color: 'rgba(14,14,14,0.15)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(14,14,14,0.45)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(14,14,14,0.15)')}>+</span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {events.slice(0, 3).map(ev => (
          <EventChip key={ev.id} event={ev} onDelete={() => onRequestDelete(ev.id)} onEdit={() => onEditEvent(ev)} readOnly={readOnly} />
        ))}
        {events.length > 3 && (
          <span className="text-[10px] pl-1" style={{ color: 'rgba(14,14,14,0.38)' }}>+{events.length - 3} more</span>
        )}
      </div>
    </div>
  );
}

export default function ShiftCalendar({ onDataChanged, readOnly }: { onDataChanged?: () => void; readOnly?: boolean }) {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<'all' | 'mine'>('all');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editForm, setEditForm] = useState<{ leaveType: LeaveType; shiftType: ShiftType | ''; isExtraShift: boolean; notes: string }>({
    leaveType: 'SHIFT', shiftType: 'MORNING', isExtraShift: false, notes: '',
  });

  const [form, setForm] = useState({
    agentId: '',
    leaveType: 'SHIFT' as LeaveType,
    shiftType: 'MORNING' as ShiftType | '',
    isExtraShift: false,
    notes: '',
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [agentData, eventData] = await Promise.all([
        getAgents(),
        getCalendarEvents({ year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1 }),
      ]);
      setAgents(agentData);
      setEvents(eventData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => { loadData(); }, [loadData]);

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  // Pad start
  const startPad = startOfMonth(currentMonth).getDay();
  const paddedDays: (Date | null)[] = [...Array(startPad).fill(null), ...days];

  const getEventsForDate = (date: Date) =>
    events
      .filter(ev => format(new Date(ev.eventDate), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'))
      .filter(ev => viewMode === 'all' || ev.agentId === user?.agentId);

  const handleDragStart = (event: DragStartEvent) => {
    const found = events.find(e => e.id === event.active.id);
    setActiveEvent(found || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveEvent(null);
    if (readOnly) return;
    const { active, over } = event;
    if (!over || !active) return;
    const newDate = over.id as string;
    const draggedEvent = events.find(e => e.id === active.id);
    if (!draggedEvent) return;
    const oldDate = format(new Date(draggedEvent.eventDate), 'yyyy-MM-dd');
    if (oldDate === newDate) return;

    // If the target day already has a stored event for the same agent, swap their dates.
    // Otherwise just move.
    const targetEvent = events.find(
      e => e.id !== draggedEvent.id &&
           e.agentId === draggedEvent.agentId &&
           format(new Date(e.eventDate), 'yyyy-MM-dd') === newDate
    );

    try {
      if (targetEvent) {
        await Promise.all([
          updateCalendarEvent(draggedEvent.id, { eventDate: newDate }),
          updateCalendarEvent(targetEvent.id, { eventDate: oldDate }),
        ]);
      } else {
        await updateCalendarEvent(draggedEvent.id, { eventDate: newDate });
      }
      await loadData();
      onDataChanged?.();
    } catch (e) {
      console.error(e);
      await loadData();
    }
  };

  const handleAddEvent = async () => {
    if (!selectedDate || !form.agentId || !form.leaveType) return;
    try {
      await createCalendarEvent({
        agentId: form.agentId,
        eventDate: format(selectedDate, 'yyyy-MM-dd'),
        leaveType: form.leaveType,
        shiftType: form.leaveType === 'SHIFT' ? form.shiftType || null : null,
        isExtraShift: form.leaveType === 'SHIFT' ? form.isExtraShift : false,
        notes: form.notes || undefined,
      });
      setShowForm(false);
      setForm({ agentId: '', leaveType: 'SHIFT', shiftType: 'MORNING', isExtraShift: false, notes: '' });
      await loadData();
      onDataChanged?.();
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenEdit = (event: CalendarEvent) => {
    setEditingEvent(event);
    setEditForm({
      leaveType: event.leaveType as LeaveType,
      shiftType: (event.shiftType as ShiftType) || '',
      isExtraShift: event.isExtraShift === true,
      notes: event.notes || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingEvent) return;
    try {
      await updateCalendarEvent(editingEvent.id, {
        leaveType: editForm.leaveType,
        shiftType: editForm.leaveType === 'SHIFT' ? editForm.shiftType || null : null,
        isExtraShift: editForm.leaveType === 'SHIFT' ? editForm.isExtraShift : false,
        notes: editForm.notes || undefined,
      });
      setEditingEvent(null);
      await loadData();
      onDataChanged?.();
    } catch (e) {
      console.error(e);
    }
  };

  const handleConfirmDelete = async () => {
    const id = confirmDeleteId;
    if (!id) return;
    setConfirmDeleteId(null);
    setEvents(prev => prev.filter(e => e.id !== id));
    try {
      await deleteCalendarEvent(id);
      onDataChanged?.();
    } catch {
      await loadData();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Shift Calendar</h2>
          <p className="text-sm" style={{ color: 'rgba(14,14,14,0.40)' }}>
            {readOnly ? 'View-only mode' : 'Drag & drop to reschedule'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary px-3" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>‹</button>
          <span className="text-sm font-semibold text-ink min-w-[120px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button className="btn-secondary px-3" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>›</button>
        </div>
      </div>

      {/* Legend + view filter */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${getEventColor('SHIFT', 'MORNING')}`}><Sun size={11} strokeWidth={1.5} />Morning Shift</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${getEventColor('SHIFT', 'NIGHT')}`}><Moon size={11} strokeWidth={1.5} />Night Shift</span>
          {(['VACATION', 'SICK_LEAVE_WITH_NOTE', 'SICK_LEAVE_WITHOUT_NOTE', 'BIRTHDAY_OFF'] as LeaveType[]).map(type => (
            <span key={type} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${LEAVE_COLORS[type]}`}>
              <EventIcon leaveType={type} size={11} />
              {LEAVE_LABELS[type]}
            </span>
          ))}
        </div>

        {user?.agentId && (
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ backgroundColor: 'rgba(14,14,14,0.06)' }}>
            {(['all', 'mine'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  viewMode === mode ? 'text-[#0E0E0E]' : 'text-slate-500 hover:text-slate-700'
                }`}
                style={viewMode === mode ? { backgroundColor: '#A1F96E' } : undefined}
              >
                {mode === 'all' ? 'All' : 'My shifts'}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <div key={d} className="text-center text-xs font-medium py-1" style={{ color: 'rgba(14,14,14,0.38)' }}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {paddedDays.map((date, i) => date ? (
              <DayCell
                key={format(date, 'yyyy-MM-dd')}
                date={date}
                events={getEventsForDate(date)}
                onAdd={d => { setSelectedDate(d); setShowForm(true); }}
                onRequestDelete={setConfirmDeleteId}
                onEditEvent={handleOpenEdit}
                isCurrentMonth={isSameMonth(date, currentMonth)}
                readOnly={readOnly}
              />
            ) : (
              <div key={`pad-${i}`} className="min-h-[80px] sm:min-h-[100px]" />
            ))}
          </div>

          <DragOverlay>
            {activeEvent && (
              <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium shadow-lg ${getEventColor(activeEvent.leaveType, activeEvent.shiftType)}`}>
                <EventIcon leaveType={activeEvent.leaveType} shiftType={activeEvent.shiftType} size={10} />
                {activeEvent.agent.name.split(' ')[0]}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Add Event Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={`Add Event — ${selectedDate ? format(selectedDate, 'dd MMM yyyy') : ''}`}>
        <div className="space-y-4">
          <div>
            <label className="label">Agent *</label>
            <select className="input" value={form.agentId} onChange={e => setForm(f => ({ ...f, agentId: e.target.value }))}>
              <option value="">Select agent...</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Event Type *</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(LEAVE_LABELS) as [LeaveType, string][]).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, leaveType: type }))}
                  className={`p-2 rounded-lg border-2 text-xs font-medium transition-all text-left ${
                    form.leaveType === type
                      ? 'border-[#A1F96E] bg-[#A1F96E]/20 text-[#0E0E0E]'
                      : 'border-slate-200 text-slate-500'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><EventIcon leaveType={type} size={12} />{label}</span>
                </button>
              ))}
            </div>
          </div>

          {form.leaveType === 'SHIFT' && (
            <>
              <div>
                <label className="label">Shift</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['MORNING', 'NIGHT'] as ShiftType[]).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, shiftType: t }))}
                      className={`p-2 rounded-lg border-2 text-xs font-medium transition-all ${
                        form.shiftType === t
                          ? 'border-[#A1F96E] bg-[#A1F96E]/20 text-[#0E0E0E]'
                          : 'border-slate-200 text-slate-500'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {t === 'MORNING' ? <Sun size={13} strokeWidth={1.5} /> : <Moon size={13} strokeWidth={1.5} />}
                        {t === 'MORNING' ? 'Morning' : 'Night'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.isExtraShift}
                  onChange={e => setForm(f => ({ ...f, isExtraShift: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-700">
                  <Star size={13} strokeWidth={1.5} className="text-amber-500" /><span>Extra Shift</span>
                </span>
              </label>
            </>
          )}

          <div>
            <label className="label">Notes</label>
            <input className="input" placeholder="Optional notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn-accent flex-1" onClick={handleAddEvent} disabled={!form.agentId}>Add Event</button>
          </div>
        </div>
      </Modal>

      {/* Edit Entry Modal */}
      <Modal
        open={editingEvent !== null}
        onClose={() => setEditingEvent(null)}
        title={editingEvent ? `Edit — ${editingEvent.agent.name} · ${format(new Date(editingEvent.eventDate), 'dd MMM yyyy')}` : ''}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Event Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(LEAVE_LABELS) as [LeaveType, string][]).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setEditForm(f => ({ ...f, leaveType: type }))}
                  className={`p-2 rounded-lg border-2 text-xs font-medium transition-all text-left ${
                    editForm.leaveType === type
                      ? 'border-[#A1F96E] bg-[#A1F96E]/20 text-[#0E0E0E]'
                      : 'border-slate-200 text-slate-500'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><EventIcon leaveType={type} size={12} />{label}</span>
                </button>
              ))}
            </div>
          </div>

          {editForm.leaveType === 'SHIFT' && (
            <>
              <div>
                <label className="label">Shift</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['MORNING', 'NIGHT'] as ShiftType[]).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setEditForm(f => ({ ...f, shiftType: t }))}
                      className={`p-2 rounded-lg border-2 text-xs font-medium transition-all ${
                        editForm.shiftType === t
                          ? 'border-[#A1F96E] bg-[#A1F96E]/20 text-[#0E0E0E]'
                          : 'border-slate-200 text-slate-500'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {t === 'MORNING' ? <Sun size={13} strokeWidth={1.5} /> : <Moon size={13} strokeWidth={1.5} />}
                        {t === 'MORNING' ? 'Morning' : 'Night'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editForm.isExtraShift}
                  onChange={e => setEditForm(f => ({ ...f, isExtraShift: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-700">
                  <Star size={13} strokeWidth={1.5} className="text-amber-500" /><span>Extra Shift</span>
                </span>
              </label>
            </>
          )}

          <div>
            <label className="label">Notes</label>
            <input
              className="input"
              placeholder="Optional notes..."
              value={editForm.notes}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={() => setEditingEvent(null)}>Cancel</button>
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
