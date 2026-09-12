// client/src/pages/RowAccountsPool.tsx
// Peekviewer Team — "Row Accounts" tab. Same shared-pool/claim shape as
// ProxyPool.tsx, but each item holds a full credential set, shown as one row
// of copyable fields (nickname → password → [2FA] → email → email password),
// and batches are grouped into named blocks by an optional Header.
import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, Copy, Check, Trash2, List } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getRowAccounts, addRowAccountsBulk, takeRowAccount, deleteRowAccount, RowAccountItem, RowAccountMode } from '../api';
import { Modal, EmptyState, ConfirmDialog, CardListSkeleton } from '../components/ui';

const FIELDS: { key: keyof RowAccountItem; label: string }[] = [
  { key: 'login', label: 'Nickname' },
  { key: 'password', label: 'Password' },
  { key: 'twoFaCode', label: '2FA' },
  { key: 'email', label: 'Email' },
  { key: 'emailPassword', label: 'Email password' },
];

function CopyField({ label, value, onCopy, isCopied }: {
  label: string; value: string | null; onCopy: () => void; isCopied: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5 text-sm shrink-0">
      <span className="text-xs text-slate-400">{label}:</span>
      <span className="font-mono text-slate-700">{value}</span>
      <button
        onClick={onCopy}
        className="shrink-0 flex items-center p-1 rounded-lg transition-colors"
        style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
      >
        {isCopied ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.8} />}
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

  // Groups the (already newest-first sorted) displayed list into named blocks
  // by header, e.g. "Instagram", "TikTok" — "" becomes "Ungrouped".
  const groups = React.useMemo(() => {
    const map = new Map<string, RowAccountItem[]>();
    for (const a of displayed) {
      const key = a.header || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return Array.from(map.entries()).map(([header, items]) => ({ header, items }));
  }, [displayed]);

  const existingHeaders = React.useMemo(
    () => Array.from(new Set(accounts.map((a) => a.header).filter(Boolean))).sort(),
    [accounts],
  );

  const groupAnchorId = (header: string) => `row-account-group-${header || '__ungrouped__'}`;
  const scrollToGroup = (header: string) => {
    document.getElementById(groupAnchorId(header))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Bulk add ──────────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [mode, setMode] = useState<RowAccountMode>('with2fa');
  const [bulkHeader, setBulkHeader] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const handleAdd = async () => {
    if (!bulkText.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const created = await addRowAccountsBulk(bulkText, mode, bulkHeader);
      setAccounts((prev) => [...created, ...prev]);
      setBulkText('');
      setBulkHeader('');
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
    setConfirmTakeId(null);
  };

  const [confirmTakeId, setConfirmTakeId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    try { await deleteRowAccount(id); } catch (e) { console.error(e); load(); }
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

      {!loading && groups.length > 1 && (
        <div className="card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: 'rgba(14,14,14,0.45)' }}>
            <List size={12} strokeWidth={2} />
            Quick navigation
          </p>
          <div className="flex flex-col">
            {groups.map(({ header, items }) => (
              <button
                key={header || '__ungrouped__'}
                onClick={() => scrollToGroup(header)}
                className="flex items-center justify-between gap-2 text-left text-sm px-2 py-1.5 rounded-lg transition-colors hover:bg-slate-50"
                style={{ color: 'rgba(14,14,14,0.7)' }}
              >
                <span className="truncate">{header || 'Ungrouped'}</span>
                <span className="text-xs shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }}>{items.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <CardListSkeleton />
      ) : displayed.length === 0 ? (
        <EmptyState icon={<KeyRound size={32} strokeWidth={1.2} />} message={view === 'available' ? 'No row accounts available.' : 'Nothing archived yet.'} />
      ) : (
        <div className="space-y-5">
          {groups.map(({ header, items }) => (
            <div key={header || '__ungrouped__'} id={groupAnchorId(header)} className="space-y-2" style={{ scrollMarginTop: '80px' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgba(14,14,14,0.45)' }}>
                {header || 'Ungrouped'} <span className="font-normal normal-case">({items.length})</span>
              </p>
              {items.map((a) => (
                <div key={a.id} className="card" style={a.takenById ? { opacity: 0.55 } : undefined}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-4 flex-wrap min-w-0">
                      {FIELDS.map(({ key, label }) => (
                        <CopyField
                          key={key}
                          label={label}
                          value={a[key] as string | null}
                          isCopied={copiedKey === `${a.id}:${key}`}
                          onCopy={() => handleCopy(`${a.id}:${key}`, String(a[key] ?? ''))}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!a.takenById && (
                        <button
                          onClick={() => setConfirmTakeId(a.id)}
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

                  {a.takenById && (
                    <p className="text-xs text-slate-400 mt-2">Taken by {a.takenByName}</p>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add new row accounts">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Header (e.g. Instagram, TikTok)</label>
            <input
              className="input text-sm w-full"
              list="row-account-headers"
              value={bulkHeader}
              onChange={(e) => setBulkHeader(e.target.value)}
              placeholder="Optional — groups this batch under a named block"
            />
            <datalist id="row-account-headers">
              {existingHeaders.map((h) => <option key={h} value={h} />)}
            </datalist>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Format</label>
            <div className="flex gap-1">
              {(['with2fa', 'without2fa'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={mode === m
                    ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
                    : { backgroundColor: 'rgba(14,14,14,0.05)', color: 'rgba(14,14,14,0.5)' }}
                >
                  {m === 'with2fa' ? 'With 2FA' : 'Without 2FA'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              One account per line, separated by spaces or colons:{' '}
              <code>{mode === 'with2fa' ? 'nickname password 2FA email emailPassword' : 'nickname password email emailPassword'}</code>
            </label>
            <textarea
              className="input text-sm w-full font-mono"
              rows={8}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={mode === 'with2fa'
                ? 'nick1 password1 123456 email1@x.com emailpass1\nnick2 password2'
                : 'nick1 password1 email1@x.com emailpass1\nnick2 password2'}
            />
          </div>
          {addError && <p className="text-xs text-red-500">{addError}</p>}
          <div className="flex justify-end">
            <button className="btn-accent text-sm" onClick={handleAdd} disabled={!bulkText.trim() || adding}>
              {adding ? 'Adding…' : 'Add accounts'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmTakeId}
        message="Take this account? It will move to Archive and no longer be available to the team."
        onConfirm={() => { if (confirmTakeId) handleTake(confirmTakeId); }}
        onCancel={() => setConfirmTakeId(null)}
      />

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this account? This cannot be undone."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
