// client/src/pages/Inbox.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, MailOpen, Send, X, Trash2, Reply, ChevronDown, ChevronUp, Megaphone, UserPlus, Rocket, Plus } from 'lucide-react';
import { format } from 'date-fns';
import {
  getInbox, getSentMessages, getInboxUsers, markMessageRead, sendMessage, deleteMessage,
  addQAAgentReportComment, addQAIssueComment,
  getUpdates, createUpdate, updateUpdate, deleteUpdate, markUpdateRead,
  getMySentAccountRequests, createAccountRequest, deleteAccountRequest, AccountRequestData, AccountRequestStatus,
  getMySentBoostRequests, createBoostRequestsBulk, deleteBoostRequest, BoostRequest,
} from '../api';
import {
  BoostRequestRow, BoostRequestRowsEditor, emptyBoostRequestRow, cleanBoostRequestRows,
  groupBoostRequestsByBatch, BoostRequestBatchCard,
} from '../components/boostRequestRows';
import { InboxMessage, TeamUpdate, UpdateAttachment } from '../types';
import { useAuth } from '../context/AuthContext';
import { QAReportPreview } from '../components/qaReport';
import { UpdatesTab } from '../components/UpdatesTab';
import { ConfirmDialog, CardListSkeleton, RichText } from '../components/ui';

type InboxUser = { id: string; name: string; role: string };

const TYPE_META: Record<string, { label: string; cls: string }> = {
  task_assignment: { label: 'Task',       cls: 'bg-blue-50 text-blue-600' },
  qa_report:       { label: 'QA Report',  cls: 'bg-amber-50 text-amber-700' },
  salary_message:  { label: 'Salary',     cls: 'bg-emerald-50 text-emerald-700' },
  account_request: { label: 'Account Request', cls: 'bg-violet-50 text-violet-700' },
  general:         { label: 'Message',    cls: 'bg-slate-100 text-slate-600' },
};

const ACCOUNT_REQUEST_STATUS_META: Record<AccountRequestStatus, { label: string; bg: string; text: string }> = {
  open:        { label: 'Open',        bg: 'rgba(14,14,14,0.07)',    text: 'rgba(14,14,14,0.55)' },
  in_progress: { label: 'In Progress', bg: 'rgba(245,158,11,0.14)',  text: '#b45309' },
  done:        { label: 'Done',        bg: 'rgba(161,249,110,0.28)', text: '#166534' },
};

const ROLE_TYPE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  head: [
    { value: 'task_assignment', label: 'Task Assignment' },
    { value: 'salary_message',  label: 'Salary Note' },
    { value: 'general',         label: 'General Message' },
  ],
  lead: [
    { value: 'task_assignment', label: 'Task Assignment' },
    { value: 'general',         label: 'General Message' },
  ],
  agent: [
    { value: 'general', label: 'General Message' },
  ],
};

interface InboxProps {
  onRead?: () => void;
  activeTeam?: 'support' | 'peekviewer';
}

export default function Inbox({ onRead, activeTeam = 'support' }: InboxProps) {
  const { user } = useAuth();
  const role = user?.role ?? 'agent';
  const isAdmin = role === 'head' || role === 'lead' || (activeTeam === 'peekviewer' && !!user?.peekviewerAdmin);
  const baseTypeOptions = ROLE_TYPE_OPTIONS[role] ?? ROLE_TYPE_OPTIONS.agent;

  const [view, setView] = useState<'received' | 'sent' | 'updates' | 'requests-to-anna' | 'boost-requests'>('received');
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [sentMessages, setSentMessages] = useState<InboxMessage[]>([]);
  const [updates, setUpdates] = useState<TeamUpdate[]>([]);
  const [sentAccountRequests, setSentAccountRequests] = useState<AccountRequestData[]>([]);
  const [sentBoostRequests, setSentBoostRequests] = useState<BoostRequest[]>([]);
  const [users, setUsers] = useState<InboxUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Compose state
  const [composing, setComposing] = useState(false);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [showRecipientPicker, setShowRecipientPicker] = useState(false);
  const [msgType, setMsgType] = useState(baseTypeOptions[0]?.value ?? 'general');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [replyingTo, setReplyingTo] = useState<InboxMessage | null>(null);
  const composeRef = useRef<HTMLDivElement>(null);

  // "Requests sent to Anna" — dedicated create form (account requests are no
  // longer created via the generic New Message compose flow).
  const [showAccountRequestForm, setShowAccountRequestForm] = useState(false);
  const [accountRequestContent, setAccountRequestContent] = useState('');
  const [accountRequestSaving, setAccountRequestSaving] = useState(false);
  const [accountRequestError, setAccountRequestError] = useState('');

  // "Boost Requests" — dedicated create form (same idea, for Yana).
  const [showBoostRequestForm, setShowBoostRequestForm] = useState(false);
  const [boostRows, setBoostRows] = useState<BoostRequestRow[]>([emptyBoostRequestRow()]);
  const [boostSaving, setBoostSaving] = useState(false);
  const [boostError, setBoostError] = useState('');

  const loadInbox = useCallback(async () => {
    try {
      const [inbox, sent, userList] = await Promise.all([getInbox(), getSentMessages(), getInboxUsers()]);
      setMessages(inbox);
      setSentMessages(sent);
      setUsers(userList);
    } catch (e) {
      console.error(e);
    }

    // Fetched separately from the block above: axios rejects on non-2xx —
    // bundled into the same Promise.all, that single rejection would have
    // wiped out messages/sent/users too.
    try {
      setUpdates(await getUpdates(activeTeam));
    } catch (e) {
      console.error(e);
    }

    if (activeTeam === 'peekviewer') {
      try {
        setSentAccountRequests(await getMySentAccountRequests());
      } catch (e) {
        console.error(e);
      }
      try {
        setSentBoostRequests(await getMySentBoostRequests());
      } catch (e) {
        console.error(e);
      }
    }
  }, [activeTeam]);

  useEffect(() => {
    setLoading(true);
    loadInbox().finally(() => setLoading(false));

    // Poll so messages from other users show up without a manual refresh
    const id = setInterval(loadInbox, 20_000);
    return () => clearInterval(id);
  }, [loadInbox]);

  const openCompose = () => {
    setComposing(true);
    setSendError('');
    setContent('');
    setReplyingTo(null);
    setMsgType(baseTypeOptions[0]?.value ?? 'general');
    setRecipientIds([]);
    setShowRecipientPicker(false);
  };

  const openReply = (msg: InboxMessage) => {
    setComposing(true);
    setSendError('');
    setContent('');
    setReplyingTo(msg);
    setMsgType('general');
    setRecipientIds([msg.senderId]);
    setShowRecipientPicker(false);
    setTimeout(() => composeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  };

  const closeCompose = () => {
    setComposing(false);
    setReplyingTo(null);
  };

  const toggleRecipient = (id: string) => {
    setRecipientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSend = async () => {
    if (recipientIds.length === 0 || !content.trim()) {
      setSendError('Please select at least one recipient and write a message.');
      return;
    }
    setSending(true);
    setSendError('');
    try {
      const sent: InboxMessage[] = await sendMessage({
        recipientIds, type: msgType, content: content.trim(),
        replyToId: replyingTo?.id,
      });
      setSentMessages((prev) => [...sent, ...prev]);
      setComposing(false);
      setContent('');
      setReplyingTo(null);
    } catch (e: any) {
      setSendError(e?.response?.data?.error ?? 'Failed to send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const openAccountRequestForm = () => {
    setShowAccountRequestForm(true);
    setAccountRequestContent('');
    setAccountRequestError('');
  };

  const handleCreateAccountRequest = async () => {
    if (!accountRequestContent.trim()) {
      setAccountRequestError('Please describe the request.');
      return;
    }
    setAccountRequestSaving(true);
    setAccountRequestError('');
    try {
      await createAccountRequest(accountRequestContent.trim());
      // The server also creates a companion InboxMessage — simplest to just
      // reload everything (Sent list + the Requests-sent-to-Anna list) rather
      // than hand-construct both shapes locally.
      await loadInbox();
      setShowAccountRequestForm(false);
      setAccountRequestContent('');
    } catch (e: any) {
      setAccountRequestError(e?.response?.data?.error ?? 'Failed to send. Please try again.');
    } finally {
      setAccountRequestSaving(false);
    }
  };

  const openBoostRequestForm = () => {
    setShowBoostRequestForm(true);
    setBoostRows([emptyBoostRequestRow()]);
    setBoostError('');
  };

  const handleCreateBoostRequest = async () => {
    const cleaned = cleanBoostRequestRows(boostRows);
    if (!cleaned) {
      setBoostError('Please fill in a link and a valid quantity for every row.');
      return;
    }
    setBoostSaving(true);
    setBoostError('');
    try {
      const created = await createBoostRequestsBulk(cleaned);
      setSentBoostRequests((prev) => [...created, ...prev]);
      setShowBoostRequestForm(false);
    } catch (e: any) {
      setBoostError(e?.response?.data?.error ?? 'Failed to send. Please try again.');
    } finally {
      setBoostSaving(false);
    }
  };

  // ── Collapse read messages to just their title, expandable on click ──────
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleMarkRead = async (id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, read: true } : m)));
    try {
      await markMessageRead(id);
      onRead?.();
    } catch (e) {
      console.error(e);
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setSentMessages((prev) => prev.filter((m) => m.id !== id));
    try {
      await deleteMessage(id);
      onRead?.();
    } catch (e) {
      console.error(e);
      loadInbox();
    }
  };

  // "Requests sent to Anna" / "Boost Requests" own lists — scoped so
  // deleting here only removes it from the caller's own list, never from
  // Anna's/the admin's queue (see server-side DELETE /:id on each).
  const [confirmDeleteAccountReqId, setConfirmDeleteAccountReqId] = useState<string | null>(null);
  const handleDeleteAccountRequest = async (id: string) => {
    setConfirmDeleteAccountReqId(null);
    setSentAccountRequests((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteAccountRequest(id, 'requester');
    } catch (e) {
      console.error(e);
      loadInbox();
    }
  };

  const [confirmDeleteBoostReqId, setConfirmDeleteBoostReqId] = useState<string | null>(null);
  const handleDeleteBoostRequest = async (id: string) => {
    setConfirmDeleteBoostReqId(null);
    setSentBoostRequests((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteBoostRequest(id, 'requester');
    } catch (e) {
      console.error(e);
      loadInbox();
    }
  };

  // ── Updates (announcements) ────────────────────────────────────────────────
  const handlePublishUpdate = async (data: { title: string; content: string; tag: string | null; attachments: UpdateAttachment[] }) => {
    const created: TeamUpdate = await createUpdate({ ...data, team: activeTeam });
    setUpdates((prev) => [created, ...prev]);
    onRead?.();
  };

  const handleEditUpdate = async (id: string, data: { title: string; content: string; tag: string | null; attachments: UpdateAttachment[] }) => {
    const updated: TeamUpdate = await updateUpdate(id, data);
    setUpdates((prev) => prev.map((u) => (u.id === id ? updated : u)));
  };

  const handleDeleteUpdate = async (id: string) => {
    setUpdates((prev) => prev.filter((u) => u.id !== id));
    try {
      await deleteUpdate(id);
      onRead?.();
    } catch (e) {
      console.error(e);
      loadInbox();
    }
  };

  const handleMarkUpdateRead = async (id: string) => {
    setUpdates((prev) => prev.map((u) => (u.id === id ? { ...u, read: true } : u)));
    try {
      await markUpdateRead(id);
      onRead?.();
    } catch (e) {
      console.error(e);
      loadInbox();
    }
  };

  // ── QA report comments (per-issue + report-level) ─────────────────────────
  const handleIssueComment = async (issueId: string, text: string, action: 'comment' | 'return') => {
    await addQAIssueComment(issueId, { text, action });
    await loadInbox();
  };

  const handleReportComment = async (msg: InboxMessage, text: string, action: 'comment' | 'return') => {
    if (!msg.metadata) return;
    await addQAAgentReportComment({
      year: msg.metadata.year, month: msg.metadata.month, agentId: msg.metadata.agentId, text, action,
    });
    await loadInbox();
  };

  const unreadCount = messages.filter((m) => !m.read).length;
  const updatesUnreadCount = updates.filter((u) => !u.read && !u.isAuthor).length;
  const displayed = view === 'received' ? messages : sentMessages;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            Inbox
            {unreadCount > 0 && (
              <span
                className="text-sm font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
              >
                {unreadCount}
              </span>
            )}
          </h2>
          <p className="text-sm text-slate-400">
            {view === 'received' ? 'Messages sent to you'
              : view === 'sent' ? 'Messages you sent'
              : view === 'requests-to-anna' ? 'Account requests you sent to Anna'
              : view === 'boost-requests' ? 'Your boost requests'
              : 'Team announcements'}
          </p>
        </div>

        {view === 'received' || view === 'sent' ? (
          <button
            onClick={composing ? closeCompose : openCompose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all shrink-0"
            style={
              composing
                ? { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.50)' }
                : { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
            }
          >
            {composing
              ? <><X size={13} strokeWidth={2} /> Cancel</>
              : <><Send size={13} strokeWidth={1.8} /> New Message</>
          }
          </button>
        ) : view === 'requests-to-anna' ? (
          <button
            onClick={showAccountRequestForm ? () => setShowAccountRequestForm(false) : openAccountRequestForm}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all shrink-0"
            style={
              showAccountRequestForm
                ? { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.50)' }
                : { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
            }
          >
            {showAccountRequestForm
              ? <><X size={13} strokeWidth={2} /> Cancel</>
              : <><Plus size={13} strokeWidth={2} /> Create new request</>}
          </button>
        ) : view === 'boost-requests' ? (
          <button
            onClick={showBoostRequestForm ? () => setShowBoostRequestForm(false) : openBoostRequestForm}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all shrink-0"
            style={
              showBoostRequestForm
                ? { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.50)' }
                : { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
            }
          >
            {showBoostRequestForm
              ? <><X size={13} strokeWidth={2} /> Cancel</>
              : <><Plus size={13} strokeWidth={2} /> Create new request</>}
          </button>
        ) : null}
      </div>

      {/* Create-request panel — Requests sent to Anna */}
      {view === 'requests-to-anna' && showAccountRequestForm && (
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-slate-700">New account request</p>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Message</label>
            <textarea
              value={accountRequestContent}
              onChange={(e) => setAccountRequestContent(e.target.value)}
              rows={4}
              placeholder="Describe the account request…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700 resize-none"
            />
          </div>
          {accountRequestError && <p className="text-xs text-red-500">{accountRequestError}</p>}
          <div className="flex justify-end">
            <button
              onClick={handleCreateAccountRequest}
              disabled={accountRequestSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
            >
              <Send size={13} strokeWidth={1.8} />
              {accountRequestSaving ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* Create-request panel — Boost Requests */}
      {view === 'boost-requests' && showBoostRequestForm && (
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-slate-700">New boost request{boostRows.length > 1 ? 's' : ''}</p>
          <BoostRequestRowsEditor rows={boostRows} onChange={setBoostRows} />
          {boostError && <p className="text-xs text-red-500">{boostError}</p>}
          <div className="flex justify-end">
            <button
              onClick={handleCreateBoostRequest}
              disabled={boostSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
            >
              <Send size={13} strokeWidth={1.8} />
              {boostSaving ? 'Sending…' : `Send ${boostRows.length} boost request${boostRows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {/* Compose panel */}
      {composing && (view === 'received' || view === 'sent') && (
        <div ref={composeRef} className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              {replyingTo ? `Reply to ${replyingTo.sender.name}` : 'Compose Message'}
            </p>
            {replyingTo && (
              <button
                onClick={() => setReplyingTo(null)}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Change recipient
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              className="relative"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setShowRecipientPicker(false);
              }}
            >
              <label className="block text-xs text-slate-400 mb-1">To</label>
              <button
                type="button"
                onClick={() => setShowRecipientPicker((v) => !v)}
                className="w-full min-h-[38px] text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-left flex items-center gap-1.5 flex-wrap focus:outline-none focus:border-slate-300"
              >
                {recipientIds.length === 0 ? (
                  <span className="text-slate-400 px-1">Select recipients…</span>
                ) : (
                  recipientIds.map((id) => {
                    const u = users.find((u) => u.id === id);
                    if (!u) return null;
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
                      >
                        {u.name}
                        <X
                          size={11}
                          strokeWidth={2}
                          onClick={(e) => { e.stopPropagation(); toggleRecipient(id); }}
                        />
                      </span>
                    );
                  })
                )}
              </button>
              {showRecipientPicker && (
                <div
                  className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg bg-white shadow-lg"
                  style={{ border: '1px solid rgba(14,14,14,0.09)' }}
                >
                  {users.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={recipientIds.includes(u.id)}
                        onChange={() => toggleRecipient(u.id)}
                      />
                      {u.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Type</label>
              <select
                value={msgType}
                onChange={(e) => setMsgType(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700"
              >
                {baseTypeOptions.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Message</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="Write your message…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700 resize-none"
            />
          </div>

          {sendError && (
            <p className="text-xs text-red-500">{sendError}</p>
          )}

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
      )}

      {/* Received / Sent / Updates / Requests-sent-to-Anna / Boost Requests filter */}
      <div className="flex gap-1 flex-wrap">
        {([
          ...(['received', 'sent', 'updates'] as const),
          ...(activeTeam === 'peekviewer' ? (['requests-to-anna', 'boost-requests'] as const) : []),
        ]).map((v) => (
          <button
            key={v}
            onClick={() => { setView(v); if (v !== 'received' && v !== 'sent') closeCompose(); }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium transition-all"
            style={
              view === v
                ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
                : { color: 'rgba(14,14,14,0.45)' }
            }
          >
            {v === 'received' ? <Mail size={12} strokeWidth={1.8} />
              : v === 'updates' ? <Megaphone size={12} strokeWidth={1.8} />
              : v === 'requests-to-anna' ? <UserPlus size={12} strokeWidth={1.8} />
              : v === 'boost-requests' ? <Rocket size={12} strokeWidth={1.8} />
              : null}
            {v === 'received' ? 'Received' : v === 'sent' ? 'Sent' : v === 'updates' ? 'Updates' : v === 'requests-to-anna' ? 'New Account Request' : 'Boost Requests'}
            {((v === 'received' && unreadCount > 0) || (v === 'updates' && updatesUnreadCount > 0)) && (
              <span
                className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
              >
                {v === 'received' ? unreadCount : updatesUnreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Updates tab */}
      {view === 'updates' ? (
        loading ? (
          <CardListSkeleton />
        ) : (
          <UpdatesTab
            updates={updates}
            isAdmin={isAdmin}
            onPublish={handlePublishUpdate}
            onEdit={handleEditUpdate}
            onDelete={handleDeleteUpdate}
            onMarkRead={handleMarkUpdateRead}
          />
        )
      ) : view === 'requests-to-anna' ? (
        loading ? (
          <CardListSkeleton />
        ) : sentAccountRequests.length === 0 ? (
          <div className="py-14 text-center">
            <UserPlus size={40} strokeWidth={1} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-400">No account requests sent yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sentAccountRequests.map((r) => {
              const statusMeta = ACCOUNT_REQUEST_STATUS_META[r.status];
              return (
                <div key={r.id} className="card space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs text-slate-400">
                      {format(new Date(r.createdAt), 'dd MMM yyyy')}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={{ backgroundColor: statusMeta.bg, color: statusMeta.text }}>
                        {statusMeta.label}
                      </span>
                      <button
                        onClick={() => setConfirmDeleteAccountReqId(r.id)}
                        className="p-1 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                        style={{ color: 'rgba(14,14,14,0.35)' }}
                        title="Delete"
                      >
                        <Trash2 size={13} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>
                  <RichText text={r.content} className="text-sm text-slate-600 leading-relaxed" />
                  {r.comments.length > 0 && (
                    <div className="space-y-1 pl-3" style={{ borderLeft: '2px solid rgba(14,14,14,0.08)' }}>
                      {r.comments.map((c) => (
                        <div key={c.id} className="text-xs">
                          <span className="font-semibold text-slate-600">{c.authorName}: </span>
                          <span className="text-slate-500">{c.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : view === 'boost-requests' ? (
        loading ? (
          <CardListSkeleton />
        ) : sentBoostRequests.length === 0 ? (
          <div className="py-14 text-center">
            <Rocket size={40} strokeWidth={1} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-400">No boost requests sent yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groupBoostRequestsByBatch(sentBoostRequests).map(({ key, items }) => (
              <BoostRequestBatchCard key={key} items={items} onDelete={(id) => setConfirmDeleteBoostReqId(id)} />
            ))}
          </div>
        )
      ) : (
      <>
      {/* Message list */}
      {loading ? (
        <CardListSkeleton />
      ) : displayed.length === 0 ? (
        <div className="py-14 text-center">
          <MailOpen size={40} strokeWidth={1} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">
            {view === 'received' ? 'Your inbox is empty' : 'No sent messages'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((msg) => {
            const meta = TYPE_META[msg.type] ?? TYPE_META.general;
            const isSent = view === 'sent';
            return (
              <div
                key={msg.id}
                className="card transition-all"
                style={!isSent && !msg.read ? { borderLeft: '3px solid #A1F96E' } : {}}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.cls}`}>
                      {meta.label}
                    </span>
                    {isSent ? (
                      <>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
                          Sent
                        </span>
                        <span className="text-sm font-medium text-slate-700">
                          to {msg.receiver?.name ?? '—'}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-medium text-slate-700">
                          from {msg.sender.name}
                        </span>
                        {!msg.read && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: '#A1F96E' }}
                          />
                        )}
                      </>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">
                    {format(new Date(msg.createdAt), 'dd MMM yyyy')}
                  </span>
                </div>

                {(() => {
                  const isCollapsed = msg.read && !expandedIds.has(msg.id);
                  const collapsedLabel = msg.subject
                    || (msg.content.length > 80 ? `${msg.content.slice(0, 80)}…` : msg.content);
                  return (
                    <>
                      <button
                        onClick={() => msg.read && toggleExpanded(msg.id)}
                        className="w-full flex items-center justify-between gap-2 text-left mb-1"
                        style={{ cursor: msg.read ? 'pointer' : 'default' }}
                      >
                        <span className="text-sm font-semibold text-slate-700 flex items-center gap-2 flex-wrap min-w-0">
                          <span className="truncate">{collapsedLabel}</span>
                          {msg.metadata?.status === 'resent' && (
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ backgroundColor: 'rgba(59,130,246,0.12)', color: '#2563eb' }}
                            >
                              Revised
                            </span>
                          )}
                        </span>
                        {msg.read && (
                          isCollapsed
                            ? <ChevronDown size={16} strokeWidth={2} className="shrink-0 text-slate-300" />
                            : <ChevronUp size={16} strokeWidth={2} className="shrink-0 text-slate-300" />
                        )}
                      </button>

                      {!isCollapsed && (
                        <>
                          {msg.replyTo && (
                            <div
                              className="mb-2 pl-2.5 text-xs"
                              style={{ borderLeft: '2px solid rgba(14,14,14,0.15)', color: 'rgba(14,14,14,0.45)' }}
                            >
                              <span className="font-medium">In reply to {msg.replyTo.senderName}</span>
                              {msg.replyTo.subject && <>: {msg.replyTo.subject}</>}
                              <p className="italic mt-0.5 line-clamp-2">
                                "{msg.replyTo.content}"
                              </p>
                            </div>
                          )}
                          {msg.type === 'qa_report' && msg.metadata?.issues ? (
                            <div className="space-y-2">
                              <QAReportPreview
                                title={`${format(new Date(msg.metadata.year, msg.metadata.month - 1, 1), 'MMMM yyyy')} — Your Stats`}
                                totalChats={msg.metadata.totalChats ?? null}
                                issues={msg.metadata.issues}
                                timeline={msg.metadata.timeline ?? []}
                                canReturn={!isSent && role === 'agent'}
                                onIssueComment={handleIssueComment}
                                onReportComment={(text, action) => handleReportComment(msg, text, action)}
                              />
                              {msg.metadata.note && (
                                <p
                                  className="text-sm text-slate-600 italic leading-relaxed rounded-lg p-3"
                                  style={{ backgroundColor: 'rgba(14,14,14,0.03)', whiteSpace: 'pre-wrap' }}
                                >
                                  "{msg.metadata.note}"
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-600 leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
                              {msg.content}
                            </p>
                          )}
                          {msg.metadata && msg.updatedAt !== msg.createdAt && (
                            <p className="text-xs text-slate-400 mt-1">
                              Updated {format(new Date(msg.updatedAt), 'dd MMM yyyy')}
                            </p>
                          )}
                        </>
                      )}
                    </>
                  );
                })()}

                <div className="mt-3 flex justify-end gap-2 flex-wrap">
                  {!isSent && (
                    <button
                      onClick={() => openReply(msg)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
                    >
                      <Reply size={13} strokeWidth={1.8} />
                      Reply
                    </button>
                  )}
                  {!isSent && !msg.read && (
                    <button
                      onClick={() => handleMarkRead(msg.id)}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:brightness-95"
                      style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
                    >
                      <Mail size={13} strokeWidth={2} />
                      Mark as read
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmDeleteId(msg.id)}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                    style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
                  >
                    <Trash2 size={13} strokeWidth={1.8} />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this message? This only removes it from your own view."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ConfirmDialog
        open={!!confirmDeleteAccountReqId}
        message="Delete this account request from your list? This only removes it from your own view."
        onConfirm={() => { if (confirmDeleteAccountReqId) handleDeleteAccountRequest(confirmDeleteAccountReqId); }}
        onCancel={() => setConfirmDeleteAccountReqId(null)}
      />

      <ConfirmDialog
        open={!!confirmDeleteBoostReqId}
        message="Delete this boost request from your list? This only removes it from your own view."
        onConfirm={() => { if (confirmDeleteBoostReqId) handleDeleteBoostRequest(confirmDeleteBoostReqId); }}
        onCancel={() => setConfirmDeleteBoostReqId(null)}
      />
    </div>
  );
}
