// client/src/pages/DailyLog.tsx
import React, { useEffect, useState } from 'react';
import { MessageCircle, Ticket, Phone, RefreshCcw, Sun, Moon, ClipboardList, Save } from 'lucide-react';
import { format } from 'date-fns';
import { getAgents, createShiftLog, getShiftLogs, updateShiftLog, archiveShiftLog, deleteShiftLog } from '../api';
import { Agent, ShiftLog, ShiftType } from '../types';
import { Modal, Spinner, EmptyState, StatusBadge, ConfirmDialog } from '../components/ui';
import { PeekDutyToggle } from '../components/PeekDutyToggle';

const SHIFT_HOURS: Record<ShiftType, number> = { MORNING: 11, NIGHT: 8 };

type DraftStats = { chatsCount: number; ticketsCount: number; callsCount: number; refundRequestsCount: number; comments: string };

const STAT_FIELDS: { key: keyof DraftStats; label: string; Icon: React.ElementType }[] = [
  { key: 'chatsCount',           label: 'Chats',   Icon: MessageCircle },
  { key: 'ticketsCount',         label: 'Tickets', Icon: Ticket },
  { key: 'callsCount',           label: 'Calls',   Icon: Phone },
  { key: 'refundRequestsCount',  label: 'Refunds', Icon: RefreshCcw },
];

function ShiftLogCard({ log, onSave, onEndShift, onArchive, onDelete }: {
  log: ShiftLog;
  onSave?: (id: string, data: DraftStats) => Promise<void>;
  onEndShift?: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isActive = !log.archived;
  const [editing, setEditing] = useState(isActive);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DraftStats>({ chatsCount: log.chatsCount, ticketsCount: log.ticketsCount, callsCount: log.callsCount, refundRequestsCount: log.refundRequestsCount, comments: log.comments || '' });
  const [confirm, setConfirm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startEdit = () => {
    setDraft({ chatsCount: log.chatsCount, ticketsCount: log.ticketsCount, callsCount: log.callsCount, refundRequestsCount: log.refundRequestsCount, comments: log.comments || '' });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(log.id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card flex flex-col gap-2"
         style={isActive ? { borderColor: 'rgba(161,249,110,0.50)', backgroundColor: 'rgba(161,249,110,0.07)' } : {}}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-800">{log.agent.name}</p>
          <p className="text-xs text-slate-400">{format(new Date(log.shiftDate), 'dd MMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-1.5">
            {isActive && <span className="text-xs font-medium text-ink px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(161,249,110,0.35)' }}>Active</span>}
            <StatusBadge status={log.shiftType} />
          </div>
          <span className="text-xs text-slate-400">{log.hoursWorked}h</span>
          {isActive ? (
            <button onClick={() => setConfirm(true)} className="text-xs font-semibold px-3 py-1.5 rounded-md transition-colors" style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}>End Shift</button>
          ) : (
            <button onClick={() => setConfirm(true)} className="text-xs text-amber-600 hover:text-amber-700">Archive</button>
          )}
          <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
        </div>
      </div>

      {/* Edit mode */}
      {editing ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {STAT_FIELDS.map(f => (
              <label key={f.key} className="text-xs text-slate-600">
                <span className="flex items-center gap-1 mb-1"><f.Icon size={12} strokeWidth={1.5} style={{ color: 'rgba(14,14,14,0.40)' }} />{f.label}</span>
                <input
                  type="number"
                  min="0"
                  className="input mt-1"
                  value={(draft[f.key] as number) === 0 ? '' : (draft[f.key] as number)}
                  placeholder="0"
                  onChange={e => setDraft(prev => ({ ...prev, [f.key]: Number(e.target.value) || 0 }))}
                />
              </label>
            ))}
          </div>
          <label className="text-xs text-slate-600 block">
            Comments
            <textarea
              rows={2}
              className="input mt-1 resize-none"
              placeholder="Notes, escalations…"
              value={draft.comments}
              onChange={e => setDraft(prev => ({ ...prev, comments: e.target.value }))}
            />
          </label>
          <div className="flex justify-end pt-1">
            <button className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50" onClick={handleSave} disabled={saving}>
              <Save size={12} strokeWidth={1.5} />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        /* View mode */
        <>
          <div className="grid grid-cols-4 gap-2 mt-1">
            {STAT_FIELDS.map(f => (
              <div key={f.key} className="bg-white/70 rounded-lg p-2 text-center">
                <div className="flex justify-center mb-1" style={{ color: 'rgba(14,14,14,0.40)' }}>
                  <f.Icon size={15} strokeWidth={1.5} />
                </div>
                <p className="text-base font-bold text-slate-700">{log[f.key as keyof ShiftLog] as number}</p>
                <p className="text-[10px] text-slate-400">{f.label}</p>
              </div>
            ))}
          </div>
          {log.comments && (
            <div className="flex items-start gap-1.5 text-sm text-slate-500 bg-amber-50 rounded-lg p-2">
              <MessageCircle size={13} strokeWidth={1.5} className="flex-shrink-0 mt-0.5" style={{ color: 'rgba(14,14,14,0.38)' }} />
              <span>{log.comments}</span>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirm}
        message={isActive ? 'End this shift and archive the log?' : 'Archive this shift log?'}
        onConfirm={() => {
          if (isActive && onEndShift) onEndShift(log.id); else onArchive(log.id);
          setConfirm(false);
        }}
        onCancel={() => setConfirm(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        message="Delete this shift log permanently?"
        onConfirm={() => { onDelete(log.id); setConfirmDelete(false); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export default function DailyLog({ onSyncStats, onDataChanged }: { onSyncStats?: (year: number, month: number) => void; onDataChanged?: () => void }) {
  const today = format(new Date(), 'yyyy-MM-dd');

  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<ShiftLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Archive filter state — only active when showArchived === true
  const [filterMode, setFilterMode] = useState<'day' | 'month' | 'range'>('day');
  const [selectedDate, setSelectedDate] = useState(today);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  // Form state
  const [form, setForm] = useState({
    agentId: '',
    shiftType: 'MORNING' as ShiftType,
    chatsCount: '',
    ticketsCount: '',
    callsCount: '',
    refundRequestsCount: '',
    comments: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const params = !showArchived
        ? { date: today, includeArchived: false, limit: 100 }
        : filterMode === 'day'
          ? { date: selectedDate, includeArchived: true, limit: 100 }
          : filterMode === 'month'
            ? { month: new Date(selectedDate).getMonth() + 1, year: new Date(selectedDate).getFullYear(), includeArchived: true, limit: 100 }
            : { dateFrom, dateTo, includeArchived: true, limit: 100 };
      const [agentData, logData] = await Promise.all([
        getAgents(),
        getShiftLogs(params),
      ]);
      setAgents(agentData);
      const sorted = showArchived
        ? [...logData.logs].sort((a: ShiftLog, b: ShiftLog) => new Date(b.shiftDate).getTime() - new Date(a.shiftDate).getTime())
        : logData.logs;
      setLogs(sorted);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [showArchived, selectedDate, dateFrom, dateTo, filterMode]);

  useEffect(() => {
    const now = new Date();
    onSyncStats?.(now.getFullYear(), now.getMonth() + 1);
  }, [onSyncStats]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.agentId) return;
    setSubmitting(true);
    try {
      await createShiftLog({
        agentId: form.agentId,
        shiftType: form.shiftType,
        shiftDate: today,
        chatsCount: Number(form.chatsCount) || 0,
        ticketsCount: Number(form.ticketsCount) || 0,
        callsCount: Number(form.callsCount) || 0,
        refundRequestsCount: Number(form.refundRequestsCount) || 0,
        comments: form.comments || undefined,
      });
      setShowForm(false);
      setForm({ agentId: '', shiftType: 'MORNING', chatsCount: '', ticketsCount: '', callsCount: '', refundRequestsCount: '', comments: '' });
      await loadData();
      onDataChanged?.();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveLog = async (id: string, data: DraftStats) => {
    await updateShiftLog(id, {
      chatsCount: data.chatsCount,
      ticketsCount: data.ticketsCount,
      callsCount: data.callsCount,
      refundRequestsCount: data.refundRequestsCount,
      comments: data.comments || undefined,
    });
    await loadData();
    onDataChanged?.();
  };

  const handleEndShift = async (id: string) => {
    await archiveShiftLog(id);
    await loadData();
    onDataChanged?.();
  };

  const handleArchive = async (id: string) => {
    await archiveShiftLog(id);
    await loadData();
    onDataChanged?.();
  };
  const handleDelete = async (id: string) => {
    await deleteShiftLog(id);
    await loadData();
    onDataChanged?.();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Daily Log</h2>
          <p className="text-sm text-slate-400">{showArchived ? 'Archived shifts' : 'Today\'s shifts'}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <PeekDutyToggle />
          <button className="btn-secondary" onClick={() => setShowArchived(v => !v)}>{showArchived ? 'Hide Archive' : 'Show Archive'}</button>
          {!showArchived && (
            <button className="btn-accent whitespace-nowrap" onClick={() => setShowForm(true)}>+ Log Shift</button>
          )}
        </div>
      </div>

      {/* Archive filter controls */}
      {showArchived && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {(['day', 'month', 'range'] as const).map(mode => (
              <button key={mode} onClick={() => setFilterMode(mode)} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${filterMode === mode ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>
                {mode === 'day' ? 'Day' : mode === 'month' ? 'Month' : 'Range'}
              </button>
            ))}
          </div>
          {filterMode === 'day' ? (
            <input type="date" className="input w-auto text-sm" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
          ) : filterMode === 'month' ? (
            <input type="month" className="input w-auto text-sm" value={selectedDate.slice(0, 7)} onChange={e => setSelectedDate(`${e.target.value}-01`)} />
          ) : (
            <>
              <input type="date" className="input w-auto text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" className="input w-auto text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </>
          )}
        </div>
      )}

      {/* Online now strip — main view only */}
      {!showArchived && (
        <div className="rounded-xl px-3 py-2 text-sm"
             style={logs.some(log => !log.archived)
               ? { border: '1px solid rgba(161,249,110,0.50)', backgroundColor: 'rgba(161,249,110,0.12)', color: '#0E0E0E' }
               : { border: '1px solid rgba(14,14,14,0.09)', backgroundColor: 'rgba(14,14,14,0.03)', color: 'rgba(14,14,14,0.45)' }}>
          {logs.some(log => !log.archived)
            ? <span>● Online now: {logs.filter(log => !log.archived).map(log => `${log.agent.name} — ${log.shiftType === 'MORNING' ? 'Morning' : 'Night'} Shift`).join(', ')}</span>
            : <span className="inline-flex items-center gap-1.5"><Moon size={13} strokeWidth={1.5} />Everyone's offline right now</span>}
        </div>
      )}

      {/* Logs */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : logs.length === 0 ? (
        <EmptyState icon={<ClipboardList size={44} strokeWidth={1} />} message={showArchived ? 'No archived shifts found' : 'No shifts logged for today'} action={
          !showArchived ? (
            <button className="btn-accent mx-auto block" onClick={() => setShowForm(true)}>+ Log First Shift</button>
          ) : undefined
        } />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {logs.map(log => (
            <ShiftLogCard key={log.id} log={log} onSave={handleSaveLog} onEndShift={handleEndShift} onArchive={handleArchive} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Add Shift Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Log New Shift">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Agent *</label>
            <select
              className="input"
              value={form.agentId}
              onChange={e => setForm(f => ({ ...f, agentId: e.target.value }))}
              required
            >
              <option value="">Select agent...</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Shift Type *</label>
            <div className="grid grid-cols-2 gap-3">
              {(['MORNING', 'NIGHT'] as ShiftType[]).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, shiftType: type }))}
                  className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                    form.shiftType === type
                      ? 'border-[#A1F96E] text-[#0E0E0E]'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                  style={form.shiftType === type ? { backgroundColor: 'rgba(161,249,110,0.18)' } : {}}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    {type === 'MORNING' ? <Sun size={14} strokeWidth={1.5} /> : <Moon size={14} strokeWidth={1.5} />}
                    {type === 'MORNING' ? 'Morning (11h)' : 'Night (8h)'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'chatsCount',           label: 'Chats',           Icon: MessageCircle },
              { key: 'ticketsCount',          label: 'Tickets',         Icon: Ticket },
              { key: 'callsCount',            label: 'Calls',           Icon: Phone },
              { key: 'refundRequestsCount',   label: 'Refund Requests', Icon: RefreshCcw },
            ].map(f => (
              <div key={f.key}>
                <label className="label flex items-center gap-1.5"><f.Icon size={13} strokeWidth={1.5} style={{ color: 'rgba(14,14,14,0.45)' }} />{f.label}</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  placeholder="0"
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div>
            <label className="label">Comments / Important Cases</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Any notable events, escalations, or important cases..."
              value={form.comments}
              onChange={e => setForm(f => ({ ...f, comments: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn-accent flex-1" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Shift Log'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
