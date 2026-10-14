// client/src/components/peekviewerIssues.tsx
// Support → Peekviewer team escalations from a Peek Requests card.
// SendToPeekviewerModal: the card's "Send to Peekviewer" form (To, Peeker,
// Issue, Comment). PeekviewerIssuesPanel: the urgent block at the top of a
// Peekviewer team member's Inbox, where they close each issue as Resolved /
// Blocked / Suspended / Other — the outcome is posted back on the card.
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Send, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  getPeekviewerIssueRecipients, sendPeekviewerIssue, getMyPeekviewerIssues, closePeekviewerIssue,
  PeekviewerIssueData, PeekviewerIssueOutcome,
} from '../api';
import { PeakRequestComment } from '../types';
import { Modal, RichText } from './ui';

const OUTCOME_META: Record<PeekviewerIssueOutcome, { label: string; bg: string; text: string }> = {
  resolved:  { label: 'Resolved',  bg: 'rgba(161,249,110,0.28)', text: '#166534' },
  blocked:   { label: 'Blocked',   bg: 'rgba(239,68,68,0.12)',   text: '#b91c1c' },
  suspended: { label: 'Suspended', bg: 'rgba(245,158,11,0.14)',  text: '#b45309' },
  other:     { label: 'Other',     bg: 'rgba(14,14,14,0.07)',    text: 'rgba(14,14,14,0.65)' },
};

export function SendToPeekviewerModal({ open, onClose, clientCardId, onSent }: {
  open: boolean;
  onClose: () => void;
  clientCardId: string;
  onSent: (card: { requestId: string; comments: PeakRequestComment[] } | null) => void;
}) {
  const [recipients, setRecipients] = useState<{ id: string; name: string }[]>([]);
  const [to, setTo] = useState<string[]>([]);
  const [peeker, setPeeker] = useState('');
  const [issue, setIssue] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTo([]); setPeeker(''); setIssue(''); setComment(''); setError('');
    getPeekviewerIssueRecipients().then(setRecipients).catch((e) => console.error(e));
  }, [open]);

  const toggle = (id: string) => setTo((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSend = async () => {
    if (to.length === 0 || !peeker.trim() || !issue.trim()) {
      setError('Pick at least one recipient and fill in Peeker and Issue.');
      return;
    }
    setSending(true);
    setError('');
    try {
      const sent = await sendPeekviewerIssue({ clientCardId, recipientIds: to, peeker, issue, comment });
      onSent(sent.card);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Send to Peekviewer">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">To <span className="text-red-400">*</span></label>
          <div className="flex flex-wrap gap-1.5">
            {recipients.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r.id)}
                className="text-xs font-medium px-2.5 py-1 rounded-full transition-all"
                style={to.includes(r.id)
                  ? { backgroundColor: '#A1F96E', color: '#0E0E0E' }
                  : { backgroundColor: 'rgba(14,14,14,0.05)', color: 'rgba(14,14,14,0.55)' }}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Peeker <span className="text-red-400">*</span></label>
          <input value={peeker} onChange={(e) => setPeeker(e.target.value)} className="input text-sm w-full" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Issue <span className="text-red-400">*</span></label>
          <textarea value={issue} onChange={(e) => setIssue(e.target.value)} rows={2} className="input text-sm w-full resize-y" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Comment</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="input text-sm w-full resize-y" />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end">
          <button
            onClick={handleSend}
            disabled={sending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
          >
            <Send size={13} strokeWidth={1.8} />
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function IssueField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(185,28,28,0.7)' }}>{label}</p>
      <RichText text={value} className="text-sm text-slate-800 whitespace-pre-wrap break-words" />
    </div>
  );
}

function OpenIssueCard({ issue, onClosed }: { issue: PeekviewerIssueData; onClosed: (id: string) => void }) {
  const [picking, setPicking] = useState<Exclude<PeekviewerIssueOutcome, 'resolved'> | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = async (outcome: PeekviewerIssueOutcome) => {
    if (outcome !== 'resolved' && !comment.trim()) { setError('Please add a comment.'); return; }
    setBusy(true);
    setError('');
    try {
      await closePeekviewerIssue(issue.id, outcome, outcome === 'resolved' ? undefined : comment.trim());
      onClosed(issue.id);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to save. Please try again.');
      // Someone else already closed it — drop it from this list.
      if (e?.response?.status === 409) setTimeout(() => onClosed(issue.id), 1500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-white p-3 space-y-3" style={{ border: '1.5px solid rgba(239,68,68,0.45)' }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <IssueField label="Peeker" value={issue.peeker} />
        <IssueField label="Issue" value={issue.issue} />
        <IssueField label="Comment" value={issue.comment} />
      </div>
      <p className="text-xs text-slate-400">
        From {issue.senderName} · {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}
        {issue.recipientNames.length > 1 && ` · sent to ${issue.recipientNames.join(', ')}`}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => close('resolved')}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
          style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
        >
          <CheckCircle2 size={13} strokeWidth={2} />
          Resolved
        </button>
        {(['blocked', 'suspended', 'other'] as const).map((o) => (
          <button
            key={o}
            onClick={() => { setPicking(picking === o ? null : o); setError(''); }}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
            style={picking === o
              ? { backgroundColor: OUTCOME_META[o].bg, color: OUTCOME_META[o].text, outline: `1px solid ${OUTCOME_META[o].text}` }
              : { backgroundColor: OUTCOME_META[o].bg, color: OUTCOME_META[o].text }}
          >
            {OUTCOME_META[o].label}
          </button>
        ))}
      </div>

      {picking && (
        <div className="flex items-start gap-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            autoFocus
            placeholder={`${OUTCOME_META[picking].label} — add your comment…`}
            className="input text-sm flex-1 resize-y"
          />
          <button
            onClick={() => close(picking)}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-all disabled:opacity-50"
            style={{ backgroundColor: OUTCOME_META[picking].bg, color: OUTCOME_META[picking].text }}
          >
            <Send size={12} strokeWidth={1.8} />
            Save
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// Top of the Peekviewer team's Inbox. Renders nothing for someone with no
// open issues and no handled history, so it's invisible to everyone else.
export function PeekviewerIssuesPanel({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState<PeekviewerIssueData[]>([]);
  const [handled, setHandled] = useState<PeekviewerIssueData[]>([]);
  const [showHandled, setShowHandled] = useState(false);

  const load = async () => {
    try { setOpen(await getMyPeekviewerIssues()); } catch (e) { console.error(e); }
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (showHandled) getMyPeekviewerIssues(true).then(setHandled).catch((e) => console.error(e));
  }, [showHandled]);

  const handleClosed = (id: string) => {
    setOpen((prev) => prev.filter((i) => i.id !== id));
    if (showHandled) getMyPeekviewerIssues(true).then(setHandled).catch((e) => console.error(e));
    onChanged?.();
  };

  return (
    <div className="space-y-2">
      {open.length > 0 && (
        <div className="rounded-2xl p-3 space-y-2" style={{ backgroundColor: 'rgba(239,68,68,0.06)' }}>
          <p className="flex items-center gap-1.5 text-sm font-bold" style={{ color: '#b91c1c' }}>
            <AlertTriangle size={15} strokeWidth={2} />
            Urgent — process ASAP ({open.length})
          </p>
          {open.map((i) => <OpenIssueCard key={i.id} issue={i} onClosed={handleClosed} />)}
        </div>
      )}

      <button
        onClick={() => setShowHandled((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600"
      >
        {showHandled ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Handled Peekviewer issues
      </button>
      {showHandled && (
        handled.length === 0 ? (
          <p className="text-xs text-slate-400 pl-4">Nothing handled yet.</p>
        ) : (
          <div className="space-y-1.5">
            {handled.map((i) => {
              const meta = OUTCOME_META[i.status as PeekviewerIssueOutcome];
              return (
                <div key={i.id} className="card py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 text-xs">
                    <p className="text-sm text-slate-700 truncate"><span className="font-semibold">{i.peeker}</span> — {i.issue}</p>
                    <p className="text-slate-400 mt-0.5">
                      {i.resolvedByName}{i.resolvedAt && ` · ${format(new Date(i.resolvedAt), 'dd MMM, HH:mm')}`}
                      {i.resolutionComment && ` · ${i.resolutionComment}`}
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: meta?.bg, color: meta?.text }}>
                    {meta?.label ?? i.status}
                  </span>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
