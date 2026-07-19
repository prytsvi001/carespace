// client/src/pages/PeakRequests.tsx
import React, { useEffect, useState } from 'react';
import { ClipboardList, Copy, Check } from 'lucide-react';
import { format } from 'date-fns';
import {
  getPeakRequests, createPeakRequest, updatePeakRequest,
  updatePeakRequestStatus, archivePeakRequest, deletePeakRequest,
  patchPeakRequestFields, addPeakRequestComment, getDutyStatus, DutyStatus,
} from '../api';
import { PeakRequest, PeakRequestComment, RequestStatus } from '../types';
import { Modal, Spinner, EmptyState, ConfirmDialog } from '../components/ui';
import { PeekDutyToggle } from '../components/PeekDutyToggle';
import { useAuth } from '../context/AuthContext';

// ── Tag definitions ───────────────────────────────────────────────────────────

const TAGS = [
  {
    key: 'blocked',
    label: 'Blocked',
    emoji: '🔴',
    selected: 'bg-red-50 text-red-600 border-red-200',
    ghost:    'border-slate-200 text-slate-300',
  },
  {
    key: 'account_problem',
    label: 'Account problem',
    emoji: '🟡',
    selected: 'bg-amber-50 text-amber-600 border-amber-200',
    ghost:    'border-slate-200 text-slate-300',
  },
  {
    key: 'lost_access',
    label: 'Lost access',
    emoji: '🔑',
    selected: 'bg-slate-100 text-slate-500 border-slate-300',
    ghost:    'border-slate-200 text-slate-300',
  },
] as const;

type TagKey = typeof TAGS[number]['key'];

const REQUEST_PRESETS = [
  'Profile temporarily unavailable',
  'Refresh error',
  'Do we still have access to the target device?',
  'Please change the extension',
  'Add to hot clients',
] as const;

const STATUS_COLS: { status: RequestStatus; label: string; icon: string; bg: string }[] = [
  { status: 'NEW',         label: 'New',         icon: '🆕', bg: 'bg-blue-50' },
  { status: 'IN_PROGRESS', label: 'In Progress',  icon: '⚡', bg: 'bg-amber-50' },
  { status: 'DONE',        label: 'Done',          icon: '✅', bg: 'bg-emerald-50' },
];

// ── RequestCard ───────────────────────────────────────────────────────────────

function RequestCard({
  req, onEdit, onStatusChange, onArchive, onDelete, onFieldsUpdated, highlightNew,
}: {
  req: PeakRequest;
  onEdit: (req: PeakRequest) => void;
  onStatusChange: (id: string, status: RequestStatus) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onFieldsUpdated: (id: string, fields: { comments?: PeakRequestComment[]; tags?: string }) => void;
  highlightNew?: boolean;
}) {
  const [confirm, setConfirm]             = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedField, setCopiedField]     = useState<'email' | 'nickname' | null>(null);

  // ── Comment thread state ───────────────────────────────────────────────────
  const [comments, setComments] = useState<PeakRequestComment[]>(req.comments);
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // ── Tags state ─────────────────────────────────────────────────────────────
  const [activeTags, setActiveTags] = useState<TagKey[]>(() =>
    (req.tags || '').split(',').filter(Boolean) as TagKey[]
  );

  // Sync when parent refreshes (e.g. after Edit modal save)
  useEffect(() => {
    setComments(req.comments);
  }, [req.comments]);

  useEffect(() => {
    setActiveTags((req.tags || '').split(',').filter(Boolean) as TagKey[]);
  }, [req.tags]);

  // Copy-to-clipboard timeout
  useEffect(() => {
    if (!copiedField) return;
    const t = setTimeout(() => setCopiedField(null), 1500);
    return () => clearTimeout(t);
  }, [copiedField]);

  const handleCopy = async (text: string, field: 'email' | 'nickname') => {
    try { await navigator.clipboard.writeText(text); setCopiedField(field); }
    catch (e) { console.error('copy failed', e); }
  };

  // ── Post comment ───────────────────────────────────────────────────────────
  const handlePostComment = async () => {
    const text = commentDraft.trim();
    if (!text) return;
    setPostingComment(true);
    try {
      const updated = await addPeakRequestComment(req.id, text);
      setComments(updated.comments);
      setCommentDraft('');
      onFieldsUpdated(req.id, { comments: updated.comments });
    } catch (e) {
      console.error(e);
    } finally {
      setPostingComment(false);
    }
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handlePostComment();
    }
  };

  // ── Tag toggle ─────────────────────────────────────────────────────────────
  const handleTagToggle = async (key: TagKey) => {
    const next: TagKey[] = activeTags.includes(key)
      ? activeTags.filter(t => t !== key)
      : [...activeTags, key];
    setActiveTags(next);
    const tagsStr = next.join(',');
    try {
      await patchPeakRequestFields(req.id, { tags: tagsStr });
      onFieldsUpdated(req.id, { tags: tagsStr });
    } catch (e) {
      console.error(e);
      setActiveTags(activeTags);
    }
  };

  const nextStatus: Record<RequestStatus, RequestStatus | null> = {
    NEW: 'IN_PROGRESS', IN_PROGRESS: 'DONE', DONE: null,
  };
  const next = nextStatus[req.status];

  return (
    <div className={`bg-white rounded-xl border p-3 shadow-sm hover:shadow-md transition-shadow
      ${highlightNew ? 'border-blue-200 ring-1 ring-blue-100' : 'border-slate-100'}`}>

      {/* peek_handler new indicator */}
      {highlightNew && (
        <div className="flex items-center gap-1.5 mb-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
          <span className="text-[10px] text-blue-400 font-semibold uppercase tracking-wide">New</span>
        </div>
      )}

      {/* Header: agent + actions */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-slate-500">{req.agent.name}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => onEdit(req)} className="text-xs text-brand-600 hover:text-brand-700">Edit</button>
          <button onClick={() => setConfirm(true)} className="text-xs text-amber-600 hover:text-amber-700">Archive</button>
          <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
        </div>
      </div>

      {/* Request body */}
      <p className="text-sm text-slate-700 leading-relaxed mb-3">{req.requestText}</p>

      {/* Contact info */}
      {(req.contactEmail || req.profileNickname) && (
        <div className="flex flex-col gap-0.5 mb-2">
          {req.contactEmail && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="shrink-0">📧</span>
              <span className="flex-1 truncate">{req.contactEmail}</span>
              <button type="button" onClick={() => handleCopy(req.contactEmail!, 'email')}
                className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors" title="Copy email">
                {copiedField === 'email'
                  ? <Check size={12} strokeWidth={2} className="text-emerald-500" />
                  : <Copy size={12} strokeWidth={1.5} />}
              </button>
            </div>
          )}
          {req.profileNickname && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="shrink-0">👤</span>
              <span className="flex-1 truncate">{req.profileNickname}</span>
              <button type="button" onClick={() => handleCopy(req.profileNickname!, 'nickname')}
                className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors" title="Copy nickname">
                {copiedField === 'nickname'
                  ? <Check size={12} strokeWidth={2} className="text-emerald-500" />
                  : <Copy size={12} strokeWidth={1.5} />}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Created timestamp + status transition */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">Created: {format(new Date(req.createdAt), "MMM d, yyyy 'at' HH:mm")}</span>
        {next && (
          <button
            onClick={() => onStatusChange(req.id, next)}
            className="text-xs px-2 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
          >
            → {next === 'IN_PROGRESS' ? 'Start' : 'Done'}
          </button>
        )}
      </div>

      {/* ── Inline tags + note ──────────────────────────────────────────────── */}
      <div className="mt-2.5 pt-2.5 space-y-2" style={{ borderTop: '1px solid rgba(14,14,14,0.07)' }}>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {TAGS.map(tag => {
            const isActive = activeTags.includes(tag.key);
            return (
              <button
                key={tag.key}
                type="button"
                onClick={() => handleTagToggle(tag.key)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-all
                  ${isActive ? tag.selected : tag.ghost}`}
              >
                <span>{tag.emoji}</span>
                <span>{tag.label}</span>
              </button>
            );
          })}
        </div>

        {/* Comment thread */}
        <div className="space-y-1.5">
          {comments.length > 0 && (
            <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
              {comments.map((c, i) => (
                <div key={i} className="rounded-lg px-2 py-1.5" style={{ backgroundColor: 'rgba(14,14,14,0.025)' }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-slate-600">{c.authorName}</span>
                    <span className="text-[10px]" style={{ color: 'rgba(14,14,14,0.35)' }}>
                      {format(new Date(c.createdAt), "MMM d, yyyy 'at' HH:mm")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-snug">{c.text}</p>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={commentDraft}
            rows={2}
            placeholder="Add a comment…"
            className="w-full resize-none rounded-lg px-2 py-1.5 text-xs outline-none transition-colors"
            style={{
              border: '1px solid rgba(14,14,14,0.10)',
              color: 'rgba(14,14,14,0.60)',
              backgroundColor: 'rgba(14,14,14,0.025)',
            }}
            onChange={e => setCommentDraft(e.target.value)}
            onKeyDown={handleCommentKeyDown}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handlePostComment}
              disabled={postingComment || !commentDraft.trim()}
              className="text-[10px] px-2 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 font-medium transition-colors disabled:opacity-50"
            >
              {postingComment ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog open={confirm} message="Archive this request?"
        onConfirm={() => { onArchive(req.id); setConfirm(false); }}
        onCancel={() => setConfirm(false)} />
      <ConfirmDialog open={confirmDelete} message="Delete this request permanently?"
        onConfirm={() => { onDelete(req.id); setConfirmDelete(false); }}
        onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}

// ── PeakRequests page ─────────────────────────────────────────────────────────

export default function PeakRequests({ onDataChanged }: { onDataChanged?: () => void }) {
  const { user } = useAuth();
  const isPeekHandler = user?.role === 'peek_handler';
  const [requests, setRequests] = useState<PeakRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAgent, setFilterAgent]   = useState('');
  const [search, setSearch]             = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [dutyInfo, setDutyInfo] = useState<DutyStatus | null>(null);
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null);

  useEffect(() => {
    const loadDuty = () => getDutyStatus().then(setDutyInfo).catch(() => {});
    loadDuty();
    const id = setInterval(loadDuty, 20_000);
    return () => clearInterval(id);
  }, []);

  const [form, setForm] = useState({
    agentId: '',
    contactEmail: '',
    profileNickname: '',
    requestText: '',
  });

  const loadData = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const reqData = await getPeakRequests({
        status: filterStatus || undefined,
        agentId: filterAgent || undefined,
        search: search || undefined,
        limit: 200,
        includeArchived: showArchived,
      });
      setRequests(reqData.requests);
    } catch (e) {
      console.error(e);
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);

    // Poll so requests submitted by other agents show up without a manual refresh
    const id = setInterval(() => loadData(false), 20_000);
    return () => clearInterval(id);
  }, [filterStatus, filterAgent, search, showArchived]);

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
      setForm({ agentId: '', contactEmail: '', profileNickname: '', requestText: '' });
      await loadData();
      onDataChanged?.();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyPreset = (preset: string) => {
    setForm(f => ({ ...f, requestText: f.requestText.trim() ? `${f.requestText}\n${preset}` : preset }));
    setAppliedPreset(preset);
    setTimeout(() => setAppliedPreset(prev => (prev === preset ? null : prev)), 1000);
  };

  const handleStatusChange = async (id: string, status: RequestStatus) => {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    try {
      await updatePeakRequestStatus(id, status);
      onDataChanged?.();
    } catch {
      await loadData();
    }
  };

  const handleArchive = async (id: string) => {
    setRequests(prev => prev.filter(r => r.id !== id));
    await archivePeakRequest(id);
    onDataChanged?.();
  };

  const handleDelete = async (id: string) => {
    setRequests(prev => prev.filter(r => r.id !== id));
    await deletePeakRequest(id);
    onDataChanged?.();
  };

  // Inline field updates — no reload needed
  const handleFieldsUpdated = (id: string, fields: { comments?: PeakRequestComment[]; tags?: string }) => {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, ...fields } : r));
  };

  const byStatus = (status: RequestStatus) => requests.filter(r => r.status === status);

  const openNewForm = () => {
    setEditingId(null);
    setForm({
      agentId: user?.agentId || '',
      contactEmail: '',
      profileNickname: '',
      requestText: '',
    });
    setShowForm(true);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Peek Requests</h2>
          <p className="text-sm text-slate-400">Peekviewer Client Requests</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <PeekDutyToggle />
          <button className="btn-secondary whitespace-nowrap" onClick={() => setShowArchived(v => !v)}>
            {showArchived ? 'Hide Archive' : 'Show Archive'}
          </button>
          <button className="btn-accent whitespace-nowrap" onClick={openNewForm}>+ New Request</button>
        </div>
      </div>

      {/* Who's online / on shift */}
      {dutyInfo && (
        <div
          className="flex flex-wrap gap-x-6 gap-y-1 text-sm rounded-xl px-4 py-3"
          style={{ backgroundColor: 'rgba(14,14,14,0.03)', border: '1px solid rgba(14,14,14,0.07)' }}
        >
          <span>
            <span className="font-semibold text-slate-700">Peek Team Agent online:</span>{' '}
            <span className="text-slate-500">
              {dutyInfo.peekTeamOnline.length > 0 ? dutyInfo.peekTeamOnline.join(', ') : 'No one online'}
            </span>
          </span>
          <span>
            <span className="font-semibold text-slate-700">Support agent online:</span>{' '}
            <span className="text-slate-500">
              {[
                dutyInfo.supportShift.morning ? `${dutyInfo.supportShift.morning} (Morning)` : null,
                dutyInfo.supportShift.night ? `${dutyInfo.supportShift.night} (Night)` : null,
              ].filter(Boolean).join(', ') || '—'}
            </span>
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input className="input w-auto text-sm" placeholder="Search email or words"
          value={search} onChange={e => setSearch(e.target.value)} />
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
          <button className="btn-accent" onClick={openNewForm}>Submit First Request</button>
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
                      highlightNew={isPeekHandler && col.status === 'NEW'}
                      onEdit={(item) => {
                        setEditingId(item.id);
                        setForm({
                          agentId: item.agentId,
                          contactEmail: item.contactEmail || '',
                          profileNickname: item.profileNickname || '',
                          requestText: item.requestText,
                        });
                        setShowForm(true);
                      }}
                      onStatusChange={handleStatusChange}
                      onArchive={handleArchive}
                      onDelete={handleDelete}
                      onFieldsUpdated={handleFieldsUpdated}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Request Modal */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingId(null); }}
        title={editingId ? 'Edit Peak Request' : 'New Peak Request'}>
        <div className="space-y-4">
          <div>
            <label className="label">Customer Email</label>
            <input className="input" value={form.contactEmail || ''}
              onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
              placeholder="support@example.com" />
          </div>
          <div>
            <label className="label">Profile nickname</label>
            <input className="input" value={form.profileNickname || ''}
              onChange={e => setForm(f => ({ ...f, profileNickname: e.target.value }))}
              placeholder="Enter the profile nickname..." />
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
            <div className="mt-1.5">
              <span className="text-[10px] text-slate-400 font-medium">Quick select:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {REQUEST_PRESETS.map(preset => {
                  const justApplied = appliedPreset === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleApplyPreset(preset)}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-all
                        ${justApplied ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300'}`}
                    >
                      {justApplied && <Check size={10} strokeWidth={2.5} />}
                      <span>{preset}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {!form.agentId && (
            <p className="text-xs text-red-500">
              Your account isn't linked to an agent profile, so a request can't be submitted. Contact an admin to get linked.
            </p>
          )}
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
