// client/src/components/qaReport.tsx
// Shared QA-report rendering pieces used by both QAReports.tsx (the compose/
// preview panel) and Inbox.tsx (so a received report looks the same there).
import React, { useRef, useState } from 'react';
import {
  AlertTriangle, MessageSquare, BellOff, ExternalLink, Pencil,
} from 'lucide-react';
import { Spinner, CollapsibleText } from './ui';

// ─── Issue type config ────────────────────────────────────────────────────────

export const ISSUE_TYPES = [
  {
    value: 'technical',
    label: 'Technical problem',
    shortLabel: 'Technical',
    cls: 'bg-rose-50 text-rose-600',
    Icon: AlertTriangle,
    iconCls: 'text-rose-400',
  },
  {
    value: 'communication',
    label: 'Communication problem',
    shortLabel: 'Communication',
    cls: 'bg-amber-50 text-amber-700',
    Icon: MessageSquare,
    iconCls: 'text-amber-400',
  },
  {
    value: 'no_response',
    label: 'No response',
    shortLabel: 'No response',
    cls: 'bg-slate-100 text-slate-500',
    Icon: BellOff,
    iconCls: 'text-slate-400',
  },
] as const;

export type IssueTypeValue = (typeof ISSUE_TYPES)[number]['value'];

export function issueTypeMeta(value: string) {
  return ISSUE_TYPES.find((t) => t.value === value) ?? ISSUE_TYPES[0];
}

export interface QAIssueLike {
  id: string;
  chatRef: string;
  issueType: string;
  notes: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isUrl(s: string) {
  try { new URL(s); return true; } catch { return false; }
}

export function fmt(n: number, decimals = 1) {
  return n.toFixed(decimals);
}

export function successColor(rate: number): string {
  if (rate >= 99) return '#16a34a';
  if (rate >= 97) return '#d97706';
  return '#dc2626';
}

export function computeIssueStats(issues: { issueType: string }[], totalChats: number | null) {
  const issueCount  = issues.length;
  const problemRate = totalChats ? (issueCount / totalChats) * 100 : null;
  const successRate = problemRate !== null ? 100 - problemRate : null;
  const typeCounts  = ISSUE_TYPES.map((t) => ({
    ...t,
    count: issues.filter((i) => i.issueType === t.value).length,
  }));
  return { issueCount, problemRate, successRate, typeCounts };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

export function IssueTypeBadge({ value }: { value: string }) {
  const meta = issueTypeMeta(value);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${meta.cls}`}>
      <meta.Icon size={10} strokeWidth={2} />
      {meta.shortLabel}
    </span>
  );
}

export function ChatRefDisplay({ chatRef }: { chatRef: string }) {
  if (isUrl(chatRef)) {
    let domain = chatRef;
    try { domain = new URL(chatRef).hostname.replace(/^www\./, ''); } catch { /* noop */ }
    return (
      <a
        href={chatRef}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm"
        title={chatRef}
      >
        <ExternalLink size={11} strokeWidth={1.5} className="shrink-0" />
        {domain}
      </a>
    );
  }
  return <CollapsibleText text={chatRef} className="text-sm text-slate-700" />;
}

// ─── Inline total-chats editor ────────────────────────────────────────────────

function TotalChatsField({
  value,
  canEdit,
  onSave,
}: {
  value: number | null;
  canEdit: boolean;
  onSave: (n: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(value != null ? String(value) : '');
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSave = async () => {
    setSaving(true);
    const parsed = draft.trim() === '' ? null : parseInt(draft, 10);
    try {
      await onSave(Number.isNaN(parsed) ? null : parsed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditing(false);
  };

  if (saving) {
    return <div className="flex items-center gap-2"><Spinner size="sm" /></div>;
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={inputRef}
          type="number"
          min="0"
          className="input w-20 py-1 text-base font-bold"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
        />
        <button type="button" onClick={handleSave} className="text-xs btn-accent py-1 px-2 shrink-0">
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors shrink-0"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-2xl font-bold text-slate-800">
        {value != null ? value.toLocaleString() : (
          <span className="text-slate-300 text-base font-normal">Not set</span>
        )}
      </span>
      {canEdit && (
        <button
          onClick={startEdit}
          className="text-slate-300 hover:text-slate-500 transition-colors"
          title="Edit total chats"
        >
          <Pencil size={13} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

export function AgentStatsGrid({
  totalChats,
  canEdit,
  onSaveTotalChats,
  issueCount,
  problemRate,
  successRate,
  typeCounts,
}: {
  totalChats: number | null;
  canEdit: boolean;
  onSaveTotalChats: (n: number | null) => Promise<void>;
  issueCount: number;
  problemRate: number | null;
  successRate: number | null;
  typeCounts: ReturnType<typeof computeIssueStats>['typeCounts'];
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className="text-[11px] text-slate-400 mb-1">Total Chats</p>
          <TotalChatsField value={totalChats} canEdit={canEdit} onSave={onSaveTotalChats} />
        </div>

        <div>
          <p className="text-[11px] text-slate-400 mb-1">Issues Logged</p>
          <p className="text-2xl font-bold text-slate-800">{issueCount}</p>
        </div>

        <div>
          <p className="text-[11px] text-slate-400 mb-1">Problem Rate</p>
          {problemRate !== null ? (
            <p className="text-2xl font-bold" style={{ color: successColor(100 - problemRate) }}>
              {fmt(problemRate)}%
            </p>
          ) : (
            <p className="text-2xl font-bold text-slate-300">—</p>
          )}
        </div>

        <div>
          <p className="text-[11px] text-slate-400 mb-1">Success Rate</p>
          {successRate !== null ? (
            <p className="text-2xl font-bold" style={{ color: successColor(successRate) }}>
              {fmt(successRate)}%
            </p>
          ) : (
            <p className="text-2xl font-bold text-slate-300">—</p>
          )}
        </div>
      </div>

      {issueCount > 0 && (
        <div style={{ borderTop: '1px solid rgba(14,14,14,0.07)' }} className="pt-2.5">
          <p className="text-[11px] text-slate-400 mb-2">Issue breakdown</p>
          <div className="flex flex-wrap gap-1.5">
            {typeCounts.map((t) => (
              <div
                key={t.value}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg ${t.count === 0 ? 'opacity-40' : ''}`}
                style={{ backgroundColor: 'rgba(14,14,14,0.04)' }}
              >
                <t.Icon size={11} strokeWidth={2} className={t.iconCls} />
                <span className="text-[11px] font-medium text-slate-600">{t.shortLabel}</span>
                <span
                  className="text-[11px] font-bold px-1.5 rounded-full ml-0.5"
                  style={{ backgroundColor: 'rgba(14,14,14,0.08)', color: '#0E0E0E' }}
                >
                  {t.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bordered preview cards (used in the compose modal and Inbox) ────────────

export function QAIssuesPreviewList({ issues }: { issues: QAIssueLike[] }) {
  if (issues.length === 0) {
    return <p className="text-xs text-slate-400 italic">No issues logged for this agent this month.</p>;
  }
  return (
    <div className="space-y-2">
      {issues.map((issue) => (
        <div key={issue.id} className="flex items-start gap-2">
          <IssueTypeBadge value={issue.issueType} />
          <div className="min-w-0 flex-1">
            <ChatRefDisplay chatRef={issue.chatRef} />
            {issue.notes && (
              <p className="text-xs text-slate-400 mt-0.5 leading-snug">{issue.notes}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const CARD_STYLE = { backgroundColor: 'rgba(14,14,14,0.03)', border: '1px solid rgba(14,14,14,0.08)' };

export function QAIssuesPreviewCard({ issues, title = 'Issues this month' }: { issues: QAIssueLike[]; title?: string }) {
  return (
    <div className="rounded-lg p-4 space-y-3" style={CARD_STYLE}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(14,14,14,0.08)', color: '#0E0E0E' }}
        >
          {issues.length} issue{issues.length !== 1 ? 's' : ''}
        </span>
      </div>
      <QAIssuesPreviewList issues={issues} />
    </div>
  );
}

export function QAStatsCard({
  title,
  totalChats,
  canEdit,
  onSaveTotalChats,
  issueCount,
  problemRate,
  successRate,
  typeCounts,
}: {
  title: string;
  totalChats: number | null;
  canEdit: boolean;
  onSaveTotalChats: (n: number | null) => Promise<void>;
  issueCount: number;
  problemRate: number | null;
  successRate: number | null;
  typeCounts: ReturnType<typeof computeIssueStats>['typeCounts'];
}) {
  return (
    <div className="rounded-lg p-4" style={CARD_STYLE}>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</p>
      <AgentStatsGrid
        totalChats={totalChats}
        canEdit={canEdit}
        onSaveTotalChats={onSaveTotalChats}
        issueCount={issueCount}
        problemRate={problemRate}
        successRate={successRate}
        typeCounts={typeCounts}
      />
    </div>
  );
}

// Full stats + issues preview, exactly matching what QA Reports' Compose &
// Send modal shows — reused as-is in the agent's Inbox for a received report.
export function QAReportPreview({
  title,
  totalChats,
  issues,
  canEdit = false,
  onSaveTotalChats,
}: {
  title: string;
  totalChats: number | null;
  issues: QAIssueLike[];
  canEdit?: boolean;
  onSaveTotalChats?: (n: number | null) => Promise<void>;
}) {
  const stats = computeIssueStats(issues, totalChats);
  return (
    <div className="space-y-3">
      <QAStatsCard
        title={title}
        totalChats={totalChats}
        canEdit={canEdit}
        onSaveTotalChats={onSaveTotalChats ?? (async () => {})}
        {...stats}
      />
      <QAIssuesPreviewCard issues={issues} />
    </div>
  );
}
