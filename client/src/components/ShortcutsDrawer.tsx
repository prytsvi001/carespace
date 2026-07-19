// client/src/components/ShortcutsDrawer.tsx
// Floating "Shortcuts" button + slide-in drawer, mounted once at the app root
// so it stays visible across every tab. Self-contained: fetches its own data
// and hides itself entirely for peek_handler users.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, X, Search, Copy, Check, ExternalLink, Plus, Pencil, Trash2, ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getShortcuts, createShortcut, updateShortcut, deleteShortcut } from '../api';
import { Shortcut, ShortcutType } from '../types';
import { Spinner, EmptyState, ConfirmDialog, AutoTextarea } from './ui';

type View = 'list' | 'form';

export function ShortcutsDrawer() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'head' || user?.role === 'lead';

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('list');
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Shortcut | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shortcut | null>(null);

  const fetchShortcuts = async () => {
    setLoading(true);
    try {
      setShortcuts(await getShortcuts());
    } catch {
      // ignore — drawer just shows empty state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchShortcuts();
  }, [open]);

  // peek_handler users never see the button at all
  if (user?.role === 'peek_handler') return null;

  const categories = useMemo(() => {
    const set = new Set<string>();
    shortcuts.forEach((s) => { if (s.category) set.add(s.category); });
    return Array.from(set).sort();
  }, [shortcuts]);

  const filtered = shortcuts.filter((s) => {
    if (activeCategory && s.category !== activeCategory) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q);
  });

  const handleCopy = async (s: Shortcut) => {
    await navigator.clipboard.writeText(s.content);
    setCopiedId(s.id);
    setTimeout(() => setCopiedId((id) => (id === s.id ? null : id)), 1500);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await deleteShortcut(target.id);
    fetchShortcuts();
  };

  const closeDrawer = () => {
    setOpen(false);
    setView('list');
  };

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-50 flex items-center gap-2 pl-3 pr-4 py-3 rounded-full shadow-lg font-semibold text-sm transition-transform hover:scale-105"
        style={{ backgroundColor: '#A1F96E', color: '#0E0E0E', border: '1px solid rgba(14,14,14,0.14)' }}
        aria-label="Shortcuts"
      >
        <ClipboardList size={18} strokeWidth={1.8} />
        <span className="hidden sm:inline">Shortcuts</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-[#0E0E0E]/40 backdrop-blur-sm" onClick={closeDrawer} />
          <div
            className="absolute top-0 right-0 h-full w-full md:w-[420px] bg-white shadow-2xl flex flex-col"
            style={{ borderLeft: '1px solid rgba(14,14,14,0.09)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 shrink-0" style={{ borderBottom: '1px solid rgba(14,14,14,0.09)' }}>
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                {view === 'form' ? (
                  <button onClick={() => setView('list')} className="text-ink/40 hover:text-ink transition-colors" aria-label="Back">
                    <ArrowLeft size={18} />
                  </button>
                ) : (
                  <ClipboardList size={18} strokeWidth={1.8} />
                )}
                {view === 'form' ? (editing ? 'Edit Shortcut' : 'Add Shortcut') : 'Shortcuts'}
              </h2>
              <button onClick={closeDrawer} className="text-ink/40 hover:text-ink transition-colors" aria-label="Close">
                <X size={20} />
              </button>
            </div>

            {view === 'form' ? (
              <ShortcutForm
                initial={editing}
                categories={categories}
                onCancel={() => setView('list')}
                onSaved={() => { setView('list'); fetchShortcuts(); }}
              />
            ) : (
              <>
                {/* Search + add + categories */}
                <div className="p-4 space-y-3 shrink-0" style={{ borderBottom: '1px solid rgba(14,14,14,0.09)' }}>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(14,14,14,0.35)' }} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search shortcuts..."
                      className="input pl-8 text-sm"
                    />
                  </div>

                  <button
                    onClick={() => { setEditing(null); setView('form'); }}
                    className="btn-accent w-full flex items-center justify-center gap-1.5"
                  >
                    <Plus size={14} strokeWidth={2} />
                    Add Shortcut
                  </button>

                  {categories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setActiveCategory(null)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                        style={
                          !activeCategory
                            ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
                            : { color: 'rgba(14,14,14,0.45)', backgroundColor: 'rgba(14,14,14,0.05)' }
                        }
                      >
                        All
                      </button>
                      {categories.map((c) => (
                        <button
                          key={c}
                          onClick={() => setActiveCategory(c)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-all"
                          style={
                            activeCategory === c
                              ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
                              : { color: 'rgba(14,14,14,0.45)', backgroundColor: 'rgba(14,14,14,0.05)' }
                          }
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {loading && <div className="flex justify-center py-8"><Spinner /></div>}
                  {!loading && filtered.length === 0 && (
                    <EmptyState icon={<ClipboardList size={28} strokeWidth={1.3} />} message="No shortcuts found" />
                  )}
                  {!loading && filtered.map((s) => (
                    <div key={s.id} className="card">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-ink truncate">{s.title}</p>
                          {s.category && (
                            <span
                              className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full capitalize"
                              style={{ backgroundColor: 'rgba(14,14,14,0.06)', color: 'rgba(14,14,14,0.5)' }}
                            >
                              {s.category}
                            </span>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => { setEditing(s); setView('form'); }}
                              className="p-1 rounded hover:bg-black/5 transition-colors"
                              style={{ color: 'rgba(14,14,14,0.4)' }}
                              aria-label="Edit"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(s)}
                              className="p-1 rounded hover:bg-red-50 hover:text-red-600 transition-colors"
                              style={{ color: 'rgba(14,14,14,0.4)' }}
                              aria-label="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>

                      <p
                        className="text-xs mt-2"
                        style={{
                          color: 'rgba(14,14,14,0.55)',
                          whiteSpace: 'pre-wrap',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {s.content}
                      </p>

                      <div className="mt-3">
                        {s.type === 'link' ? (
                          <a
                            href={s.content}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary inline-flex items-center gap-1.5 text-xs"
                          >
                            <ExternalLink size={12} />
                            Open link
                          </a>
                        ) : (
                          <button
                            onClick={() => handleCopy(s)}
                            className="btn-secondary inline-flex items-center gap-1.5 text-xs"
                          >
                            {copiedId === s.id ? <Check size={12} /> : <Copy size={12} />}
                            {copiedId === s.id ? 'Copied!' : 'Copy'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        message={`Delete "${deleteTarget?.title}"? This can't be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

// ─── Add/Edit form ───────────────────────────────────────────────────────────

function ShortcutForm({
  initial, categories, onCancel, onSaved,
}: {
  initial: Shortcut | null;
  categories: string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [type, setType] = useState<ShortcutType>(initial?.type ?? 'text');
  const [content, setContent] = useState(initial?.content ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = { title: title.trim(), type, content: content.trim(), category: category.trim() };
      if (initial) {
        await updateShortcut(initial.id, data);
      } else {
        await createShortcut(data);
      }
      onSaved();
    } catch {
      setError('Failed to save shortcut');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <label className="label">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Refund policy reply"
          className="input"
        />
      </div>

      <div>
        <label className="label">Type</label>
        <div className="flex gap-2">
          {(['text', 'link'] as ShortcutType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-medium capitalize transition-all"
              style={
                type === t
                  ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E', border: '1px solid rgba(14,14,14,0.14)' }
                  : { color: 'rgba(14,14,14,0.45)', backgroundColor: 'rgba(14,14,14,0.05)', border: '1px solid transparent' }
              }
            >
              {t === 'text' ? 'Text template' : 'Link'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">{type === 'link' ? 'URL' : 'Content'}</label>
        {type === 'link' ? (
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="https://..."
            className="input"
          />
        ) : (
          <AutoTextarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Full text of the template..."
            className="input text-sm"
          />
        )}
      </div>

      <div>
        <label className="label">Category</label>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. billing, onboarding"
          list="shortcut-categories"
          className="input"
        />
        <datalist id="shortcut-categories">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={saving} className="btn-accent flex-1">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}
