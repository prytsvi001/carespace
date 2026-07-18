// client/src/pages/Reviews.tsx
import React, { useEffect, useState } from 'react';
import { Star, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { getReviews, createReview, archiveReview, getInboxUsers } from '../api';
import { ClientReview } from '../types';
import { useAuth } from '../context/AuthContext';
import { Modal, Spinner, EmptyState, ConfirmDialog } from '../components/ui';

type FilterUser = { id: string; name: string };

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function getDomain(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return u.pathname && u.pathname !== '/' ? `${host}${u.pathname}` : host;
  } catch {
    return url;
  }
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export default function Reviews() {
  const { user } = useAuth();
  const isLeadOrHead = user?.role === 'head' || user?.role === 'lead';

  const now = new Date();
  const [reviews, setReviews] = useState<ClientReview[]>([]);
  const [filterUsers, setFilterUsers] = useState<FilterUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterUserId, setFilterUserId] = useState<string>(
    isLeadOrHead ? '' : (user?.id ?? '')
  );
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [showAllTime, setShowAllTime] = useState(false);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [form, setForm] = useState({
    url: '',
    clientName: '',
    submittedAt: format(now, 'yyyy-MM-dd'),
  });

  // Delete confirm
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const params: {
        userId?: string;
        month?: number;
        year?: number;
        limit: number;
      } = { limit: 200 };
      if (filterUserId) params.userId = filterUserId;
      if (!showAllTime) {
        params.month = filterMonth;
        params.year = filterYear;
      }

      const [data, others] = await Promise.all([
        getReviews(params),
        isLeadOrHead && filterUsers.length === 0 ? getInboxUsers() : Promise.resolve(null),
      ]);

      setReviews(data.reviews);

      if (others && user) {
        const combined: FilterUser[] = [
          { id: user.id, name: user.name },
          ...(others as { id: string; name: string; role: string }[])
            .filter((u) => u.role !== 'peek_handler')
            .map((u) => ({ id: u.id, name: u.name })),
        ].sort((a, b) => a.name.localeCompare(b.name));
        setFilterUsers(combined);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUserId, filterMonth, filterYear, showAllTime]);

  const resetForm = () => {
    setForm({ url: '', clientName: '', submittedAt: format(new Date(), 'yyyy-MM-dd') });
    setUrlError('');
  };

  const handleSubmit = async () => {
    setUrlError('');
    const trimmed = form.url.trim();
    if (!trimmed) {
      setUrlError('Review link is required.');
      return;
    }
    if (!isValidUrl(trimmed)) {
      setUrlError('Please enter a valid URL (e.g. https://g.co/review/...)');
      return;
    }
    setSubmitting(true);
    try {
      await createReview({
        url: trimmed,
        clientName: form.clientName.trim() || undefined,
        submittedAt: form.submittedAt,
      });
      setShowForm(false);
      resetForm();
      await loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (id: string) => {
    setReviews((prev) => prev.filter((r) => r.id !== id));
    try {
      await archiveReview(id);
    } catch (e) {
      console.error(e);
    }
  };

  // Monthly summary — group current view's reviews by agent
  const summary = reviews.reduce<Record<string, { name: string; count: number }>>((acc, r) => {
    if (!acc[r.user.id]) acc[r.user.id] = { name: r.user.name, count: 0 };
    acc[r.user.id].count++;
    return acc;
  }, {});
  const summaryEntries = Object.values(summary).sort((a, b) => b.count - a.count);

  const years = [now.getFullYear() - 1, now.getFullYear()];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Reviews</h2>
          <p className="text-sm text-slate-400">
            {isLeadOrHead
              ? 'Client review links submitted by agents'
              : 'Your submitted client review links'}
          </p>
        </div>
        <button
          className="btn-accent whitespace-nowrap self-start sm:self-auto"
          onClick={() => { resetForm(); setShowForm(true); }}
        >
          + Add Review
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {isLeadOrHead && (
          <select
            className="input w-auto text-sm"
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
          >
            <option value="">All agents</option>
            {filterUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}

        <button
          onClick={() => setShowAllTime((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
          style={
            showAllTime
              ? { backgroundColor: 'rgba(161,249,110,0.30)', color: '#0E0E0E' }
              : { backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.55)' }
          }
        >
          All time
        </button>

        {!showAllTime && (
          <div className="flex gap-1.5">
            <select
              className="input w-auto text-sm"
              value={filterMonth}
              onChange={(e) => setFilterMonth(Number(e.target.value))}
            >
              {MONTHS.map((label, i) => (
                <option key={i + 1} value={i + 1}>{label}</option>
              ))}
            </select>
            <select
              className="input w-auto text-sm"
              value={filterYear}
              onChange={(e) => setFilterYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Monthly summary */}
      {!loading && summaryEntries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summaryEntries.map(({ name, count }) => (
            <span
              key={name}
              className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ backgroundColor: 'rgba(161,249,110,0.20)', color: '#0E0E0E' }}
            >
              {name.split(' ')[0]} · {count} {count === 1 ? 'review' : 'reviews'}
            </span>
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : reviews.length === 0 ? (
        <EmptyState
          icon={<Star size={44} strokeWidth={1} />}
          message="No reviews submitted yet"
          action={
            <button className="btn-accent" onClick={() => { resetForm(); setShowForm(true); }}>
              Submit First Review
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden p-0">
          {/* Table header */}
          <div
            className="hidden sm:grid grid-cols-[110px_160px_160px_1fr_72px] gap-x-4 px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wide"
            style={{ borderBottom: '1px solid rgba(14,14,14,0.07)' }}
          >
            <span>Date</span>
            <span>Agent</span>
            <span>Client</span>
            <span>Link</span>
            <span />
          </div>

          <div className="divide-y divide-slate-50">
            {reviews.map((review) => {
              const canRemove = review.userId === user?.id || isLeadOrHead;
              return (
                <div key={review.id} className="px-4 py-3">
                  {/* Desktop row */}
                  <div className="hidden sm:grid grid-cols-[110px_160px_160px_1fr_72px] gap-x-4 items-center">
                    <span className="text-sm text-slate-500">
                      {format(new Date(review.submittedAt), 'dd MMM yyyy')}
                    </span>
                    <span className="text-sm font-medium text-slate-700 truncate">
                      {review.user.name}
                    </span>
                    <span className="text-sm text-slate-500 truncate">
                      {review.clientName || <span className="text-slate-300">—</span>}
                    </span>
                    <a
                      href={review.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline min-w-0"
                      title={review.url}
                    >
                      <ExternalLink size={12} strokeWidth={1.5} className="shrink-0" />
                      <span className="truncate">{getDomain(review.url)}</span>
                    </a>
                    <div className="flex justify-end">
                      {canRemove && (
                        <button
                          onClick={() => setConfirmId(review.id)}
                          className="text-xs text-slate-300 hover:text-red-400 transition-colors"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Mobile stacked */}
                  <div className="sm:hidden space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{review.user.name}</p>
                        <p className="text-xs text-slate-400">
                          {format(new Date(review.submittedAt), 'dd MMM yyyy')}
                          {review.clientName && (
                            <> · <span className="text-slate-500">{review.clientName}</span></>
                          )}
                        </p>
                      </div>
                      {canRemove && (
                        <button
                          onClick={() => setConfirmId(review.id)}
                          className="text-xs text-slate-300 hover:text-red-400 transition-colors shrink-0"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <a
                      href={review.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                      title={review.url}
                    >
                      <ExternalLink size={12} strokeWidth={1.5} className="shrink-0" />
                      <span className="truncate">{getDomain(review.url)}</span>
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Review modal */}
      <Modal open={showForm} onClose={() => { setShowForm(false); resetForm(); }} title="Submit Review Link">
        <div className="space-y-4">
          <div>
            <label className="label">Review Link *</label>
            <input
              type="url"
              className="input"
              placeholder="https://g.co/review/..."
              value={form.url}
              onChange={(e) => { setForm((f) => ({ ...f, url: e.target.value })); setUrlError(''); }}
              autoFocus
            />
            {urlError && <p className="mt-1 text-xs text-red-500">{urlError}</p>}
          </div>

          <div>
            <label className="label">Client Name</label>
            <input
              className="input"
              placeholder="Optional — e.g. John Smith"
              value={form.clientName}
              onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Date Submitted</label>
            <input
              type="date"
              className="input"
              value={form.submittedAt}
              onChange={(e) => setForm((f) => ({ ...f, submittedAt: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              className="btn-secondary flex-1"
              onClick={() => { setShowForm(false); resetForm(); }}
            >
              Cancel
            </button>
            <button
              className="btn-accent flex-1"
              onClick={handleSubmit}
              disabled={submitting || !form.url}
            >
              {submitting ? 'Submitting…' : 'Submit Review'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmId}
        message="Remove this review?"
        onConfirm={() => { if (confirmId) handleArchive(confirmId); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
