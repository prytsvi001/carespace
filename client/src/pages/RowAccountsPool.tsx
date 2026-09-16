// client/src/pages/RowAccountsPool.tsx
// Peekviewer Team — "Row Accounts" tab. Same shared-pool/claim/archive shape
// as ProxyPool.tsx (taking just highlights the row; a separate Archive
// button, no confirmation, is what moves it out), but each item holds a full
// credential set, shown as one row of copyable fields (nickname → password →
// [2FA] → email → email password), and batches are grouped into named
// blocks by an optional Header.
//
// A third view, "Reserve email", lives alongside Available/Archive: a flat
// table of spare email inboxes (admin-managed add/edit/delete) where any
// team member can tag the nickname of an account they registered against
// that email via "+", so everyone can see at a glance how many accounts are
// already tied to a given reserve email before reusing it.
import React, { useEffect, useState } from 'react';
import { KeyRound, Mail, Plus, Copy, Check, Trash2, List, Archive, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getRowAccounts, addRowAccountsBulk, takeRowAccount, archiveRowAccount, deleteRowAccount, RowAccountItem, RowAccountMode,
  getReserveEmails, addReserveEmailsBulk, addReserveEmailAccount, removeReserveEmailAccount, deleteReserveEmail, ReserveEmailItem,
} from '../api';
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

// A copyable value with no label — used in the Reserve email table where the
// column header already says what the value is.
function CopyValue({ value, onCopy, isCopied }: { value: string | null; onCopy: () => void; isCopied: boolean }) {
  if (!value) return <span className="text-sm" style={{ color: 'rgba(14,14,14,0.3)' }}>—</span>;
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-sm text-slate-700">{value}</span>
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
  const [view, setView] = useState<'available' | 'archive' | 'reserve'>('available');

  const load = async () => {
    try { setAccounts(await getRowAccounts()); } catch (e) { console.error(e); }
  };

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, []);

  // ── Reserve email ────────────────────────────────────────────────────────
  const [reserveEmails, setReserveEmails] = useState<ReserveEmailItem[]>([]);
  const [reserveLoading, setReserveLoading] = useState(true);
  const loadReserve = async () => {
    try { setReserveEmails(await getReserveEmails()); } catch (e) { console.error(e); }
  };
  useEffect(() => { loadReserve().finally(() => setReserveLoading(false)); }, []);

  const [showAddReserve, setShowAddReserve] = useState(false);
  const [reserveBulkText, setReserveBulkText] = useState('');
  const [addingReserve, setAddingReserve] = useState(false);
  const [addReserveError, setAddReserveError] = useState('');

  const handleAddReserve = async () => {
    if (!reserveBulkText.trim()) return;
    setAddingReserve(true);
    setAddReserveError('');
    try {
      const created = await addReserveEmailsBulk(reserveBulkText);
      setReserveEmails((prev) => [...created, ...prev]);
      setReserveBulkText('');
      setShowAddReserve(false);
    } catch (e: any) {
      setAddReserveError(e?.response?.data?.error ?? 'Failed to add reserve emails.');
    } finally {
      setAddingReserve(false);
    }
  };

  const [newAccountFor, setNewAccountFor] = useState<string | null>(null);
  const [newAccountNickname, setNewAccountNickname] = useState('');

  const handleAddAccount = async (id: string) => {
    const nickname = newAccountNickname.trim();
    if (!nickname) return;
    try {
      const updated = await addReserveEmailAccount(id, nickname);
      setReserveEmails((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setNewAccountFor(null);
      setNewAccountNickname('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemoveAccount = async (id: string, accountId: string) => {
    setReserveEmails((prev) => prev.map((r) => (r.id === id ? { ...r, linkedAccounts: r.linkedAccounts.filter((a) => a.id !== accountId) } : r)));
    try { await removeReserveEmailAccount(id, accountId); } catch (e) { console.error(e); loadReserve(); }
  };

  const [confirmDeleteReserveId, setConfirmDeleteReserveId] = useState<string | null>(null);
  const handleDeleteReserve = async (id: string) => {
    setConfirmDeleteReserveId(null);
    setReserveEmails((prev) => prev.filter((r) => r.id !== id));
    try { await deleteReserveEmail(id); } catch (e) { console.error(e); loadReserve(); }
  };

  const available = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
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

  // No confirmation — claims the account immediately.
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
    setConfirmDeleteId(null);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    try { await deleteRowAccount(id); } catch (e) { console.error(e); load(); }
  };

  // No confirmation — moves the row to Archive immediately.
  const handleArchive = async (id: string) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, archived: true } : a)));
    try { await archiveRowAccount(id); } catch (e) { console.error(e); load(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Raw Accounts</h2>
          <p className="text-sm text-slate-400">{available.length} available · {archived.length} archived · {reserveEmails.length} reserve emails</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => (view === 'reserve' ? setShowAddReserve(true) : setShowAdd(true))}
            className="btn-accent text-sm flex items-center gap-1.5 shrink-0"
          >
            <Plus size={14} strokeWidth={2} />
            {view === 'reserve' ? 'Add reserve emails' : 'Add new row accounts'}
          </button>
        )}
      </div>

      <div className="flex gap-1">
        {(['available', 'archive', 'reserve'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-3 py-1 rounded-lg text-sm font-medium transition-all"
            style={view === v
              ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
              : { color: 'rgba(14,14,14,0.45)' }}
          >
            {v === 'available' ? 'Available' : v === 'archive' ? 'Archive' : 'Reserve email'}
          </button>
        ))}
      </div>

      {view === 'reserve' ? (
        reserveLoading ? (
          <CardListSkeleton />
        ) : reserveEmails.length === 0 ? (
          <EmptyState icon={<Mail size={32} strokeWidth={1.2} />} message="No reserve emails yet." />
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgba(14,14,14,0.45)' }}>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Email password</th>
                  <th className="px-4 py-2.5">Accounts added</th>
                  {isAdmin && <th className="px-4 py-2.5 w-8" />}
                </tr>
              </thead>
              <tbody>
                {reserveEmails.map((r) => (
                  <tr key={r.id} className="border-t align-top" style={{ borderColor: 'rgba(14,14,14,0.07)' }}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <CopyValue value={r.email} isCopied={copiedKey === `${r.id}:email`} onCopy={() => handleCopy(`${r.id}:email`, r.email)} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <CopyValue value={r.emailPassword} isCopied={copiedKey === `${r.id}:pw`} onCopy={() => handleCopy(`${r.id}:pw`, r.emailPassword || '')} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {r.linkedAccounts.map((a) => (
                          <span
                            key={a.id}
                            className="inline-flex items-center gap-1 text-xs font-medium pl-2 pr-1 py-1 rounded-full"
                            style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.75)' }}
                            title={`Added by ${a.addedByName}`}
                          >
                            {a.nickname}
                            {(isAdmin || a.addedById === user?.id) && (
                              <button
                                onClick={() => handleRemoveAccount(r.id, a.id)}
                                className="p-0.5 rounded-full transition-colors hover:bg-red-100 hover:text-red-600"
                                style={{ color: 'rgba(14,14,14,0.4)' }}
                                title="Remove"
                              >
                                <X size={10} strokeWidth={2.5} />
                              </button>
                            )}
                          </span>
                        ))}
                        {newAccountFor === r.id ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              autoFocus
                              className="input text-xs py-1 px-2 w-28"
                              placeholder="Nickname"
                              value={newAccountNickname}
                              onChange={(e) => setNewAccountNickname(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddAccount(r.id);
                                if (e.key === 'Escape') { setNewAccountFor(null); setNewAccountNickname(''); }
                              }}
                              onBlur={() => { if (!newAccountNickname.trim()) setNewAccountFor(null); }}
                            />
                            <button
                              onClick={() => handleAddAccount(r.id)}
                              disabled={!newAccountNickname.trim()}
                              className="p-1 rounded-full transition-colors"
                              style={{ backgroundColor: 'rgba(161,249,110,0.35)', color: '#0E0E0E' }}
                            >
                              <Check size={11} strokeWidth={2.5} />
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => { setNewAccountFor(r.id); setNewAccountNickname(''); }}
                            className="p-1 rounded-full transition-colors"
                            style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.55)' }}
                            title="Add account"
                          >
                            <Plus size={11} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setConfirmDeleteReserveId(r.id)}
                          className="p-1.5 rounded-lg transition-colors hover:bg-red-50 hover:text-red-600"
                          style={{ color: 'rgba(14,14,14,0.35)' }}
                          title="Delete"
                        >
                          <Trash2 size={14} strokeWidth={1.8} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {view !== 'reserve' && !loading && groups.length > 1 && (
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

      {view !== 'reserve' && (loading ? (
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
                <div
                  key={a.id}
                  className="card"
                  style={
                    view === 'archive'
                      ? { opacity: 0.55 }
                      : a.takenById
                        ? { backgroundColor: 'rgba(161,249,110,0.16)', border: '1px solid rgba(161,249,110,0.55)' }
                        : undefined
                  }
                >
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
                      {!a.takenById && view === 'available' && (
                        <button
                          onClick={() => handleTake(a.id)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:brightness-95"
                          style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
                        >
                          Taken by me
                        </button>
                      )}
                      {view === 'available' && (
                        <button
                          onClick={() => handleArchive(a.id)}
                          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                          style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.7)' }}
                        >
                          <Archive size={13} strokeWidth={1.8} />
                          Archive
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
      ))}

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
        open={!!confirmDeleteId}
        message="Delete this account? This cannot be undone."
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <Modal open={showAddReserve} onClose={() => setShowAddReserve(false)} title="Add reserve emails">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">One email per line: <code>email password</code> (password optional)</label>
            <textarea
              className="input text-sm w-full font-mono"
              rows={8}
              value={reserveBulkText}
              onChange={(e) => setReserveBulkText(e.target.value)}
              placeholder={'reserve1@x.com pass1\nreserve2@x.com pass2'}
            />
          </div>
          {addReserveError && <p className="text-xs text-red-500">{addReserveError}</p>}
          <div className="flex justify-end">
            <button className="btn-accent text-sm" onClick={handleAddReserve} disabled={!reserveBulkText.trim() || addingReserve}>
              {addingReserve ? 'Adding…' : 'Add emails'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDeleteReserveId}
        message="Delete this reserve email? This cannot be undone."
        onConfirm={() => { if (confirmDeleteReserveId) handleDeleteReserve(confirmDeleteReserveId); }}
        onCancel={() => setConfirmDeleteReserveId(null)}
      />
    </div>
  );
}
