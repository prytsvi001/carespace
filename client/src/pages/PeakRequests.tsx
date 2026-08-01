// client/src/pages/PeakRequests.tsx
import React, { useEffect, useRef, useState } from 'react';
import { ClipboardList, Copy, Check, ChevronDown, ChevronRight, Star, Pencil, Archive, Trash2, Plus } from 'lucide-react';
import { format } from 'date-fns';
import {
  getPeakRequests, createPeakRequest, updatePeakRequest,
  updatePeakRequestCardStatus, togglePeakRequestCardStar, archivePeakRequestCard, deletePeakRequestCard,
  patchPeakRequestFields, addPeakRequestComment, getDutyStatus, DutyStatus,
  getTodayLogs,
} from '../api';
import { ClientCardView, PeakRequestComment, RequestStatus, ShiftLog } from '../types';
import { Modal, EmptyState, ConfirmDialog, StatusStrip, CardListSkeleton } from '../components/ui';
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
  'Do we still have access to the target profile?',
  'Please change the extension',
  'Add to hot clients',
] as const;

const STATUS_COLS: { status: RequestStatus; label: string; icon: string; bg: string }[] = [
  { status: 'NEW',         label: 'New',         icon: '🆕', bg: 'bg-blue-50' },
  { status: 'IN_PROGRESS', label: 'In Progress',  icon: '⚡', bg: 'bg-amber-50' },
  { status: 'DONE',        label: 'Done',          icon: '✅', bg: 'bg-emerald-50' },
];

// Same NEW/IN_PROGRESS/DONE vocabulary + colors as StatusBadge in ui.tsx (badge-new/
// badge-progress/badge-done, already defined in index.css) — reused here directly
// since this dropdown needs each option individually clickable, not just one static span.
const STATUS_ORDER: RequestStatus[] = ['NEW', 'IN_PROGRESS', 'DONE'];
const STATUS_BADGE_CLASS: Record<RequestStatus, string> = {
  NEW: 'badge-new',
  IN_PROGRESS: 'badge-progress',
  DONE: 'badge-done',
};
const STATUS_LABEL: Record<RequestStatus, string> = {
  NEW: 'New',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
};

// ── StatusDropdownBadge ───────────────────────────────────────────────────────
// Click the badge to jump to any status directly, in either direction — not just
// the one-step-forward "→ Start/Done" shortcut this card already has (kept as-is
// alongside this, since nothing asked for it to be removed).

function StatusDropdownBadge({ status, onChange }: { status: RequestStatus; onChange: (s: RequestStatus) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`${STATUS_BADGE_CLASS[status]} inline-flex items-center gap-0.5 cursor-pointer hover:brightness-95 transition-all`}
      >
        {STATUS_LABEL[status]}
        <ChevronDown size={11} strokeWidth={2.5} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-slate-100 py-1 min-w-[132px]">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setOpen(false); if (s !== status) onChange(s); }}
                className="w-full flex items-center px-2 py-1 hover:bg-slate-50 transition-colors"
              >
                <span className={`${STATUS_BADGE_CLASS[s]} ${s === status ? 'ring-1 ring-slate-300' : ''}`}>
                  {STATUS_LABEL[s]}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── ClientCard ─────────────────────────────────────────────────────────────────
// One card per unique client. Shows the active (most recent) request expanded,
// with older requests collapsed behind a "History" disclosure.

function ClientCard({
  card, onEdit, onStatusChange, onToggleStar, onArchive, onDelete, onFieldsUpdated, highlightNew,
}: {
  card: ClientCardView;
  onEdit: (card: ClientCardView) => void;
  onStatusChange: (cardId: string, status: RequestStatus) => void;
  onToggleStar: (cardId: string, starred: boolean) => void;
  onArchive: (cardId: string) => void;
  onDelete: (cardId: string) => void;
  onFieldsUpdated: (requestId: string, fields: { comments?: PeakRequestComment[]; tags?: string }) => void;
  highlightNew?: boolean;
}) {
  const [confirm, setConfirm]             = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedField, setCopiedField]     = useState<'email' | 'nickname' | null>(null);

  const active = card.activeRequest;

  // Archived Done cards start collapsed to keep that column scannable — full
  // detail (request text, comments, tags, timestamps, history) is hidden until expanded.
  const isArchivedDone = card.archived && card.status === 'DONE';
  const [archivedViewExpanded, setArchivedViewExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // ── Comment thread state (active request only — history is read-only) ─────
  const [comments, setComments] = useState<PeakRequestComment[]>(active.comments);
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // ── Tags state (active request only) ───────────────────────────────────────
  const [activeTags, setActiveTags] = useState<TagKey[]>(() =>
    (active.tags || '').split(',').filter(Boolean) as TagKey[]
  );
  // Compact by default: an empty tag set shows a single "+ Tag" affordance
  // instead of all 3 ghost options; picking one collapses straight back to
  // the compact chip view rather than staying open.
  const [showTagPicker, setShowTagPicker] = useState(false);

  // Sync when parent refreshes (e.g. after Edit modal save, or a new request lands)
  useEffect(() => {
    setComments(active.comments);
  }, [active.comments, active.id]);

  useEffect(() => {
    setActiveTags((active.tags || '').split(',').filter(Boolean) as TagKey[]);
  }, [active.tags, active.id]);

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
      const updated = await addPeakRequestComment(active.id, text);
      setComments(updated.comments);
      setCommentDraft('');
      onFieldsUpdated(active.id, { comments: updated.comments });
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
    setShowTagPicker(false);
    const tagsStr = next.join(',');
    try {
      await patchPeakRequestFields(active.id, { tags: tagsStr });
      onFieldsUpdated(active.id, { tags: tagsStr });
    } catch (e) {
      console.error(e);
      setActiveTags(activeTags);
    }
  };

  const nextStatus: Record<RequestStatus, RequestStatus | null> = {
    NEW: 'IN_PROGRESS', IN_PROGRESS: 'DONE', DONE: null,
  };
  const next = nextStatus[card.status];

  if (isArchivedDone && !archivedViewExpanded) {
    return (
      <div className="bg-white rounded-xl border border-slate-100 p-2.5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            {card.contactEmail && (
              <span className="text-xs text-slate-500 truncate">📧 {card.contactEmail}</span>
            )}
            {card.profileNickname && (
              <span className="text-xs text-slate-500 truncate">👤 {card.profileNickname}</span>
            )}
            {!card.contactEmail && !card.profileNickname && (
              <span className="text-xs text-slate-400 italic">No contact info</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setArchivedViewExpanded(true)}
            className="shrink-0 text-xs px-2 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
          >
            Expand
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border p-2.5 shadow-sm hover:shadow-md transition-shadow
      ${highlightNew ? 'border-blue-200 ring-1 ring-blue-100' : 'border-slate-100'}`}>

      {/* peek_handler new indicator */}
      {highlightNew && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block" />
          <span className="text-[10px] text-blue-400 font-semibold uppercase tracking-wide">New</span>
        </div>
      )}

      {/* Header row 1: star + email + nickname (+ inline copy) + last activity */}
      <div className="flex items-center gap-1.5 mb-1">
        <button
          type="button"
          onClick={() => onToggleStar(card.id, !card.starred)}
          className="shrink-0 transition-transform hover:scale-110"
          aria-label={card.starred ? 'Remove priority' : 'Mark as priority'}
          title={card.starred ? 'Remove priority' : 'Mark as priority'}
        >
          <Star
            size={15}
            strokeWidth={1.8}
            fill={card.starred ? '#D4A847' : 'none'}
            style={{ color: card.starred ? '#D4A847' : 'rgba(14,14,14,0.25)' }}
          />
        </button>

        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          {card.contactEmail && (
            <span className="inline-flex items-center gap-0.5 min-w-0">
              <span className="text-xs font-semibold text-slate-700 truncate">{card.contactEmail}</span>
              <button type="button" onClick={() => handleCopy(card.contactEmail!, 'email')}
                className="shrink-0 text-slate-300 hover:text-slate-500 transition-colors" title="Copy email">
                {copiedField === 'email'
                  ? <Check size={10} strokeWidth={2} className="text-emerald-500" />
                  : <Copy size={10} strokeWidth={1.5} />}
              </button>
            </span>
          )}
          {card.profileNickname && (
            <span className="inline-flex items-center gap-0.5 min-w-0 shrink-0">
              <span className="text-xs text-slate-500 truncate">👤 {card.profileNickname}</span>
              <button type="button" onClick={() => handleCopy(card.profileNickname!, 'nickname')}
                className="shrink-0 text-slate-300 hover:text-slate-500 transition-colors" title="Copy nickname">
                {copiedField === 'nickname'
                  ? <Check size={10} strokeWidth={2} className="text-emerald-500" />
                  : <Copy size={10} strokeWidth={1.5} />}
              </button>
            </span>
          )}
          {!card.contactEmail && !card.profileNickname && (
            <span className="text-xs text-slate-400 italic">No contact info</span>
          )}
        </div>
      </div>

      {/* Header row 2: status + count + new-activity indicator */}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <StatusDropdownBadge status={card.status} onChange={(s) => onStatusChange(card.id, s)} />
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
          {card.requestCount} {card.requestCount === 1 ? 'request' : 'requests'}
        </span>
        {card.hasNewActivity && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#0E0E0E' }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ backgroundColor: '#A1F96E' }} />
            New activity
          </span>
        )}
      </div>

      {/* Active request body */}
      <p className="text-sm text-slate-700 leading-relaxed mb-1">{active.requestText}</p>

      {/* Tags — compact chips when set, a single "+ Tag" affordance when empty */}
      <div className="flex flex-wrap items-center gap-1 mb-1.5">
        {activeTags.length > 0 && TAGS.filter(tag => activeTags.includes(tag.key)).map(tag => (
          <button
            key={tag.key}
            type="button"
            onClick={() => handleTagToggle(tag.key)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-all ${tag.selected}`}
            title="Click to remove"
          >
            <span>{tag.emoji}</span>
            <span>{tag.label}</span>
          </button>
        ))}
        {showTagPicker && TAGS.filter(tag => !activeTags.includes(tag.key)).map(tag => (
          <button
            key={tag.key}
            type="button"
            onClick={() => handleTagToggle(tag.key)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-all ${tag.ghost}`}
          >
            <span>{tag.emoji}</span>
            <span>{tag.label}</span>
          </button>
        ))}
        {activeTags.length === 0 && !showTagPicker && (
          <button
            type="button"
            onClick={() => setShowTagPicker(true)}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium border border-dashed border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-colors"
          >
            <Plus size={10} strokeWidth={2} />
            Tag
          </button>
        )}
        {activeTags.length > 0 && activeTags.length < TAGS.length && (
          <button
            type="button"
            onClick={() => setShowTagPicker(v => !v)}
            className="shrink-0 p-0.5 rounded text-slate-300 hover:text-slate-500 transition-colors"
            aria-label={showTagPicker ? 'Close tag picker' : 'Add another tag'}
            title={showTagPicker ? 'Close' : 'Add another tag'}
          >
            <Plus size={11} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Logged-by + one-step status transition + icon-only actions */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] text-slate-400 truncate">
          Logged by {active.agent.name} · {format(new Date(active.createdAt), "MMM d, yyyy 'at' HH:mm")}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {next && (
            <button
              onClick={() => onStatusChange(card.id, next)}
              className="text-xs px-2 py-0.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
            >
              → {next === 'IN_PROGRESS' ? 'Start' : 'Done'}
            </button>
          )}
          {isArchivedDone && (
            <button onClick={() => setArchivedViewExpanded(false)} className="text-[10px] text-slate-400 hover:text-slate-600">Collapse</button>
          )}
          <button onClick={() => onEdit(card)} className="p-1 rounded hover:bg-black/5 transition-colors text-slate-400 hover:text-brand-600" aria-label="Edit" title="Edit">
            <Pencil size={13} strokeWidth={1.8} />
          </button>
          <button onClick={() => setConfirm(true)} className="p-1 rounded hover:bg-amber-50 transition-colors text-slate-400 hover:text-amber-600" aria-label="Archive" title="Archive">
            <Archive size={13} strokeWidth={1.8} />
          </button>
          <button onClick={() => setConfirmDelete(true)} className="p-1 rounded hover:bg-red-50 transition-colors text-slate-400 hover:text-red-600" aria-label="Delete" title="Delete">
            <Trash2 size={13} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* ── Comment thread ──────────────────────────────────────────────────── */}
      <div className="pt-2 space-y-2" style={{ borderTop: '1px solid rgba(14,14,14,0.07)' }}>
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

      {/* ── History (previous requests) — collapsed by default, subdued style ── */}
      {card.history.length > 0 && (
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(14,14,14,0.06)' }}>
          <button
            type="button"
            onClick={() => setHistoryExpanded(v => !v)}
            className="flex items-center gap-1 text-[11px] font-medium transition-colors hover:text-slate-500"
            style={{ color: 'rgba(14,14,14,0.38)' }}
          >
            {historyExpanded ? <ChevronDown size={11} strokeWidth={2} /> : <ChevronRight size={11} strokeWidth={2} />}
            History ({card.history.length} previous {card.history.length === 1 ? 'request' : 'requests'})
          </button>

          {historyExpanded && (
            <div className="mt-1.5 space-y-2 pl-3" style={{ borderLeft: '2px solid rgba(14,14,14,0.07)' }}>
              {card.history.map(h => (
                <div key={h.id} className="text-xs">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span style={{ color: 'rgba(14,14,14,0.35)' }}>
                      {format(new Date(h.createdAt), "MMM d, yyyy 'at' HH:mm")}
                    </span>
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.45)' }}
                    >
                      Resolved: {STATUS_LABEL[h.status]}
                    </span>
                  </div>
                  <p style={{ color: 'rgba(14,14,14,0.55)' }}>{h.requestText}</p>
                  {h.comments.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {h.comments.map((c, i) => (
                        <p key={i} style={{ color: 'rgba(14,14,14,0.40)' }}>
                          <span className="font-medium">{c.authorName}:</span> {c.text}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog open={confirm} message="Archive this client card?"
        onConfirm={() => { onArchive(card.id); setConfirm(false); }}
        onCancel={() => setConfirm(false)} />
      <ConfirmDialog open={confirmDelete} message="Delete this client card and its full request history permanently?"
        onConfirm={() => { onDelete(card.id); setConfirmDelete(false); }}
        onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}

// ── PeakRequests page ─────────────────────────────────────────────────────────

export default function PeakRequests({ onDataChanged }: { onDataChanged?: () => void }) {
  const { user } = useAuth();
  const isPeekHandler = user?.role === 'peek_handler';
  const [cards, setCards] = useState<ClientCardView[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAgent, setFilterAgent]   = useState('');
  const [search, setSearch]             = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [dutyInfo, setDutyInfo] = useState<DutyStatus | null>(null);
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null);
  const [activeShiftLogs, setActiveShiftLogs] = useState<ShiftLog[]>([]);

  // Ids (of ClientCards) with an in-flight optimistic mutation (status change /
  // star toggle / archive / delete). The 20s background poll below does a
  // full-array replace from whatever the server returns — if that GET was
  // issued before the mutation reached the server but resolves after the
  // optimistic local update, applying it as-is would silently revert (or
  // resurrect) that one card until the next poll catches up. That reads as
  // "the button didn't work," so the poll below skips overwriting any card
  // still listed here.
  const pendingMutations = useRef<Set<string>>(new Set());

  useEffect(() => {
    const loadDuty = () => getDutyStatus().then(setDutyInfo).catch(() => {});
    loadDuty();
    const id = setInterval(loadDuty, 20_000);
    return () => clearInterval(id);
  }, []);

  // Same "active shift" data source as the Daily Log tab's Online now strip —
  // agents who've started a shift but not yet clicked End Shift.
  useEffect(() => {
    const loadActiveShifts = () => getTodayLogs().then(setActiveShiftLogs).catch(() => {});
    loadActiveShifts();
    const id = setInterval(loadActiveShifts, 20_000);
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
      setCards(prev => {
        if (pendingMutations.current.size === 0) return reqData.cards;
        const prevById = new Map(prev.map(c => [c.id, c]));
        return (reqData.cards as ClientCardView[])
          // A pending card that's no longer in local state was just archived/deleted
          // locally — drop it rather than let this stale fetch resurrect it.
          .filter((c: ClientCardView) => !pendingMutations.current.has(c.id) || prevById.has(c.id))
          // A pending card that's still present locally keeps its fresher local
          // version (e.g. the optimistic status/star change) instead of the stale fetch.
          .map((c: ClientCardView) => (pendingMutations.current.has(c.id) ? prevById.get(c.id)! : c));
      });
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
    setFormError('');
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
    } catch (e: any) {
      setFormError(e?.response?.data?.error ?? 'Failed to save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyPreset = (preset: string) => {
    setForm(f => ({ ...f, requestText: f.requestText.trim() ? `${f.requestText}\n${preset}` : preset }));
    setAppliedPreset(preset);
    setTimeout(() => setAppliedPreset(prev => (prev === preset ? null : prev)), 1000);
  };

  const handleStatusChange = async (cardId: string, status: RequestStatus) => {
    pendingMutations.current.add(cardId);
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, status } : c));
    try {
      await updatePeakRequestCardStatus(cardId, status);
      onDataChanged?.();
    } catch {
      // Clear the pending flag BEFORE this recovery reload — it needs to be
      // treated as authoritative (correcting the failed optimistic change),
      // not merged against the very local value it's supposed to overwrite.
      pendingMutations.current.delete(cardId);
      await loadData();
      return;
    }
    pendingMutations.current.delete(cardId);
  };

  const handleToggleStar = async (cardId: string, starred: boolean) => {
    pendingMutations.current.add(cardId);
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, starred } : c));
    try {
      await togglePeakRequestCardStar(cardId, starred);
    } catch (e) {
      console.error(e);
      pendingMutations.current.delete(cardId);
      await loadData();
      return;
    }
    pendingMutations.current.delete(cardId);
  };

  const handleArchive = async (cardId: string) => {
    pendingMutations.current.add(cardId);
    setCards(prev => prev.filter(c => c.id !== cardId));
    try {
      await archivePeakRequestCard(cardId);
      onDataChanged?.();
    } finally {
      pendingMutations.current.delete(cardId);
    }
  };

  const handleDelete = async (cardId: string) => {
    pendingMutations.current.add(cardId);
    setCards(prev => prev.filter(c => c.id !== cardId));
    try {
      await deletePeakRequestCard(cardId);
      onDataChanged?.();
    } finally {
      pendingMutations.current.delete(cardId);
    }
  };

  // Inline field updates (tags/comments) on the active request — no reload needed
  const handleFieldsUpdated = (requestId: string, fields: { comments?: PeakRequestComment[]; tags?: string }) => {
    setCards(prev => prev.map(c =>
      c.activeRequest.id === requestId ? { ...c, activeRequest: { ...c.activeRequest, ...fields } } : c
    ));
  };

  // Starred cards always lead their column, sorted by recency among themselves;
  // non-starred cards follow, also by recency.
  const byStatus = (status: RequestStatus) => cards
    .filter(c => c.status === status)
    .sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
    });

  const openNewForm = () => {
    setEditingId(null);
    setFormError('');
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

      {/* Support agents currently on an active shift (Daily Log data, not the Shift Calendar schedule) */}
      <StatusStrip
        active={activeShiftLogs.length > 0}
        label="Support agent online"
        value={activeShiftLogs.map((log) => log.agent.name).join(', ')}
        offlineText="No support agents currently online"
      />

      {/* Peek Team on-duty toggle status */}
      {dutyInfo && (
        <StatusStrip
          active={dutyInfo.peekTeamOnline.length > 0}
          label="Peek Team Agent online"
          value={dutyInfo.peekTeamOnline.join(', ')}
          offlineText="No Peek agents currently online"
        />
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <CardListSkeleton count={2} />
          <CardListSkeleton count={1} />
          <CardListSkeleton count={2} />
        </div>
      ) : cards.length === 0 ? (
        <EmptyState icon={<ClipboardList size={44} strokeWidth={1} />} message="No requests yet" action={
          <button className="btn-accent" onClick={openNewForm}>Submit First Request</button>
        } />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STATUS_COLS.map(col => {
            const colCards = byStatus(col.status);
            return (
              <div key={col.status} className={`rounded-xl p-3 ${col.bg}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span>{col.icon}</span>
                    <h3 className="font-semibold text-slate-700 text-sm">{col.label}</h3>
                  </div>
                  <span className="bg-white text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full shadow-sm">
                    {colCards.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {colCards.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">Empty</p>
                  ) : colCards.map(card => (
                    <ClientCard
                      key={card.id}
                      card={card}
                      highlightNew={isPeekHandler && col.status === 'NEW'}
                      onEdit={(item) => {
                        setEditingId(item.activeRequest.id);
                        setFormError('');
                        setForm({
                          agentId: item.activeRequest.agentId,
                          contactEmail: item.contactEmail || '',
                          profileNickname: item.profileNickname || '',
                          requestText: item.activeRequest.requestText,
                        });
                        setShowForm(true);
                      }}
                      onStatusChange={handleStatusChange}
                      onToggleStar={handleToggleStar}
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
          {formError && <p className="text-xs text-red-500">{formError}</p>}
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
