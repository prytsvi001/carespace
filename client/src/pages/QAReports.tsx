// client/src/pages/QAReports.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, FileText, Pencil, Trash2,
  AlertTriangle, MessageSquare, BellOff, ExternalLink,
  Send, CheckCircle2, User,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  getAgents, getQAReport,
  createQAIssue, updateQAIssue, deleteQAIssue,
  getQAAgentReports, saveQAAgentReportDraft, sendQAAgentReport, updateQAAgentReportTotal,
} from '../api';
import { Agent, QAReport, QAIssue, QAAgentReport } from '../types';
import { useAuth } from '../context/AuthContext';
import { Modal, Spinner, EmptyState, ConfirmDialog } from '../components/ui';

// ─── Issue type config ────────────────────────────────────────────────────────

const ISSUE_TYPES = [
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

type IssueTypeValue = (typeof ISSUE_TYPES)[number]['value'];

function issueTypeMeta(value: string) {
  return ISSUE_TYPES.find((t) => t.value === value) ?? ISSUE_TYPES[0];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isUrl(s: string) {
  try { new URL(s); return true; } catch { return false; }
}

function fmt(n: number, decimals = 1) {
  return n.toFixed(decimals);
}

function successColor(rate: number): string {
  if (rate >= 99) return '#16a34a';
  if (rate >= 97) return '#d97706';
  return '#dc2626';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function IssueTypeBadge({ value }: { value: string }) {
  const meta = issueTypeMeta(value);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${meta.cls}`}>
      <meta.Icon size={10} strokeWidth={2} />
      {meta.shortLabel}
    </span>
  );
}

function ChatRefDisplay({ chatRef }: { chatRef: string }) {
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
  return <span className="text-sm text-slate-700">{chatRef}</span>;
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
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="number"
          min="0"
          className="input w-24 py-1 text-base font-bold"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
        />
        <button
          onClick={handleSave}
          className="text-xs btn-accent py-1 px-2"
        >
          Save
        </button>
        <button
          onClick={() => setEditing(false)}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
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

// ─── Per-agent stats ──────────────────────────────────────────────────────────

function agentStats(issues: QAIssue[], agentId: string, totalChats: number | null) {
  const agentIssues  = issues.filter((i) => i.agentId === agentId);
  const issueCount   = agentIssues.length;
  const problemRate  = totalChats ? (issueCount / totalChats) * 100 : null;
  const successRate  = problemRate !== null ? 100 - problemRate : null;
  const typeCounts   = ISSUE_TYPES.map((t) => ({
    ...t,
    count: agentIssues.filter((i) => i.issueType === t.value).length,
  }));
  return { issueCount, problemRate, successRate, typeCounts };
}

function AgentStatsGrid({
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
  typeCounts: ReturnType<typeof agentStats>['typeCounts'];
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

// ─── Main component ───────────────────────────────────────────────────────────

const EMPTY_FORM = { chatRef: '', issueType: 'technical' as IssueTypeValue, notes: '', agentId: '' };

export default function QAReports() {
  const { user } = useAuth();
  const canEdit = user?.role === 'head' || user?.role === 'lead';

  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [report, setReport]       = useState<QAReport | null>(null);
  const [loading, setLoading]     = useState(true);
  const [agents, setAgents]       = useState<Agent[]>([]);
  const [agentReports, setAgentReports] = useState<QAAgentReport[]>([]);
  const [filterAgentId, setFilterAgentId] = useState<string>('');

  // Issue form
  const [showForm, setShowForm]         = useState(false);
  const [editingIssue, setEditingIssue] = useState<QAIssue | null>(null);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [submitting, setSubmitting]     = useState(false);

  // Delete confirm
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Compose & Send modal
  const [composeAgentId, setComposeAgentId] = useState<string | null>(null);
  const [composeNote, setComposeNote]       = useState('');
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError]     = useState('');

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadReport = async () => {
    setLoading(true);
    try {
      const [reportData, agentReportsData] = await Promise.all([
        getQAReport({ year, month }),
        getQAAgentReports({ year, month }),
      ]);
      setReport(reportData);
      setAgentReports(agentReportsData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getAgents().then((a: Agent[]) => setAgents(a.filter((ag) => !ag.archived)));
  }, []);

  useEffect(() => { loadReport(); }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Month navigation ──────────────────────────────────────────────────────

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  // ── Per-agent total chats ─────────────────────────────────────────────────

  const handleSaveAgentTotal = async (agentId: string, totalChats: number | null) => {
    const updated = await updateQAAgentReportTotal({ year, month, agentId }, totalChats);
    setAgentReports((prev) => {
      const exists = prev.find((ar) => ar.agentId === agentId);
      return exists
        ? prev.map((ar) => (ar.agentId === agentId ? updated : ar))
        : [...prev, updated];
    });
  };

  // ── Issue CRUD ────────────────────────────────────────────────────────────

  const openAdd = () => {
    setEditingIssue(null);
    setForm({ ...EMPTY_FORM, agentId: filterAgentId || '' });
    setShowForm(true);
  };

  const openEdit = (issue: QAIssue) => {
    setEditingIssue(issue);
    setForm({
      chatRef:   issue.chatRef,
      issueType: issue.issueType as IssueTypeValue,
      notes:     issue.notes ?? '',
      agentId:   issue.agentId,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingIssue(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async () => {
    if (!form.chatRef.trim() || !form.agentId) return;
    setSubmitting(true);
    try {
      if (editingIssue) {
        const updated = await updateQAIssue(editingIssue.id, {
          agentId:   form.agentId,
          chatRef:   form.chatRef,
          issueType: form.issueType,
          notes:     form.notes || undefined,
        });
        setReport((prev) => prev && {
          ...prev,
          issues: prev.issues.map((i) => (i.id === updated.id ? updated : i)),
        });
      } else {
        const created = await createQAIssue({
          year, month,
          agentId:   form.agentId,
          chatRef:   form.chatRef,
          issueType: form.issueType,
          notes:     form.notes || undefined,
        });
        setReport((prev) => {
          if (!prev) return prev;
          if (prev.id === null) { loadReport(); return prev; }
          return { ...prev, issues: [...prev.issues, created] };
        });
      }
      closeForm();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setReport((prev) => prev && { ...prev, issues: prev.issues.filter((i) => i.id !== id) });
    try { await deleteQAIssue(id); } catch (e) { console.error(e); loadReport(); }
  };

  // ── Compose & Send ────────────────────────────────────────────────────────

  const openCompose = (agentId: string) => {
    const existing = agentReports.find((ar) => ar.agentId === agentId);
    setComposeNote(existing?.note ?? '');
    setComposeError('');
    setComposeAgentId(agentId);
  };

  const closeCompose = () => {
    setComposeAgentId(null);
    setComposeNote('');
    setComposeError('');
  };

  const handleSend = async () => {
    if (!composeAgentId) return;
    setComposeSending(true);
    setComposeError('');
    try {
      const { agentReport } = await sendQAAgentReport({
        year, month, agentId: composeAgentId, note: composeNote,
      });
      setAgentReports((prev) => {
        const exists = prev.find((ar) => ar.agentId === composeAgentId);
        return exists
          ? prev.map((ar) => ar.agentId === composeAgentId ? agentReport : ar)
          : [...prev, agentReport];
      });
      closeCompose();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to send report';
      setComposeError(msg);
    } finally {
      setComposeSending(false);
    }
  };

  // ── Computed metrics ──────────────────────────────────────────────────────

  const allIssues     = report?.issues ?? [];
  const filteredIssues = filterAgentId
    ? allIssues.filter((i) => i.agentId === filterAgentId)
    : allIssues;
  const issueCount    = allIssues.length;

  // All active agents, plus anyone (e.g. now-archived) with issues/report data this month
  const agentsInReport = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const a of agents) map.set(a.id, { id: a.id, name: a.name });
    for (const issue of allIssues) {
      if (!map.has(issue.agentId)) map.set(issue.agentId, issue.agent);
    }
    for (const ar of agentReports) {
      if (!map.has(ar.agentId)) map.set(ar.agentId, ar.agent);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [agents, allIssues, agentReports]);

  const composeAgent = composeAgentId ? agents.find((a) => a.id === composeAgentId) ?? agentsInReport.find((a) => a.id === composeAgentId) : null;
  const composeIssues = composeAgentId ? allIssues.filter((i) => i.agentId === composeAgentId) : [];
  const composeAgentReport = composeAgentId ? agentReports.find((ar) => ar.agentId === composeAgentId) : null;
  const composeStats = composeAgentId
    ? agentStats(allIssues, composeAgentId, composeAgentReport?.totalChats ?? null)
    : null;

  const monthLabel = format(new Date(year, month - 1, 1), 'MMMM yyyy');

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header + month navigator */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">QA Reports</h2>
          <p className="text-sm text-slate-400">Monthly chat quality tracking and success rate</p>
        </div>

        <div
          className="flex items-center gap-1 rounded-xl p-1"
          style={{ border: '1px solid rgba(14,14,14,0.10)', backgroundColor: '#fff' }}
        >
          <button
            onClick={prevMonth}
            className="p-1.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-400 hover:text-slate-700"
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <span className="text-sm font-semibold text-slate-700 px-2 min-w-[120px] text-center">
            {monthLabel}
          </span>
          <button
            onClick={nextMonth}
            className="p-1.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-400 hover:text-slate-700"
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* ── Issues section ───────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-700">
                  Issues — {monthLabel}
                  {issueCount > 0 && (
                    <span
                      className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'rgba(14,14,14,0.08)', color: 'rgba(14,14,14,0.60)' }}
                    >
                      {issueCount}
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Each row is one chat with a quality problem
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {agents.length > 0 && (
                  <select
                    className="input py-1.5 text-sm w-auto min-w-[140px]"
                    value={filterAgentId}
                    onChange={(e) => setFilterAgentId(e.target.value)}
                  >
                    <option value="">All agents</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                )}
                {canEdit && (
                  <button className="btn-accent whitespace-nowrap" onClick={openAdd}>
                    + Add Issue
                  </button>
                )}
              </div>
            </div>

            {filteredIssues.length === 0 ? (
              <EmptyState
                icon={<FileText size={40} strokeWidth={1} />}
                message={
                  filterAgentId
                    ? `No issues for ${agents.find((a) => a.id === filterAgentId)?.name ?? 'this agent'} this month`
                    : canEdit ? 'No issues logged for this month' : 'No issues for this month'
                }
                action={
                  canEdit && !filterAgentId ? (
                    <button className="btn-accent" onClick={openAdd}>Log First Issue</button>
                  ) : undefined
                }
              />
            ) : (
              <div className="card overflow-hidden p-0">
                {/* Desktop header */}
                <div
                  className="hidden sm:grid grid-cols-[140px_120px_1fr_1fr_80px] gap-x-4 px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wide"
                  style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}
                >
                  <span>Type</span>
                  <span>Agent</span>
                  <span>Chat Reference</span>
                  <span>Notes</span>
                  <span />
                </div>

                <div className="divide-y divide-slate-50">
                  {filteredIssues.map((issue) => (
                    <div key={issue.id} className="px-4 py-3">
                      {/* Desktop row */}
                      <div className="hidden sm:grid grid-cols-[140px_120px_1fr_1fr_80px] gap-x-4 items-start">
                        <div className="pt-0.5">
                          <IssueTypeBadge value={issue.issueType} />
                        </div>
                        <p className="text-sm text-slate-600 pt-0.5 truncate">{issue.agent.name}</p>
                        <div className="pt-0.5">
                          <ChatRefDisplay chatRef={issue.chatRef} />
                        </div>
                        <p className="text-sm text-slate-500 leading-snug">
                          {issue.notes || <span className="text-slate-300">—</span>}
                        </p>
                        {canEdit && (
                          <div className="flex gap-3 justify-end items-start pt-0.5">
                            <button
                              onClick={() => openEdit(issue)}
                              className="text-xs text-slate-400 hover:text-slate-700 transition-colors flex items-center gap-1"
                            >
                              <Pencil size={11} strokeWidth={1.8} />
                              Edit
                            </button>
                            <button
                              onClick={() => setConfirmId(issue.id)}
                              className="text-xs text-slate-300 hover:text-red-400 transition-colors flex items-center gap-1"
                            >
                              <Trash2 size={11} strokeWidth={1.8} />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Mobile stacked */}
                      <div className="sm:hidden space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <IssueTypeBadge value={issue.issueType} />
                            <span className="text-xs text-slate-500">{issue.agent.name}</span>
                          </div>
                          {canEdit && (
                            <div className="flex gap-3 shrink-0">
                              <button
                                onClick={() => openEdit(issue)}
                                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setConfirmId(issue.id)}
                                className="text-xs text-slate-300 hover:text-red-400 transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                        <ChatRefDisplay chatRef={issue.chatRef} />
                        {issue.notes && (
                          <p className="text-sm text-slate-500 leading-snug">{issue.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Agent Reports section (head/lead only) ───────────────────── */}
          {canEdit && agentsInReport.length > 0 && (
            <div className="space-y-3">
              <div>
                <h3 className="font-semibold text-slate-700">Agent Reports — {monthLabel}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Each agent's own chat totals, issue rate, and report status for the month
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {agentsInReport.map((a) => {
                  const ar = agentReports.find((r) => r.agentId === a.id);
                  const agentTotalChats = ar?.totalChats ?? null;
                  const { issueCount: agentIssueCount, problemRate, successRate, typeCounts } =
                    agentStats(allIssues, a.id, agentTotalChats);
                  const isSent = ar?.status === 'sent';
                  return (
                    <div
                      key={a.id}
                      className="card flex flex-col gap-3"
                      style={{ opacity: isSent ? 0.85 : 1 }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                            style={{ backgroundColor: 'rgba(161,249,110,0.25)' }}
                          >
                            <User size={13} strokeWidth={2} style={{ color: '#0E0E0E' }} />
                          </div>
                          <span className="font-medium text-sm text-slate-800">{a.name}</span>
                        </div>
                        {isSent ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-green-600 shrink-0">
                            <CheckCircle2 size={12} strokeWidth={2} />
                            Sent
                          </span>
                        ) : (
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                            style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
                          >
                            Draft
                          </span>
                        )}
                      </div>

                      <div style={{ borderTop: '1px solid rgba(14,14,14,0.07)' }} className="pt-3">
                        <AgentStatsGrid
                          totalChats={agentTotalChats}
                          canEdit={canEdit && !isSent}
                          onSaveTotalChats={(n) => handleSaveAgentTotal(a.id, n)}
                          issueCount={agentIssueCount}
                          problemRate={problemRate}
                          successRate={successRate}
                          typeCounts={typeCounts}
                        />
                      </div>

                      {isSent && ar?.sentAt && (
                        <p className="text-xs text-slate-400" style={{ borderTop: '1px solid rgba(14,14,14,0.07)', paddingTop: '0.75rem' }}>
                          Sent {format(new Date(ar.sentAt), 'MMM d, yyyy')}
                          {ar.note && (
                            <span className="block mt-0.5 italic text-slate-400 line-clamp-2">
                              "{ar.note}"
                            </span>
                          )}
                        </p>
                      )}

                      {!isSent && (
                        <button
                          className="btn-accent flex items-center justify-center gap-1.5 text-sm mt-auto"
                          onClick={() => openCompose(a.id)}
                        >
                          <Send size={13} strokeWidth={2} />
                          Compose & Send
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Add / Edit modal ─────────────────────────────────────────────── */}
      <Modal
        open={showForm}
        onClose={closeForm}
        title={editingIssue ? 'Edit Issue' : 'Log Issue'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Agent *</label>
            <select
              className="input"
              value={form.agentId}
              autoFocus
              onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}
            >
              <option value="">Select agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Chat Reference *</label>
            <input
              className="input"
              placeholder="Ticket ID, URL, or any reference…"
              value={form.chatRef}
              onChange={(e) => setForm((f) => ({ ...f, chatRef: e.target.value }))}
            />
            <p className="mt-1 text-xs text-slate-400">
              Paste a URL, a ticket number, a chat ID — anything that identifies the chat.
            </p>
          </div>

          <div>
            <label className="label">Issue Type *</label>
            <select
              className="input"
              value={form.issueType}
              onChange={(e) => setForm((f) => ({ ...f, issueType: e.target.value as IssueTypeValue }))}
            >
              {ISSUE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Describe the specific problem found…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={closeForm}>Cancel</button>
            <button
              className="btn-accent flex-1"
              onClick={handleSubmit}
              disabled={submitting || !form.chatRef.trim() || !form.agentId}
            >
              {submitting ? 'Saving…' : editingIssue ? 'Save Changes' : 'Log Issue'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Compose & Send modal ──────────────────────────────────────────── */}
      <Modal
        open={!!composeAgentId}
        onClose={closeCompose}
        title={`QA Report — ${composeAgent?.name ?? ''}`}
      >
        <div className="space-y-4">
          {/* Personal stats */}
          {composeStats && (
            <div
              className="rounded-lg p-4"
              style={{ backgroundColor: 'rgba(14,14,14,0.03)', border: '1px solid rgba(14,14,14,0.08)' }}
            >
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                {monthLabel} — {composeAgent?.name}'s stats
              </p>
              <AgentStatsGrid
                totalChats={composeAgentReport?.totalChats ?? null}
                canEdit={false}
                onSaveTotalChats={async () => {}}
                issueCount={composeStats.issueCount}
                problemRate={composeStats.problemRate}
                successRate={composeStats.successRate}
                typeCounts={composeStats.typeCounts}
              />
            </div>
          )}

          {/* Preview */}
          <div
            className="rounded-lg p-4 space-y-3"
            style={{ backgroundColor: 'rgba(14,14,14,0.03)', border: '1px solid rgba(14,14,14,0.08)' }}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Issues this month
              </p>
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(14,14,14,0.08)', color: '#0E0E0E' }}
              >
                {composeIssues.length} issue{composeIssues.length !== 1 ? 's' : ''}
              </span>
            </div>

            {composeIssues.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No issues logged for this agent this month.</p>
            ) : (
              <div className="space-y-2">
                {composeIssues.map((issue) => (
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
            )}
          </div>

          {/* Personal note */}
          <div>
            <label className="label">Personal Note (optional)</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Add a note or feedback to include in the report…"
              value={composeNote}
              onChange={(e) => setComposeNote(e.target.value)}
            />
          </div>

          {composeError && (
            <p className="text-sm text-red-500">{composeError}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={closeCompose} disabled={composeSending}>
              Cancel
            </button>
            <button
              className="btn-accent flex-1 flex items-center justify-center gap-1.5"
              onClick={handleSend}
              disabled={composeSending}
            >
              {composeSending ? (
                <><Spinner size="sm" /> Sending…</>
              ) : (
                <><Send size={13} strokeWidth={2} /> Send Report</>
              )}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmId}
        message="Delete this issue permanently?"
        onConfirm={() => { if (confirmId) handleDelete(confirmId); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
