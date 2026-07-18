// client/src/pages/Inbox.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, MailOpen, Send, X, Trash2, Reply, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import {
  getInbox, getSentMessages, getInboxUsers, markMessageRead, sendMessage, deleteMessage,
  addQAAgentReportComment, addQAIssueComment,
} from '../api';
import { InboxMessage } from '../types';
import { useAuth } from '../context/AuthContext';
import { QAReportPreview } from '../components/qaReport';
import { ConfirmDialog } from '../components/ui';

type InboxUser = { id: string; name: string; role: string };

const TYPE_META: Record<string, { label: string; cls: string }> = {
  task_assignment: { label: 'Task',       cls: 'bg-blue-50 text-blue-600' },
  qa_report:       { label: 'QA Report',  cls: 'bg-amber-50 text-amber-700' },
  salary_message:  { label: 'Salary',     cls: 'bg-emerald-50 text-emerald-700' },
  general:         { label: 'Message',    cls: 'bg-slate-100 text-slate-600' },
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
}

export default function Inbox({ onRead }: InboxProps) {
  const { user } = useAuth();
  const role = user?.role ?? 'agent';
  const typeOptions = ROLE_TYPE_OPTIONS[role] ?? ROLE_TYPE_OPTIONS.agent;

  const [view, setView] = useState<'received' | 'sent'>('received');
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [sentMessages, setSentMessages] = useState<InboxMessage[]>([]);
  const [users, setUsers] = useState<InboxUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Compose state
  const [composing, setComposing] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [msgType, setMsgType] = useState(typeOptions[0]?.value ?? 'general');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [replyingTo, setReplyingTo] = useState<InboxMessage | null>(null);
  const composeRef = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async () => {
    try {
      const [inbox, sent, userList] = await Promise.all([getInbox(), getSentMessages(), getInboxUsers()]);
      setMessages(inbox);
      setSentMessages(sent);
      setUsers(userList);
      // Only default the recipient once — don't clobber a selection already made in the compose form
      setRecipientId((prev) => prev || userList[0]?.id || '');
    } catch (e) {
      console.error(e);
    }
  }, []);

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
    setMsgType(typeOptions[0]?.value ?? 'general');
    if (users.length > 0) setRecipientId(users[0].id);
  };

  const openReply = (msg: InboxMessage) => {
    setComposing(true);
    setSendError('');
    setContent('');
    setReplyingTo(msg);
    setMsgType('general');
    setRecipientId(msg.senderId);
    setTimeout(() => composeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  };

  const closeCompose = () => {
    setComposing(false);
    setReplyingTo(null);
  };

  const handleSend = async () => {
    if (!recipientId || !content.trim()) {
      setSendError('Please select a recipient and write a message.');
      return;
    }
    setSending(true);
    setSendError('');
    try {
      const msg: InboxMessage = await sendMessage({
        recipientId, type: msgType, content: content.trim(),
        replyToId: replyingTo?.id,
      });
      setSentMessages((prev) => [msg, ...prev]);
      setComposing(false);
      setContent('');
      setReplyingTo(null);
    } catch (e: any) {
      setSendError(e?.response?.data?.error ?? 'Failed to send. Please try again.');
    } finally {
      setSending(false);
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
            {view === 'received' ? 'Messages sent to you' : 'Messages you sent'}
          </p>
        </div>

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
      </div>

      {/* Compose panel */}
      {composing && (
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
            <div>
              <label className="block text-xs text-slate-400 mb-1">To</label>
              <select
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Type</label>
              <select
                value={msgType}
                onChange={(e) => setMsgType(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-slate-300 text-slate-700"
              >
                {typeOptions.map((t) => (
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

      {/* Received / Sent filter */}
      <div className="flex gap-1">
        {(['received', 'sent'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium transition-all capitalize"
            style={
              view === v
                ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
                : { color: 'rgba(14,14,14,0.45)' }
            }
          >
            {v === 'received' ? 'Received' : 'Sent'}
            {v === 'received' && unreadCount > 0 && (
              <span
                className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
              >
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Message list */}
      {loading ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
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

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this message? This only removes it from your own view."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
