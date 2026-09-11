// client/src/pages/References.tsx
// Peekviewer Team — "References" tab. Queue of "New account request"s sent
// to Anna Bilous (via Inbox's New Message form). Anna can set a status and
// add comments; Sandra Moore/Victoria Davis (the only other two who keep
// this tab) see the same queue read-only.
import React, { useEffect, useState } from 'react';
import { BookOpen, Send } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { getAccountRequestsQueue, updateAccountRequest, AccountRequestData, AccountRequestStatus } from '../api';
import { EmptyState, CardListSkeleton, RichText } from '../components/ui';

const STATUS_META: Record<AccountRequestStatus, { label: string; bg: string; text: string }> = {
  open:        { label: 'Open',        bg: 'rgba(14,14,14,0.07)',    text: 'rgba(14,14,14,0.55)' },
  in_progress: { label: 'In Progress', bg: 'rgba(245,158,11,0.14)',  text: '#b45309' },
  done:        { label: 'Done',        bg: 'rgba(161,249,110,0.28)', text: '#166534' },
};
const STATUS_ORDER: AccountRequestStatus[] = ['open', 'in_progress', 'done'];

export default function References() {
  const { user } = useAuth();
  const isAnna = user?.email === 'anna_bilous@struktura.io';

  const [requests, setRequests] = useState<AccountRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    try { setRequests(await getAccountRequestsQueue()); } catch (e) { console.error(e); }
  };
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, []);

  const handleStatusChange = async (id: string, status: AccountRequestStatus) => {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      const updated = await updateAccountRequest(id, { status });
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (e) {
      console.error(e);
      load();
    }
  };

  const handleAddComment = async (id: string) => {
    const text = (commentDrafts[id] || '').trim();
    if (!text) return;
    setSavingId(id);
    try {
      const updated = await updateAccountRequest(id, { comment: text });
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setCommentDrafts((d) => ({ ...d, [id]: '' }));
    } catch (e) {
      console.error(e);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">References</h2>
        <p className="text-sm text-slate-400">New account requests sent to Anna</p>
      </div>

      {loading ? (
        <CardListSkeleton />
      ) : requests.length === 0 ? (
        <EmptyState icon={<BookOpen size={32} strokeWidth={1.2} />} message="No account requests yet." />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <div key={r.id} className="card space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{r.requesterName}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{format(new Date(r.createdAt), 'dd MMM yyyy, HH:mm')}</p>
                  </div>
                  {isAnna ? (
                    <div className="flex gap-1 shrink-0">
                      {STATUS_ORDER.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleStatusChange(r.id, s)}
                          className="text-xs font-medium px-2.5 py-1 rounded-full transition-all"
                          style={r.status === s
                            ? { backgroundColor: STATUS_META[s].bg, color: STATUS_META[s].text }
                            : { backgroundColor: 'rgba(14,14,14,0.04)', color: 'rgba(14,14,14,0.35)' }}
                        >
                          {STATUS_META[s].label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: meta.bg, color: meta.text }}>
                      {meta.label}
                    </span>
                  )}
                </div>

                <RichText text={r.content} className="text-sm text-slate-600 leading-relaxed" />

                {r.comments.length > 0 && (
                  <div className="space-y-1.5 pl-3" style={{ borderLeft: '2px solid rgba(14,14,14,0.08)' }}>
                    {r.comments.map((c) => (
                      <div key={c.id} className="text-xs">
                        <span className="font-semibold text-slate-600">{c.authorName}: </span>
                        <span className="text-slate-500">{c.text}</span>
                      </div>
                    ))}
                  </div>
                )}

                {isAnna && (
                  <div className="flex items-center gap-2">
                    <input
                      value={commentDrafts[r.id] || ''}
                      onChange={(e) => setCommentDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(r.id); }}
                      placeholder="Add a comment…"
                      className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:border-slate-300 text-slate-700"
                    />
                    <button
                      onClick={() => handleAddComment(r.id)}
                      disabled={savingId === r.id || !(commentDrafts[r.id] || '').trim()}
                      className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
                      style={{ backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }}
                      aria-label="Send comment"
                    >
                      <Send size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
