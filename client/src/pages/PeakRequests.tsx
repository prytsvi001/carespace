// client/src/pages/PeakRequests.tsx
import React, { useEffect, useState } from 'react';
import { ClipboardList, Copy, Check } from 'lucide-react';
import { format } from 'date-fns';
import { getAgents, getPeakRequests, createPeakRequest, updatePeakRequest, updatePeakRequestStatus, archivePeakRequest, deletePeakRequest } from '../api';
import { Agent, PeakRequest, RequestStatus } from '../types';
import { Modal, Spinner, EmptyState, StatusBadge, ConfirmDialog } from '../components/ui';

const STATUS_COLS: { status: RequestStatus; label: string; icon: string; bg: string }[] = [
  { status: 'NEW', label: 'New', icon: '🆕', bg: 'bg-blue-50' },
  { status: 'IN_PROGRESS', label: 'In Progress', icon: '⚡', bg: 'bg-amber-50' },
  { status: 'DONE', label: 'Done', icon: '✅', bg: 'bg-emerald-50' },
];

function RequestCard({ req, onEdit, onStatusChange, onArchive, onDelete }: {
  req: PeakRequest;
  onEdit: (req: PeakRequest) => void;
  onStatusChange: (id: string, status: RequestStatus) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedField, setCopiedField] = useState<'email' | 'nickname' | null>(null);
  const nextStatus: Record<RequestStatus, RequestStatus | null> = {
    NEW: 'IN_PROGRESS',
    IN_PROGRESS: 'DONE',
    DONE: null,
  };
  const next = nextStatus[req.status];

  useEffect(() => {
    if (!copiedField) return;
    const timer = setTimeout(() => setCopiedField(null), 1500);
    return () => clearTimeout(timer);
  }, [copiedField]);

  const handleCopy = async (text: string, field: 'email' | 'nickname') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
    } catch (error) {
      console.error('Failed to copy', error);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-slate-500">{req.agent.name}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => onEdit(req)} className="text-xs text-brand-600 hover:text-brand-700">Edit</button>
          <button onClick={() => setConfirm(true)} className="text-xs text-amber-600 hover:text-amber-700">Archive</button>
          <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
        </div>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed mb-3">{req.requestText}</p>
      {(req.contactEmail || req.profileNickname) && (
        <div className="flex flex-col gap-0.5 mb-2">
          {req.contactEmail && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="shrink-0">📧</span>
              <span className="flex-1 truncate">{req.contactEmail}</span>
              <button
                type="button"
                onClick={() => handleCopy(req.contactEmail!, 'email')}
                className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
                title="Copy email"
              >
                {copiedField === 'email' ? <Check size={12} strokeWidth={2} className="text-emerald-500" /> : <Copy size={12} strokeWidth={1.5} />}
              </button>
            </div>
          )}
          {req.profileNickname && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="shrink-0">👤</span>
              <span className="flex-1 truncate">{req.profileNickname}</span>
              <button
                type="button"
                onClick={() => handleCopy(req.profileNickname!, 'nickname')}
                className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
                title="Copy nickname"
              >
                {copiedField === 'nickname' ? <Check size={12} strokeWidth={2} className="text-emerald-500" /> : <Copy size={12} strokeWidth={1.5} />}
              </button>
            </div>
          )}
        </div>
      )}
      {req.comments && <p className="text-xs text-slate-500 mb-2">📝 {req.comments}</p>}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{format(new Date(req.requestDate), 'dd MMM yyyy')}</span>
        {next && (
          <button
            onClick={() => onStatusChange(req.id, next)}
            className="text-xs px-2 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
          >
            → {next === 'IN_PROGRESS' ? 'Start' : 'Done'}
          </button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        message="Archive this request?"
        onConfirm={() => { onArchive(req.id); setConfirm(false); }}
        onCancel={() => setConfirm(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        message="Delete this request permanently?"
        onConfirm={() => { onDelete(req.id); setConfirmDelete(false); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export default function PeakRequests() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [requests, setRequests] = useState<PeakRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [form, setForm] = useState({
    agentId: '',
    contactEmail: '',
    profileNickname: '',
    requestText: '',
    requestDate: format(new Date(), 'yyyy-MM-dd'),
    comments: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [agentData, reqData] = await Promise.all([
        getAgents(),
        getPeakRequests({ status: filterStatus || undefined, agentId: filterAgent || undefined, search: search || undefined, limit: 200, includeArchived: showArchived }),
      ]);
      setAgents(agentData);
      setRequests(reqData.requests);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [filterStatus, filterAgent, search, showArchived]);

  const handleSubmit = async () => {
    if (!form.agentId || !form.requestText) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await updatePeakRequest(editingId, form);
      } else {
        await createPeakRequest(form);
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ agentId: '', contactEmail: '', profileNickname: '', requestText: '', requestDate: format(new Date(), 'yyyy-MM-dd'), comments: '' });
      await loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, status: RequestStatus) => {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    try {
      await updatePeakRequestStatus(id, status);
    } catch {
      await loadData();
    }
  };

  const handleArchive = async (id: string) => {
    setRequests(prev => prev.filter(r => r.id !== id));
    await archivePeakRequest(id);
  };
  const handleDelete = async (id: string) => {
    setRequests(prev => prev.filter(r => r.id !== id));
    await deletePeakRequest(id);
  };

  const byStatus = (status: RequestStatus) => requests.filter(r => r.status === status);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Peek Requests</h2>
          <p className="text-sm text-slate-400">Peekviewer Client Requests</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary whitespace-nowrap" onClick={() => setShowArchived(v => !v)}>{showArchived ? 'Hide Archive' : 'Show Archive'}</button>
          <button className="btn-accent whitespace-nowrap" onClick={() => setShowForm(true)}>+ New Request</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input className="input w-auto text-sm" placeholder="Search email or words" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1">
          {['', ...STATUS_COLS.map(s => s.status)].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filterStatus === s ? 'text-[#0E0E0E]' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              style={filterStatus === s ? { backgroundColor: 'rgba(161,249,110,0.30)' } : {}}
            >
              {s === '' ? 'All' : STATUS_COLS.find(c => c.status === s)?.label}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : requests.length === 0 ? (
        <EmptyState icon={<ClipboardList size={44} strokeWidth={1} />} message="No requests yet" action={
          <button className="btn-accent" onClick={() => setShowForm(true)}>Submit First Request</button>
        } />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STATUS_COLS.map(col => {
            const colRequests = byStatus(col.status);
            return (
              <div key={col.status} className={`rounded-xl p-3 ${col.bg}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span>{col.icon}</span>
                    <h3 className="font-semibold text-slate-700 text-sm">{col.label}</h3>
                  </div>
                  <span className="bg-white text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full shadow-sm">
                    {colRequests.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {colRequests.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">Empty</p>
                  ) : colRequests.map(req => (
                    <RequestCard
                      key={req.id}
                      req={req}
                      onEdit={(item) => {
                        setEditingId(item.id);
                        setForm({
                          agentId: item.agentId,
                          contactEmail: item.contactEmail || '',
                          profileNickname: item.profileNickname || '',
                          requestText: item.requestText,
                          requestDate: format(new Date(item.requestDate), 'yyyy-MM-dd'),
                          comments: item.comments || '',
                        });
                        setShowForm(true);
                      }}
                      onStatusChange={handleStatusChange}
                      onArchive={handleArchive}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Request Modal */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingId(null); }} title={editingId ? 'Edit Peak Request' : 'New Peak Request'}>
        <div className="space-y-4">
          <div>
            <label className="label">Agent *</label>
            <select className="input" value={form.agentId} onChange={e => setForm(f => ({ ...f, agentId: e.target.value }))}>
              <option value="">Select your name...</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" value={form.requestDate} onChange={e => setForm(f => ({ ...f, requestDate: e.target.value }))} />
          </div>

          <div>
            <label className="label">Customer Email</label>
            <input className="input" value={form.contactEmail || ''} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="support@example.com" />
          </div>

          <div>
            <label className="label">Profile nickname (issue)</label>
            <input className="input" value={form.profileNickname || ''} onChange={e => setForm(f => ({ ...f, profileNickname: e.target.value }))} placeholder="Enter the profile nickname..." />
          </div>

          <div>
            <label className="label">Request *</label>
            <textarea
              className="input resize-none"
              rows={4}
              placeholder="Describe the feature, improvement, or issue you want to flag..."
              value={form.requestText}
              onChange={e => setForm(f => ({ ...f, requestText: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Comments / Notes</label>
            <textarea className="input resize-none" rows={3} value={form.comments} onChange={e => setForm(f => ({ ...f, comments: e.target.value }))} placeholder="Any notes for the handler..." />
          </div>

          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</button>
            <button
              className="btn-accent flex-1"
              onClick={handleSubmit}
              disabled={submitting || !form.agentId || !form.requestText}
            >
              {submitting ? 'Submitting...' : editingId ? 'Save Changes' : 'Submit Request'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
