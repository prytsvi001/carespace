// client/src/pages/BoostRequests.tsx
// Peekviewer Team — "Boost" tab. Any team member can create a request;
// peekviewerAdmin users (Yana Fedorova, Sandra Moore, Victoria Davis) see the
// full active queue and can complete/edit/delete any request.
import React, { useEffect, useState } from 'react';
import { Rocket, Plus, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import {
  getBoostRequests, createBoostRequest, completeBoostRequest, updateBoostRequest, deleteBoostRequest,
  BoostRequest,
} from '../api';
import { Modal, EmptyState, ConfirmDialog, CardListSkeleton } from '../components/ui';

type BoostType = 'likes' | 'followers' | 'comments';

const BOOST_TYPE_LABELS: Record<BoostType, string> = {
  likes: 'Likes',
  followers: 'Followers',
  comments: 'Comments',
};

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
  const [boostType, setBoostType] = useState<BoostType>('likes');
  const [link, setLink] = useState('');
  const [quantity, setQuantity] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const openCreate = () => {
    setBoostType('likes'); setLink(''); setQuantity(''); setCreateError('');
    setShowCreate(true);
  };

  const canSend = link.trim() && Number(quantity) > 0;

  const handleCreate = async () => {
    if (!canSend) return;
    setCreating(true);
    setCreateError('');
    try {
      const created = await createBoostRequest({ boostType, link: link.trim(), quantity: Number(quantity) });
      setRequests((prev) => [created, ...prev]);
      setShowCreate(false);
    } catch (e: any) {
      setCreateError(e?.response?.data?.error ?? 'Failed to send request.');
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
    setRequests((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteBoostRequest(id);
    } catch (e) {
      console.error(e);
      load();
    }
    setConfirmDeleteId(null);
  };

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
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
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
          })}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New Request">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Boost type</label>
            <select
              className="input text-sm w-full"
              value={boostType}
              onChange={(e) => setBoostType(e.target.value as BoostType)}
            >
              <option value="likes">Boost Likes</option>
              <option value="followers">Boost Followers</option>
              <option value="comments">Boost Comments</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{linkLabel(boostType)}</label>
            <input className="input text-sm w-full" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Quantity</label>
            <input className="input text-sm w-full" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          {createError && <p className="text-xs text-red-500">{createError}</p>}
          <div className="flex justify-end">
            <button className="btn-accent text-sm" onClick={handleCreate} disabled={!canSend || creating}>
              {creating ? 'Sending…' : 'Send boost request'}
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
    </div>
  );
}
