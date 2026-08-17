// client/src/pages/AIChatQA.tsx
import React, { useEffect, useRef, useState } from 'react';
import { TriangleAlert, Bot } from 'lucide-react';
import { format } from 'date-fns';
import { getQAEntries, createQAEntry, updateQAEntry, deleteQAEntry, purgeArchivedQAEntries } from '../api';
import { AIChatQA as QAEntry, QAChannel, QAStatus } from '../types';
import { Modal, Spinner, EmptyState, ConfirmDialog } from '../components/ui';
import { useAuth } from '../context/AuthContext';

const CHANNEL_LABELS: Record<QAChannel, string> = {
  PEEKVIEWER_AI: 'Peekviewer AI',
  PENDING_AI: 'Pending AI',
  UPDATE_DATA_AI: 'Update data AI',
  UMOBIX_AI: 'uMobix AI',
  XMOBI_AI: 'xMobi AI',
  SPYBUBBLE_AI: 'Spybubble AI',
  XNSPY_AI: 'Xnspy AI',
  GEOFINDER_AI: 'Geofinder AI',
  GEOFINDER_USERSPACE_AI: 'Geofinder userspace AI',
  LOCATIONTRACKER_AI: 'Locationtracker AI',
  GEOTRACKING_PRO_AI: 'Geotracking.pro AI',
  FOLLOWERS_STORY_PRO_AI: 'Followers-story.pro AI',
  LOCATIONTRACKIN_PRO_AI: 'Locationtrackin.pro AI',
  ACCOUNTVIEWER_AI: 'Accountviewer AI',
};

const CHANNEL_COLORS: Record<QAChannel, string> = {
  PEEKVIEWER_AI: 'bg-violet-100 text-violet-700',
  PENDING_AI: 'bg-amber-100 text-amber-700',
  UPDATE_DATA_AI: 'bg-cyan-100 text-cyan-700',
  UMOBIX_AI: 'bg-emerald-100 text-emerald-700',
  XMOBI_AI: 'bg-rose-100 text-rose-700',
  SPYBUBBLE_AI: 'bg-fuchsia-100 text-fuchsia-700',
  XNSPY_AI: 'bg-sky-100 text-sky-700',
  GEOFINDER_AI: 'bg-lime-100 text-lime-700',
  GEOFINDER_USERSPACE_AI: 'bg-indigo-100 text-indigo-700',
  LOCATIONTRACKER_AI: 'bg-amber-100 text-amber-800',
  GEOTRACKING_PRO_AI: 'bg-purple-100 text-purple-700',
  FOLLOWERS_STORY_PRO_AI: 'bg-pink-100 text-pink-800',
  LOCATIONTRACKIN_PRO_AI: 'bg-orange-100 text-orange-700',
  ACCOUNTVIEWER_AI: 'bg-slate-100 text-slate-700',
};

const STATUS_COLORS: Record<QAStatus, string> = {
  OPEN:        'bg-rose-50 text-rose-600 border-rose-200/60',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 border-amber-200/60',
  DONE:        'bg-[#A1F96E]/20 text-[#0E0E0E] border-[#A1F96E]/40',
};

const STATUS_LABELS: Record<QAStatus, string> = {
  OPEN:        'Open',
  IN_PROGRESS: 'In Progress',
  DONE:        'Done',
};

const STATUS_OPTIONS: QAStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE'];

function StatusSelect({ value, onChange }: { value: QAStatus; onChange: (v: QAStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className={`rounded-lg border px-2 py-1 text-[10px] font-semibold flex items-center gap-1 cursor-pointer ${STATUS_COLORS[value]}`}
      >
        {STATUS_LABELS[value]}
        <span className="opacity-50 text-[8px]">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-slate-200 shadow-lg overflow-hidden flex flex-col min-w-[110px]">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onChange(s); setOpen(false); }}
              className={`px-3 py-1.5 text-[10px] font-semibold text-left transition-opacity ${STATUS_COLORS[s]} ${s === value ? 'opacity-100' : 'opacity-75 hover:opacity-100'}`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QACard({ entry, onStatusChange, onEdit, onDelete }: { entry: QAEntry; onStatusChange: (id: string, status: QAStatus) => void; onEdit: (entry: QAEntry) => void; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const preview = entry.chatText.slice(0, 120);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CHANNEL_COLORS[entry.channel]}`}>
            {CHANNEL_LABELS[entry.channel]}
          </span>
          <span className="text-xs text-slate-400">{format(new Date(entry.issueDate), 'dd MMM yyyy')}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusSelect
            value={entry.status || 'OPEN'}
            onChange={v => onStatusChange(entry.id, v)}
          />
          <button onClick={() => onEdit(entry)} className="text-xs text-brand-600 hover:text-brand-700">Edit</button>
          <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
        </div>
      </div>

      <div
        className="bg-slate-50 rounded-lg p-3 text-xs font-mono text-slate-600 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <p className="whitespace-pre-wrap">{expanded ? entry.chatText : preview}{!expanded && entry.chatText.length > 120 ? '...' : ''}</p>
        {entry.chatText.length > 120 && (
          <p className="text-brand-500 mt-1">{expanded ? 'Show less ↑' : 'Show more ↓'}</p>
        )}
      </div>

      <div className="mt-2 flex items-start gap-2">
        <TriangleAlert size={14} strokeWidth={1.5} className="text-red-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-slate-600">{entry.comment}</p>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        message="Delete this QA entry permanently?"
        onConfirm={() => { onDelete(entry.id); setConfirmDelete(false); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export default function AIChatQA() {
  const [entries, setEntries] = useState<QAEntry[]>([]);
  const { user } = useAuth();
  const isAdmin = user?.role === 'head' || user?.role === 'lead';
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingEntry, setEditingEntry] = useState<QAEntry | null>(null);
  // One-off cleanup (head/lead only) — see qa.ts's purge-archived for the full writeup.
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purgeStatus, setPurgeStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [purgeResults, setPurgeResults] = useState<string[]>([]);

  // Form
  const [form, setForm] = useState({
    channel: 'PEEKVIEWER_AI' as QAChannel,
    status: 'OPEN' as QAStatus,
    chatText: '',
    issueDate: format(new Date(), 'yyyy-MM-dd'),
    comment: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await getQAEntries({ limit: 50 });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const closeForm = () => {
    setShowForm(false);
    setEditingEntry(null);
    setForm({ channel: 'PEEKVIEWER_AI', status: 'OPEN', chatText: '', issueDate: format(new Date(), 'yyyy-MM-dd'), comment: '' });
  };

  const handleEdit = (entry: QAEntry) => {
    setForm({
      channel: entry.channel,
      status: entry.status,
      chatText: entry.chatText,
      issueDate: format(new Date(entry.issueDate), 'yyyy-MM-dd'),
      comment: entry.comment,
    });
    setEditingEntry(entry);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.chatText || !form.comment) return;
    setSubmitting(true);
    try {
      if (editingEntry) {
        await updateQAEntry(editingEntry.id, form);
      } else {
        await createQAEntry(form);
      }
      closeForm();
      await loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  // Moving to Done doesn't persist that status at all — the entry is deleted
  // permanently the moment it lands there (request from Victoria Davis; the
  // archive feature is gone, so this is now the only way entries leave the board).
  const handleStatusChange = async (id: string, status: QAStatus) => {
    if (status === 'DONE') {
      setEntries(prev => prev.filter(entry => entry.id !== id));
      try {
        await deleteQAEntry(id);
        setTotal(t => t - 1);
      } catch (error) {
        console.error(error);
        await loadData();
      }
      return;
    }
    setEntries(prev => prev.map(entry => entry.id === id ? { ...entry, status } : entry));
    try {
      await updateQAEntry(id, { status });
    } catch (error) {
      console.error(error);
      await loadData();
    }
  };

  const handleDelete = async (id: string) => {
    await deleteQAEntry(id);
    setEntries(prev => prev.filter(e => e.id !== id));
    setTotal(t => t - 1);
  };

  const handlePurgeArchived = async () => {
    setShowPurgeConfirm(false);
    setPurgeStatus('running');
    try {
      const { deletedCount, deleted } = await purgeArchivedQAEntries();
      setPurgeResults(
        deletedCount === 0
          ? ['No archived entries found — nothing to delete.']
          : [
              `Permanently deleted ${deletedCount} archived entry/entries:`,
              ...deleted.map(d => `${CHANNEL_LABELS[d.channel as QAChannel] ?? d.channel} · ${format(new Date(d.issueDate), 'dd MMM yyyy')} · ${d.comment}`),
            ]
      );
      setPurgeStatus('done');
      await loadData();
    } catch (e) {
      console.error(e);
      setPurgeStatus('error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">AI Chats QA</h2>
          <p className="text-sm text-slate-400">Flag problematic bot responses — {total} entries total</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-accent whitespace-nowrap" onClick={() => setShowForm(true)}>+ Add QA Issue</button>
        </div>
      </div>

      {/* Temporary one-off cleanup (head/lead only) — see qa.ts's purge-archived. */}
      {isAdmin && (
        <div className="text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>
          {purgeStatus === 'idle' && (
            <button
              type="button"
              onClick={() => setShowPurgeConfirm(true)}
              className="font-medium text-slate-400 hover:text-slate-600 underline"
            >
              Permanently delete all archived QA entries
            </button>
          )}
          {purgeStatus === 'running' && <p className="text-slate-400">Deleting…</p>}
          {purgeStatus === 'error' && <p className="text-red-500">Failed — check console and try again.</p>}
          {purgeStatus === 'done' && (
            <div style={{ color: '#3ba648' }}>
              <p className="font-medium">✓ Done</p>
              <ul className="list-disc pl-4" style={{ color: 'rgba(14,14,14,0.45)' }}>
                {purgeResults.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : entries.length === 0 ? (
        <EmptyState icon={<Bot size={44} strokeWidth={1} />} message="No QA issues found" action={
          <button className="btn-accent" onClick={() => setShowForm(true)}>Add First Issue</button>
        } />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {entries.map(entry => (
            <QACard key={entry.id} entry={entry} onStatusChange={handleStatusChange} onEdit={handleEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Add / Edit QA Modal */}
      <Modal open={showForm} onClose={closeForm} title={editingEntry ? 'Edit QA Issue' : 'Add QA Issue'} maxWidth="max-w-xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Channel *</label>
              <select className="input" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value as QAChannel }))}>
                {Object.entries(CHANNEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as QAStatus }))}>
                {/* DONE isn't offered here — moving to Done permanently deletes the
                    entry (see handleStatusChange), so it only makes sense from the
                    card's own status dropdown, not while creating/editing. */}
                {['OPEN','IN_PROGRESS'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Issue Date *</label>
              <input type="date" className="input" value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Chat Text *</label>
            <textarea
              className="input resize-none font-mono text-xs"
              rows={6}
              placeholder="Paste the problematic chat conversation here..."
              value={form.chatText}
              onChange={e => setForm(f => ({ ...f, chatText: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">What's Wrong? *</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Explain the issue with this bot response..."
              value={form.comment}
              onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={closeForm}>Cancel</button>
            <button
              className="btn-accent flex-1"
              onClick={handleSubmit}
              disabled={submitting || !form.chatText || !form.comment}
            >
              {submitting ? 'Saving…' : editingEntry ? 'Save Changes' : 'Save Issue'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={showPurgeConfirm}
        message="Permanently delete every archived QA entry? This cannot be undone."
        onConfirm={handlePurgeArchived}
        onCancel={() => setShowPurgeConfirm(false)}
      />
    </div>
  );
}
