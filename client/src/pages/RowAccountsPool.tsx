// client/src/pages/RowAccountsPool.tsx
// Peekviewer Team — "Row Accounts" tab. Same shared-pool/claim shape as
// ProxyPool.tsx, but each item holds a full credential set with a
// copy-to-clipboard button per field.
import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, Copy, Check, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getRowAccounts, addRowAccountsBulk, takeRowAccount, deleteRowAccount, RowAccountItem } from '../api';
import { Modal, EmptyState, ConfirmDialog, CardListSkeleton } from '../components/ui';

const FIELDS: { key: keyof RowAccountItem; label: string }[] = [
  { key: 'login', label: 'Login' },
  { key: 'password', label: 'Password' },
  { key: 'twoFaCode', label: '2FA' },
  { key: 'email', label: 'Email' },
  { key: 'emailPassword', label: 'Email password' },
];

function CopyField({ id, label, value, onCopy, isCopied }: {
  id: string; label: string; value: string | null; onCopy: () => void; isCopied: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <div className="min-w-0">
        <span className="text-xs text-slate-400">{label}: </span>
        <span className="font-mono text-slate-700 break-all">{value}</span>
      </div>
      <button
        onClick={onCopy}
        className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors"
        style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
      >
        {isCopied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.8} />}
      </button>
    </div>
  );
}

export default function RowAccountsPool() {
  const { user } = useAuth();
  const isAdmin = !!user?.peekviewerAdmin;

  const [accounts, setAccounts] = useState<RowAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'available' | 'archive'>('available');

  const load = async () => {
    try { setAccounts(await getRowAccounts()); } catch (e) { console.error(e); }
  };

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, []);

  const available = accounts.filter((a) => !a.takenById);
  const archived = accounts.filter((a) => a.takenById);
  const displayed = view === 'available' ? available : archived;

  // ── Bulk add ──────────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const handleAdd = async () => {
    if (!bulkText.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const created = await addRowAccountsBulk(bulkText);
      setAccounts((prev) => [...created, ...prev]);
      setBulkText('');
      setShowAdd(false);
    } catch (e: any) {
      setAddError(e?.response?.data?.error ?? 'Failed to add accounts.');
    } finally {
      setAdding(false);
    }
  };

  // ── Copy / Take ───────────────────────────────────────────────────────────
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedKey) return;
    const t = setTimeout(() => setCopiedKey(null), 1500);
    return () => clearTimeout(t);
  }, [copiedKey]);

  const handleCopy = async (key: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopiedKey(key); }
    catch (e) { console.error(e); }
  };

  const handleTake = async (id: string) => {
    try {
      const updated = await takeRowAccount(id);
      setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (e) {
      console.error(e);
      load();
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const handleDelete = async (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    try { await deleteRowAccount(id); } catch (e) { console.error(e); load(); }
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Row Accounts</h2>
          <p className="text-sm text-slate-400">{available.length} available · {archived.length} archived</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowAdd(true)} className="btn-accent text-sm flex items-center gap-1.5 shrink-0">
            <Plus size={14} strokeWidth={2} />
            Add new row accounts
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
        <EmptyState icon={<KeyRound size={32} strokeWidth={1.2} />} message={view === 'available' ? 'No row accounts available.' : 'Nothing archived yet.'} />
      ) : (
        <div className="space-y-2">
          {displayed.map((a) => (
            <div key={a.id} className="card space-y-2" style={a.takenById ? { opacity: 0.55 } : undefined}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700">{a.login}</p>
                <div className="flex items-center gap-2 shrink-0">
                  {!a.takenById && (
                    <button
                      onClick={() => handleTake(a.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:brightness-95"
                      style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
                    >
                      Taken by me
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => setConfirmDeleteId(a.id)}
                      className="p-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                      style={{ color: 'rgba(14,14,14,0.35)' }}
                      title="Delete"
                    >
                      <Trash2 size={14} strokeWidth={1.8} />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                {FIELDS.map(({ key, label }) => (
                  <CopyField
                    key={key}
                    id={key}
                    label={label}
                    value={a[key] as string | null}
                    isCopied={copiedKey === `${a.id}:${key}`}
                    onCopy={() => handleCopy(`${a.id}:${key}`, String(a[key] ?? ''))}
                  />
                ))}
              </div>

              {a.takenById && (
                <p className="text-xs text-slate-400">Taken by {a.takenByName}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add new row accounts">
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'rgba(14,14,14,0.45)' }}>
            One account per line: <code>login:password:2FA:email:emailPassword</code> (leave a field blank between colons if it doesn't apply)
          </p>
          <textarea
            className="input text-sm w-full font-mono"
            rows={8}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'login1:password1:123456:email1@x.com:emailpass1\nlogin2:password2:::'}
          />
          {addError && <p className="text-xs text-red-500">{addError}</p>}
          <div className="flex justify-end">
            <button className="btn-accent text-sm" onClick={handleAdd} disabled={!bulkText.trim() || adding}>
              {adding ? 'Adding…' : 'Add accounts'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this account? This cannot be undone."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
