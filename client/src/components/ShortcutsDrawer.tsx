// client/src/components/ShortcutsDrawer.tsx
// Floating "Shortcuts" button + slide-in drawer, mounted once at the app root
// so it stays visible across every tab. Self-contained: fetches its own data
// and hides itself entirely for peek_handler users.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, X, Search, Copy, Check, ExternalLink, Plus, Pencil, Trash2, ArrowLeft,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useAuth } from '../context/AuthContext';
import {
  getShortcuts, createShortcut, updateShortcut, deleteShortcut,
  renameShortcutCategory, deleteShortcutCategory,
} from '../api';
import { Shortcut, ShortcutType, ShortcutVariant } from '../types';
import { Spinner, EmptyState, ConfirmDialog, AutoTextarea } from './ui';

// Single-line breaks (not just blank-line paragraph breaks) should render as <br>,
// since shortcut text is closer to a chat reply than a document — most line breaks
// in these templates aren't meant to start a new paragraph.
marked.setOptions({ breaks: true, gfm: true });

// Shortcut text is free-typed by any authenticated user (not just admins — see
// POST /api/shortcuts), so it's stored-XSS-reachable if rendered unsanitized —
// DOMPurify strips anything marked's HTML-passthrough would otherwise let through.
function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
}

type View = 'list' | 'form';

// Muted accent palette for category color-coding — deliberately soft, not the
// bright/primary hues elsewhere in the app, so they read as organizational
// labels rather than status/priority indicators.
const CATEGORY_COLORS = ['#85B7EB', '#97C459', '#F0997B', '#AFA9EC', '#D4A847', '#5DCAA5'];
const NO_CATEGORY_COLOR = 'rgba(14,14,14,0.25)';
const ALL_COLOR = '#A1F96E'; // matches the app's lime brand accent, used for the "All" filter only

// Deterministic hash so the same category name always gets the same color
// (no persistence needed), cycling through the palette for any number of categories.
function colorForCategory(category: string): string {
  if (!category) return NO_CATEGORY_COLOR;
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}

// Shortcuts created before variants existed have an empty `variants` array —
// treat their single `content` as an implicit "Variant 1" everywhere.
function effectiveVariants(s: Shortcut): ShortcutVariant[] {
  if (s.variants.length > 0) return s.variants;
  return [{ id: 'legacy', label: 'Variant 1', content: s.content }];
}

export function ShortcutsDrawer() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'head' || user?.role === 'lead';

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('list');
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [editing, setEditing] = useState<Shortcut | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shortcut | null>(null);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<string | null>(null);

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

  const matchesSearch = (s: Shortcut) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    if (s.title.toLowerCase().includes(q)) return true;
    return effectiveVariants(s).some((v) => v.content.toLowerCase().includes(q));
  };

  // Used when one specific category is selected in the sidebar.
  const filtered = shortcuts.filter((s) => (!activeCategory || s.category === activeCategory) && matchesSearch(s));

  // Used for the "All" view — grouped by category so the library reads as an
  // organized reference rather than one long flat list.
  const groupedByCategory = useMemo(() => {
    const searched = shortcuts.filter(matchesSearch);
    const byCategory = new Map<string, Shortcut[]>();
    for (const s of searched) {
      const key = s.category || '';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(s);
    }
    const groups: { key: string; label: string; color: string; items: Shortcut[] }[] = [];
    for (const c of categories) {
      const items = byCategory.get(c);
      if (items?.length) groups.push({ key: c, label: c, color: colorForCategory(c), items });
    }
    const uncategorized = byCategory.get('');
    if (uncategorized?.length) {
      groups.push({ key: '__none', label: 'Uncategorized', color: NO_CATEGORY_COLOR, items: uncategorized });
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcuts, search, categories]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setShortcuts(prev => prev.filter(s => s.id !== target.id));
    try {
      await deleteShortcut(target.id);
    } catch (e) {
      console.error(e);
      fetchShortcuts();
    }
  };

  const startRenameCategory = (cat: string) => {
    setRenamingCategory(cat);
    setRenameDraft(cat);
  };

  const commitRenameCategory = async () => {
    if (!renamingCategory) return;
    const from = renamingCategory;
    const to = renameDraft.trim();
    setRenamingCategory(null);
    if (!to || to === from) return;
    setShortcuts((prev) => prev.map((s) => (s.category === from ? { ...s, category: to } : s)));
    if (activeCategory === from) setActiveCategory(to);
    try {
      await renameShortcutCategory(from, to);
    } catch (e) {
      console.error(e);
      fetchShortcuts();
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryTarget) return;
    const target = deleteCategoryTarget;
    setDeleteCategoryTarget(null);
    if (activeCategory === target) setActiveCategory(null);
    setShortcuts((prev) => prev.filter((s) => s.category !== target));
    try {
      await deleteShortcutCategory(target);
    } catch (e) {
      console.error(e);
      fetchShortcuts();
    }
  };

  const closeDrawer = () => {
    setOpen(false);
    setView('list');
  };

  const headerBarColor = activeCategory ? colorForCategory(activeCategory) : ALL_COLOR;

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

      {/* Backdrop + panel are always mounted so the slide/fade can animate both
          ways — conditionally mounting only `open && (...)` can't animate a close. */}
      <div
        className={`fixed inset-0 z-[60] bg-[#0E0E0E]/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeDrawer}
      />
      <div
        className={`fixed inset-y-0 right-0 z-[60] w-full md:w-[600px] bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        style={{ borderLeft: '1px solid rgba(14,14,14,0.09)' }}
      >
        {/* Subtle colored accent bar reflecting the selected category */}
        <div className="h-1 shrink-0 transition-colors duration-200" style={{ backgroundColor: headerBarColor }} />

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
            {/* Search + add */}
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
            </div>

            {/* Category sidebar (own scroll, so it stays put while the cards scroll) + cards */}
            <div className="flex flex-1 min-h-0">
              <div
                className="w-36 sm:w-44 shrink-0 overflow-y-auto py-3 px-2 space-y-0.5"
                style={{ borderRight: '1px solid rgba(14,14,14,0.07)' }}
              >
                <CategorySidebarItem
                  label="All"
                  color={ALL_COLOR}
                  count={shortcuts.length}
                  active={!activeCategory}
                  onClick={() => setActiveCategory(null)}
                />
                {categories.map((c) =>
                  renamingCategory === c ? (
                    <input
                      key={c}
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRenameCategory();
                        if (e.key === 'Escape') setRenamingCategory(null);
                      }}
                      onBlur={commitRenameCategory}
                      className="input text-xs py-1.5 px-2 w-full"
                    />
                  ) : (
                    <CategorySidebarItem
                      key={c}
                      label={c}
                      color={colorForCategory(c)}
                      count={shortcuts.filter((s) => s.category === c).length}
                      active={activeCategory === c}
                      onClick={() => setActiveCategory(c)}
                      isAdmin={isAdmin}
                      onRename={() => startRenameCategory(c)}
                      onDelete={() => setDeleteCategoryTarget(c)}
                    />
                  )
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {loading && <div className="flex justify-center py-8"><Spinner /></div>}

                {!loading && activeCategory && filtered.length === 0 && (
                  <EmptyState icon={<ClipboardList size={28} strokeWidth={1.3} />} message="No shortcuts found" />
                )}
                {!loading && activeCategory && filtered.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filtered.map((s) => (
                      <ShortcutCard
                        key={s.id}
                        shortcut={s}
                        isAdmin={isAdmin}
                        onEdit={() => { setEditing(s); setView('form'); }}
                        onDelete={() => setDeleteTarget(s)}
                      />
                    ))}
                  </div>
                )}

                {!loading && !activeCategory && groupedByCategory.length === 0 && (
                  <EmptyState icon={<ClipboardList size={28} strokeWidth={1.3} />} message="No shortcuts found" />
                )}
                {!loading && !activeCategory && groupedByCategory.length > 0 && (
                  <div className="space-y-5">
                    {groupedByCategory.map((group) => (
                      <div key={group.key}>
                        <p
                          className="text-[10px] uppercase tracking-widest font-semibold mb-2 px-0.5 flex items-center gap-1.5"
                          style={{ color: 'rgba(14,14,14,0.40)' }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                          {group.label} ({group.items.length})
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {group.items.map((s) => (
                            <ShortcutCard
                              key={s.id}
                              shortcut={s}
                              isAdmin={isAdmin}
                              onEdit={() => { setEditing(s); setView('form'); }}
                              onDelete={() => setDeleteTarget(s)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        message={`Delete "${deleteTarget?.title}"? This can't be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteCategoryTarget}
        message={`Delete category "${deleteCategoryTarget}" and all ${
          deleteCategoryTarget ? shortcuts.filter((s) => s.category === deleteCategoryTarget).length : 0
        } shortcut(s) in it? This can't be undone.`}
        onConfirm={handleDeleteCategory}
        onCancel={() => setDeleteCategoryTarget(null)}
      />
    </>
  );
}

// ─── Category sidebar item ────────────────────────────────────────────────────

function CategorySidebarItem({ label, color, count, active, onClick, isAdmin, onRename, onDelete }: {
  label: string;
  color: string;
  count: number;
  active: boolean;
  onClick: () => void;
  isAdmin?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className="group w-full flex items-center gap-0.5 rounded-lg text-xs font-medium transition-all"
      style={
        active
          ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
          : { color: 'rgba(14,14,14,0.55)' }
      }
    >
      <button onClick={onClick} className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="flex-1 truncate capitalize">{label}</span>
        <span className="text-[10px] shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }}>{count}</span>
      </button>
      {isAdmin && onRename && onDelete && (
        <div className="flex items-center shrink-0 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onRename(); }}
            className="p-1 rounded hover:bg-black/5 transition-colors"
            style={{ color: 'rgba(14,14,14,0.4)' }}
            aria-label={`Rename ${label}`}
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded hover:bg-red-50 hover:text-red-600 transition-colors"
            style={{ color: 'rgba(14,14,14,0.4)' }}
            aria-label={`Delete ${label}`}
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Shortcut card ────────────────────────────────────────────────────────────

function ShortcutCard({ shortcut, isAdmin, onEdit, onDelete }: {
  shortcut: Shortcut;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copiedVariantId, setCopiedVariantId] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedVariantId) return;
    const t = setTimeout(() => setCopiedVariantId(null), 1500);
    return () => clearTimeout(t);
  }, [copiedVariantId]);

  const handleCopy = async (variantId: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedVariantId(variantId);
  };

  const variants = shortcut.type === 'text' ? effectiveVariants(shortcut) : [];
  const categoryColor = colorForCategory(shortcut.category);

  return (
    <div
      className="card p-5 cursor-pointer transition-colors hover:bg-black/[0.015]"
      style={{ borderLeft: `4px solid ${categoryColor}` }}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-ink break-words">{shortcut.title}</p>
          {shortcut.category && (
            <span
              className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full capitalize font-medium"
              style={{ backgroundColor: `${categoryColor}26`, color: categoryColor }}
            >
              {shortcut.category}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isAdmin && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="p-1 rounded hover:bg-black/5 transition-colors"
                style={{ color: 'rgba(14,14,14,0.4)' }}
                aria-label="Edit"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="p-1 rounded hover:bg-red-50 hover:text-red-600 transition-colors"
                style={{ color: 'rgba(14,14,14,0.4)' }}
                aria-label="Delete"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
          <span style={{ color: 'rgba(14,14,14,0.35)' }}>
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </div>
      </div>

      {expanded && (
        shortcut.type === 'link' ? (
          <div className="mt-3">
            <a
              href={shortcut.content}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
            >
              <ExternalLink size={12} />
              Open link
            </a>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {variants.map((v) => (
              <div key={v.id} className="rounded-lg p-2" style={{ backgroundColor: 'rgba(14,14,14,0.025)' }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(14,14,14,0.40)' }}>
                    {variants.length > 1 ? v.label : 'Text'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopy(v.id, v.content); }}
                    className="btn-secondary inline-flex items-center gap-1.5 text-xs shrink-0"
                  >
                    {copiedVariantId === v.id ? <Check size={12} /> : <Copy size={12} />}
                    {copiedVariantId === v.id ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div
                  className="shortcut-content text-xs"
                  style={{ color: 'rgba(14,14,14,0.55)' }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(v.content) }}
                />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ─── Add/Edit form ───────────────────────────────────────────────────────────

interface DraftVariant {
  label: string;
  content: string;
}

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
  const [linkContent, setLinkContent] = useState(initial?.type === 'link' ? initial.content : '');
  const [variants, setVariants] = useState<DraftVariant[]>(() => {
    if (initial && initial.type === 'text') {
      return effectiveVariants(initial).map((v) => ({ label: v.label, content: v.content }));
    }
    return [{ label: 'Variant 1', content: '' }];
  });
  const [category, setCategory] = useState(initial?.category ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addVariant = () => setVariants((prev) => [...prev, { label: `Variant ${prev.length + 1}`, content: '' }]);
  const removeVariant = (index: number) => setVariants((prev) => prev.filter((_, i) => i !== index));
  const updateVariant = (index: number, patch: Partial<DraftVariant>) =>
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (type === 'link' && !linkContent.trim()) {
      setError('URL is required');
      return;
    }
    if (type === 'text' && !variants.some((v) => v.content.trim())) {
      setError('At least one variant with text is required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const data = {
        title: title.trim(),
        type,
        category: category.trim(),
        ...(type === 'link'
          ? { content: linkContent.trim() }
          : { variants: variants.filter((v) => v.content.trim()).map((v) => ({ label: v.label.trim(), content: v.content.trim() })) }),
      };
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

      {type === 'link' ? (
        <div>
          <label className="label">URL</label>
          <input
            value={linkContent}
            onChange={(e) => setLinkContent(e.target.value)}
            placeholder="https://..."
            className="input"
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          <label className="label">Response variants</label>
          {variants.map((v, i) => (
            <div
              key={i}
              className="rounded-lg p-2 space-y-1.5"
              style={{ backgroundColor: 'rgba(14,14,14,0.025)', border: '1px solid rgba(14,14,14,0.08)' }}
            >
              <div className="flex items-center gap-2">
                <input
                  value={v.label}
                  onChange={(e) => updateVariant(i, { label: e.target.value })}
                  className="input text-xs py-1 px-2 flex-1"
                  placeholder={`Variant ${i + 1}`}
                />
                {variants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeVariant(i)}
                    className="text-slate-300 hover:text-red-500 transition-colors shrink-0"
                    aria-label="Remove variant"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <AutoTextarea
                value={v.content}
                onChange={(e) => updateVariant(i, { content: e.target.value })}
                placeholder="Full text of this variant..."
                className="input text-sm"
              />
            </div>
          ))}
          <button type="button" onClick={addVariant} className="btn-secondary text-xs flex items-center gap-1.5">
            <Plus size={12} strokeWidth={2} />
            Add variant
          </button>
        </div>
      )}

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
