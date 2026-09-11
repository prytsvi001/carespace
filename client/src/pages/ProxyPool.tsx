// client/src/pages/ProxyPool.tsx
// Peekviewer Team — "Proxy" tab. peekviewerAdmin users bulk-add a pasted
// list (one proxy per line); any team member can copy or claim one ("Taken
// by me"). A taken proxy moves from "Available" to "Archive" — both lists
// are visible to every Peekviewer team member.
import React, { useEffect, useState } from 'react';
import { Wifi, Plus, Copy, Check, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getProxies, addProxiesBulk, takeProxy, deleteProxy, ProxyItem } from '../api';
import { Modal, EmptyState, ConfirmDialog, CardListSkeleton } from '../components/ui';

export default function ProxyPool() {
  const { user } = useAuth();
  const isAdmin = !!user?.peekviewerAdmin;

  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'available' | 'archive'>('available');

  const load = async () => {
    try { setProxies(await getProxies()); } catch (e) { console.error(e); }
  };

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, []);

  const available = proxies.filter((p) => !p.takenById);
  const archived = proxies.filter((p) => p.takenById);
  const displayed = view === 'available' ? available : archived;

  // Groups the (already newest-first sorted) displayed list into named blocks
  // by header, e.g. "Mobile", "USA", "Ukraine" — "" becomes "Ungrouped".
  const groups = React.useMemo(() => {
    const map = new Map<string, ProxyItem[]>();
    for (const p of displayed) {
      const key = p.header || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries()).map(([header, items]) => ({ header, items }));
  }, [displayed]);

  const existingHeaders = React.useMemo(
    () => Array.from(new Set(proxies.map((p) => p.header).filter(Boolean))).sort(),
    [proxies],
  );

  // ── Bulk add ──────────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [bulkHeader, setBulkHeader] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const handleAdd = async () => {
    if (!bulkText.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const created = await addProxiesBulk(bulkText, bulkHeader);
      setProxies((prev) => [...created, ...prev]);
      setBulkText('');
      setBulkHeader('');
      setShowAdd(false);
    } catch (e: any) {
      setAddError(e?.response?.data?.error ?? 'Failed to add proxies.');
    } finally {
      setAdding(false);
    }
  };

  // ── Copy / Take ───────────────────────────────────────────────────────────
  const [copiedId, setCopiedId] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedId) return;
    const t = setTimeout(() => setCopiedId(null), 1500);
    return () => clearTimeout(t);
  }, [copiedId]);

  const handleCopy = async (id: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopiedId(id); }
    catch (e) { console.error(e); }
  };

  const handleTake = async (id: string) => {
    try {
      const updated = await takeProxy(id);
      setProxies((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (e) {
      console.error(e);
      load();
    }
    setConfirmTakeId(null);
  };

  const [confirmTakeId, setConfirmTakeId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const handleDelete = async (id: string) => {
    setProxies((prev) => prev.filter((p) => p.id !== id));
    try { await deleteProxy(id); } catch (e) { console.error(e); load(); }
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Proxy</h2>
          <p className="text-sm text-slate-400">{available.length} available · {archived.length} archived</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowAdd(true)} className="btn-accent text-sm flex items-center gap-1.5 shrink-0">
            <Plus size={14} strokeWidth={2} />
            Add new proxy
          </button>
        )}
      </div>

      <div className="flex gap-1">
        {(['available', 'archive'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-3 py-1 rounded-lg text-sm font-medium transition-all capitalize"
            style={view === v
              ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
              : { color: 'rgba(14,14,14,0.45)' }}
          >
            {v === 'available' ? 'Available' : 'Archive'}
          </button>
        ))}
      </div>

      {loading ? (
        <CardListSkeleton />
      ) : displayed.length === 0 ? (
        <EmptyState icon={<Wifi size={32} strokeWidth={1.2} />} message={view === 'available' ? 'No proxies available.' : 'Nothing archived yet.'} />
      ) : (
        <div className="space-y-5">
          {groups.map(({ header, items }) => (
            <div key={header || '__ungrouped__'} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgba(14,14,14,0.45)' }}>
                {header || 'Ungrouped'} <span className="font-normal normal-case">({items.length})</span>
              </p>
              {items.map((p) => (
                <div key={p.id} className="card flex items-center justify-between gap-3" style={p.takenById ? { opacity: 0.55 } : undefined}>
                  <div className="min-w-0">
                    <p className="text-sm font-mono text-slate-700 truncate">{p.value}</p>
                    {p.takenById ? (
                      <p className="text-xs text-slate-400 mt-0.5">Taken by {p.takenByName}</p>
                    ) : (
                      <p className="text-xs text-slate-400 mt-0.5">Added by {p.addedByName}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleCopy(p.id, p.value)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
                    >
                      {copiedId === p.id ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.8} />}
                      {copiedId === p.id ? 'Copied' : 'Copy'}
                    </button>
                    {!p.takenById && (
                      <button
                        onClick={() => setConfirmTakeId(p.id)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:brightness-95"
                        style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
                      >
                        Taken by me
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="p-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                        style={{ color: 'rgba(14,14,14,0.35)' }}
                        title="Delete"
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add new proxy">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Header (e.g. Mobile, USA, Ukraine)</label>
            <input
              className="input text-sm w-full"
              list="proxy-headers"
              value={bulkHeader}
              onChange={(e) => setBulkHeader(e.target.value)}
              placeholder="Optional — groups this batch under a named block"
            />
            <datalist id="proxy-headers">
              {existingHeaders.map((h) => <option key={h} value={h} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Proxies</label>
            <textarea
              className="input text-sm w-full font-mono"
              rows={8}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'Paste one proxy per line, e.g.\nip:port:user:pass\nip:port:user:pass'}
            />
          </div>
          {addError && <p className="text-xs text-red-500">{addError}</p>}
          <div className="flex justify-end">
            <button className="btn-accent text-sm" onClick={handleAdd} disabled={!bulkText.trim() || adding}>
              {adding ? 'Adding…' : 'Add proxies'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmTakeId}
        message="Take this proxy? It will move to Archive and no longer be available to the team."
        onConfirm={() => { if (confirmTakeId) handleTake(confirmTakeId); }}
        onCancel={() => setConfirmTakeId(null)}
      />

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this proxy? This cannot be undone."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
