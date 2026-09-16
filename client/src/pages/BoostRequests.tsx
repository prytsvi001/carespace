// client/src/pages/BoostRequests.tsx
// Peekviewer Team — "Boost" tab. Any team member can create a request;
// peekviewerAdmin users (Yana Fedorova, Sandra Moore, Victoria Davis) see the
// full active queue and can complete/edit/delete any request.
import React, { useEffect, useState } from 'react';
import { Rocket, Plus, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import {
  getBoostRequests, createBoostRequestsBulk, completeBoostRequest, updateBoostRequest, deleteBoostRequest,
  BoostRequest,
} from '../api';
import { Modal, EmptyState, ConfirmDialog, CardListSkeleton } from '../components/ui';
import {
  BoostRequestRow, BoostRequestRowsEditor, emptyBoostRequestRow, cleanBoostRequestRows,
  BOOST_TYPE_LABELS, groupBoostRequestsByBatch, BoostRequestBatchCard,
} from '../components/boostRequestRows';

type BoostType = 'likes' | 'followers' | 'comments';

// Admin queue is split into these three blocks, in this order.
const BOOST_TYPE_ORDER: BoostType[] = ['likes', 'comments', 'followers'];

function linkLabel(type: BoostType): string {
  return type === 'followers' ? 'Link (account)' : 'Link (post)';
}

export default function BoostRequests() {
  const { user } = useAuth();
  const isAdmin = !!user?.peekviewerAdmin;

  const [requests, setRequests] = useState<BoostRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  const load = async () => {
    try {
      setRequests(await getBoostRequests(isAdmin && showCompleted));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompleted]);

  // ── Create modal ──────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [rows, setRows] = useState<BoostRequestRow[]>([emptyBoostRequestRow()]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const openCreate = () => {
    setRows([emptyBoostRequestRow()]);
    setCreateError('');
    setShowCreate(true);
  };

  const cleanedRows = cleanBoostRequestRows(rows);
  const canSend = !!cleanedRows;

  const handleCreate = async () => {
    if (!cleanedRows) {
      setCreateError('Please fill in a link and a valid quantity for every row.');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const created = await createBoostRequestsBulk(cleanedRows);
      setRequests((prev) => [...created, ...prev]);
      setShowCreate(false);
    } catch (e: any) {
      setCreateError(e?.response?.data?.error ?? 'Failed to send requests.');
    } finally {
      setCreating(false);
    }
  };

  // ── Admin actions ─────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLink, setEditLink] = useState('');
  const [editQuantity, setEditQuantity] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleComplete = async (id: string) => {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'complete' } : r)));
    try {
      const updated = await completeBoostRequest(id);
      if (!showCompleted) {
        setRequests((prev) => prev.filter((r) => r.id !== id));
      } else {
        setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
      }
    } catch (e) {
      console.error(e);
      load();
    }
  };

  const openEdit = (r: BoostRequest) => {
    setEditingId(r.id);
    setEditLink(r.link);
    setEditQuantity(String(r.quantity));
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      const updated = await updateBoostRequest(editingId, { link: editLink.trim(), quantity: Number(editQuantity) });
      setRequests((prev) => prev.map((r) => (r.id === editingId ? updated : r)));
      setEditingId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteBoostRequest(id);
    } catch (e) {
      console.error(e);
      load();
    }
  };

  // Non-admins deleting their own request — scoped so it only disappears
  // from their own list, never from the admin queue (see server DELETE /:id).
  const [confirmDeleteMineId, setConfirmDeleteMineId] = useState<string | null>(null);
  const handleDeleteMine = async (id: string) => {
    setConfirmDeleteMineId(null);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteBoostRequest(id, 'requester');
    } catch (e) {
      console.error(e);
      load();
    }
  };

  const renderCard = (r: BoostRequest) => {
    const isComplete = r.status === 'complete';
    const isEditing = editingId === r.id;
    return (
      <div key={r.id} className="card">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {BOOST_TYPE_LABELS[r.boostType]}
            </span>
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={isComplete
                ? { backgroundColor: 'rgba(161,249,110,0.28)', color: '#166534' }
                : { backgroundColor: 'rgba(14,14,14,0.07)', color: 'rgba(14,14,14,0.55)' }}
            >
              {isComplete ? 'Complete' : 'In progress'}
            </span>
            {isAdmin && (
              <span className="text-xs text-slate-400">by {r.requesterName}</span>
            )}
          </div>
          <span className="text-xs text-slate-400 shrink-0">
            {format(new Date(r.createdAt), 'dd MMM yyyy')}
          </span>
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <input className="input text-sm w-full" value={editLink} onChange={(e) => setEditLink(e.target.value)} placeholder={linkLabel(r.boostType)} />
            <input className="input text-sm w-full" type="number" min={1} value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} placeholder="Quantity" />
            <div className="flex gap-2">
              <button className="btn-accent text-xs" onClick={handleSaveEdit}>Save</button>
              <button className="btn-secondary text-xs" onClick={() => setEditingId(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-700 break-all">{r.link}</p>
            <p className="text-xs text-slate-400 mt-1">Quantity: {r.quantity}</p>
            {r.completedByName && (
              <p className="text-xs text-slate-400 mt-1">Completed by {r.completedByName}</p>
            )}
          </>
        )}

        {isAdmin && !isEditing && (
          <div className="mt-3 flex justify-end gap-2 flex-wrap">
            {!isComplete && (
              <button
                onClick={() => handleComplete(r.id)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:brightness-95"
                style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
              >
                <CheckCircle2 size={13} strokeWidth={2} />
                Complete
              </button>
            )}
            <button
              onClick={() => openEdit(r)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
            >
              <Pencil size={13} strokeWidth={1.8} />
              Edit
            </button>
            <button
              onClick={() => setConfirmDeleteId(r.id)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
              style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
            >
              <Trash2 size={13} strokeWidth={1.8} />
              Delete
            </button>
          </div>
        )}
      </div>
    );
  };

  const groupedByType = isAdmin
    ? BOOST_TYPE_ORDER.map((type) => ({ type, items: requests.filter((r) => r.boostType === type) })).filter((g) => g.items.length > 0)
    : [];
  const groupedByBatch = !isAdmin ? groupBoostRequestsByBatch(requests) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Boost</h2>
          <p className="text-sm text-slate-400">
            {isAdmin ? 'All boost requests from the team' : 'Your boost requests'}
          </p>
        </div>
        <button onClick={openCreate} className="btn-accent text-sm flex items-center gap-1.5 shrink-0">
          <Plus size={14} strokeWidth={2} />
          Create New Request
        </button>
      </div>

      {isAdmin && (
        <label className="flex items-center gap-2 text-xs" style={{ color: 'rgba(14,14,14,0.55)' }}>
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          Show completed too
        </label>
      )}

      {loading ? (
        <CardListSkeleton />
      ) : requests.length === 0 ? (
        <EmptyState icon={<Rocket size={32} strokeWidth={1.2} />} message="No boost requests yet." />
      ) : isAdmin ? (
        <div className="space-y-5">
          {groupedByType.map(({ type, items }) => (
            <div key={type} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgba(14,14,14,0.45)' }}>
                {BOOST_TYPE_LABELS[type]} <span className="font-normal normal-case">({items.length})</span>
              </p>
              {items.map((r) => renderCard(r))}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {groupedByBatch.map(({ key, items }) => (
            <BoostRequestBatchCard key={key} items={items} onDelete={(id) => setConfirmDeleteMineId(id)} />
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New Request" maxWidth="max-w-xl">
        <div className="space-y-3">
          <BoostRequestRowsEditor rows={rows} onChange={setRows} />
          {createError && <p className="text-xs text-red-500">{createError}</p>}
          <div className="flex justify-end">
            <button className="btn-accent text-sm" onClick={handleCreate} disabled={!canSend || creating}>
              {creating ? 'Sending…' : `Send ${rows.length} boost request${rows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this boost request? This cannot be undone."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ConfirmDialog
        open={!!confirmDeleteMineId}
        message="Delete this boost request from your list? This cannot be undone."
        onConfirm={() => { if (confirmDeleteMineId) handleDeleteMine(confirmDeleteMineId); }}
        onCancel={() => setConfirmDeleteMineId(null)}
      />
    </div>
  );
}
