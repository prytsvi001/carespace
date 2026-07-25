// client/src/components/ShortcutsDrawer.tsx
// Floating "Shortcuts" button + slide-in drawer, mounted once at the app root
// so it stays visible across every tab. Self-contained: fetches its own data
// and hides itself entirely for peek_handler users.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, X, Search, Copy, Check, ExternalLink, Plus, Pencil, Trash2, ArrowLeft,
  ChevronDown, ChevronUp, Star, Clock, Settings,
} from 'lucide-react';
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useAuth } from '../context/AuthContext';
import {
  getShortcuts, createShortcut, updateShortcut, deleteShortcut,
  renameShortcutCategory, deleteShortcutCategory, pinShortcut, recordShortcutUsage,
  getShortcutTags, reorderShortcutTags, recolorShortcutTag, renameShortcutTag,
} from '../api';
import { Shortcut, ShortcutType, ShortcutVariant, ShortcutTag, ShortcutTagKind } from '../types';
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

const ALL_COLOR = '#A1F96E'; // matches the app's lime brand accent, used when no facet is active

// Deterministic hash → color, used only for the legacy raw-category dots in
// Manage Categories (categories aren't real tags, so they have no persisted
// color of their own). Product/topic facet colors come from ShortcutTag.color.
const HASH_COLORS = ['#85B7EB', '#97C459', '#F0997B', '#AFA9EC', '#D4A847', '#5DCAA5'];
function hashColor(value: string): string {
  if (!value) return 'rgba(14,14,14,0.25)';
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return HASH_COLORS[hash % HASH_COLORS.length];
}

// A tag's persisted color is used as a chip/badge background (always a light
// tint, never solid), so the text color has to be computed rather than assumed
// — WCAG relative luminance against white vs the app's near-black ink, whichever
// gives more contrast. This lets an admin pick literally any hex via the color
// picker below without ever producing unreadable chip text.
function textColorForBackground(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linearize = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithInk = (luminance + 0.05) / (0.0044 + 0.05); // 0.0044 ≈ luminance of #0E0E0E
  return contrastWithWhite >= contrastWithInk ? '#FFFFFF' : '#0E0E0E';
}

// Shortcuts created before variants existed have an empty `variants` array —
// treat their single `content` as an implicit "Variant 1" everywhere.
function effectiveVariants(s: Shortcut): ShortcutVariant[] {
  if (s.variants.length > 0) return s.variants;
  return [{ id: 'legacy', label: 'Variant 1', content: s.content }];
}

// A row is only made expandable if there's actually more to reveal than the
// single-line preview already shows — a short one-liner has nothing to expand to.
const PREVIEW_CHAR_THRESHOLD = 80;
function isExpandable(shortcut: Shortcut): boolean {
  if (shortcut.type === 'link') return false;
  const variants = effectiveVariants(shortcut);
  if (variants.length > 1) return true;
  const content = variants[0]?.content ?? '';
  return content.includes('\n') || content.length > PREVIEW_CHAR_THRESHOLD;
}

const RECENT_LIMIT = 5;
const FILTER_STORAGE_KEY = 'carespace_shortcuts_filters';

export function ShortcutsDrawer() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'head' || user?.role === 'lead';

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('list');
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [tags, setTags] = useState<{ products: ShortcutTag[]; topics: ShortcutTag[] }>({ products: [], topics: [] });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Shortcut | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shortcut | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<string | null>(null);

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Facet filter selections persist across sessions (localStorage), matching how
  // the app already persists other lightweight UI preferences (e.g. the active
  // tab). Search itself resets each time — a stale search term silently hiding
  // everything on next open would be more confusing than helpful.
  const [activeProduct, setActiveProduct] = useState<string | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? '{}').product ?? null;
    } catch { return null; }
  });
  const [activeTopic, setActiveTopic] = useState<string | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? '{}').topic ?? null;
    } catch { return null; }
  });

  useEffect(() => {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ product: activeProduct, topic: activeTopic }));
  }, [activeProduct, activeTopic]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 2000);
    return () => clearTimeout(t);
  }, [toastMessage]);

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

  const fetchTags = async () => {
    try {
      setTags(await getShortcutTags());
    } catch {
      // ignore — facet chips just render without persisted order/color until next fetch
    }
  };

  useEffect(() => {
    if (open) { fetchShortcuts(); fetchTags(); }
  }, [open]);

  // peek_handler users never see the button at all
  if (user?.role === 'peek_handler') return null;

  // Legacy flat categories — no longer used for filtering (superseded by the
  // product/topic facets below), but still what the unchanged Add/Edit form
  // writes to, and still manageable (rename/delete) via the Manage Categories panel.
  const categories = useMemo(() => {
    const set = new Set<string>();
    shortcuts.forEach((s) => { if (s.category) set.add(s.category); });
    return Array.from(set).sort();
  }, [shortcuts]);

  // Persisted tags (order + color), filtered to ones actually in use right now —
  // an empty facet with 0 matching shortcuts would just be visual clutter.
  const visibleProductTags = useMemo(
    () => tags.products.filter((t) => shortcuts.some((s) => s.product === t.name)),
    [tags.products, shortcuts]
  );
  const visibleTopicTags = useMemo(
    () => tags.topics.filter((t) => shortcuts.some((s) => s.topic === t.name)),
    [tags.topics, shortcuts]
  );

  const tagColorFor = (s: Shortcut): string | undefined => {
    if (s.product) return tags.products.find((t) => t.name === s.product)?.color;
    if (s.topic) return tags.topics.find((t) => t.name === s.topic)?.color;
    return undefined;
  };

  const matchesSearch = (s: Shortcut) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    if (s.title.toLowerCase().includes(q)) return true;
    return effectiveVariants(s).some((v) => v.content.toLowerCase().includes(q));
  };

  // A search always looks across every shortcut, ignoring whatever product/topic
  // is selected — the chip selection itself is untouched, so filters silently
  // reapply the moment the search box is cleared.
  const isSearching = search.trim().length > 0;

  const filtered = useMemo(
    () => shortcuts.filter((s) =>
      matchesSearch(s) &&
      (isSearching || !activeProduct || s.product === activeProduct) &&
      (isSearching || !activeTopic || s.topic === activeTopic)
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shortcuts, search, activeProduct, activeTopic, isSearching]
  );

  // Pinned & Recent cut across whatever product/topic facet is active (by design —
  // they're a fast-access shortcut area, not a browsing view), but still respect
  // an active search since showing unrelated results while searching would be noisy.
  const pinnedItems = useMemo(
    () => shortcuts.filter((s) => s.pinned && matchesSearch(s)).sort((a, b) => a.title.localeCompare(b.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shortcuts, search]
  );
  const recentItems = useMemo(() => {
    return shortcuts
      .filter((s) => !s.pinned && s.usageCount > 0 && matchesSearch(s))
      .sort((a, b) => {
        const at = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
        const bt = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
        return bt - at;
      })
      .slice(0, RECENT_LIMIT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcuts, search]);

  const handleCopy = async (shortcut: Shortcut, content: string) => {
    await navigator.clipboard.writeText(content);
    setToastMessage('Copied to clipboard');
    const nowIso = new Date().toISOString();
    setShortcuts((prev) => prev.map((s) =>
      s.id === shortcut.id ? { ...s, usageCount: s.usageCount + 1, lastUsedAt: nowIso } : s
    ));
    try {
      await recordShortcutUsage(shortcut.id);
    } catch (e) {
      // The copy itself already succeeded — a failed usage-tracking ping shouldn't
      // surface as an error to the user, just fall out of sync until next refetch.
      console.error(e);
    }
  };

  const handleTogglePin = async (shortcut: Shortcut) => {
    const next = !shortcut.pinned;
    setShortcuts((prev) => prev.map((s) => (s.id === shortcut.id ? { ...s, pinned: next } : s)));
    try {
      await pinShortcut(shortcut.id, next);
    } catch (e) {
      console.error(e);
      fetchShortcuts();
    }
  };

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

  // Reorders against the FULL persisted list (not just the visible subset being
  // dragged), looked up by id — a drag can only ever involve rendered (visible)
  // items, but the resulting order still applies to the whole stored list.
  const handleReorderTags = (kind: ShortcutTagKind, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const key = kind === 'product' ? 'products' : 'topics';
    setTags((prev) => {
      const list = prev[key];
      const oldIndex = list.findIndex((t) => t.id === active.id);
      const newIndex = list.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const reordered = arrayMove(list, oldIndex, newIndex);
      reorderShortcutTags(kind, reordered.map((t) => t.name)).catch((e) => { console.error(e); fetchTags(); });
      return { ...prev, [key]: reordered };
    });
  };

  const handleRecolorTag = async (kind: ShortcutTagKind, tag: ShortcutTag, color: string) => {
    const key = kind === 'product' ? 'products' : 'topics';
    setTags((prev) => ({ ...prev, [key]: prev[key].map((t) => (t.id === tag.id ? { ...t, color } : t)) }));
    try {
      await recolorShortcutTag(kind, tag.name, color);
    } catch (e) {
      console.error(e);
      fetchTags();
    }
  };

  // Renames the tag itself AND every shortcut carrying it. If `to` collides with
  // an existing tag, the server merges them (keeping the target's own color) —
  // fetchTags() afterward picks up that collapse rather than assuming a 1:1 rename.
  const handleRenameTag = async (kind: ShortcutTagKind, tag: ShortcutTag, newName: string) => {
    const key = kind === 'product' ? 'products' : 'topics';
    setTags((prev) => ({ ...prev, [key]: prev[key].map((t) => (t.id === tag.id ? { ...t, name: newName } : t)) }));
    setShortcuts((prev) => prev.map((s) => (s[kind] === tag.name ? { ...s, [kind]: newName } : s)));
    if (kind === 'product' && activeProduct === tag.name) setActiveProduct(newName);
    if (kind === 'topic' && activeTopic === tag.name) setActiveTopic(newName);
    try {
      await renameShortcutTag(kind, tag.name, newName);
      fetchTags();
    } catch (e) {
      console.error(e);
      fetchTags();
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
    try {
      await renameShortcutCategory(from, to);
      fetchShortcuts();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryTarget) return;
    const target = deleteCategoryTarget;
    setDeleteCategoryTarget(null);
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

  const activeProductTag = activeProduct ? tags.products.find((t) => t.name === activeProduct) : undefined;
  const activeTopicTag = activeTopic ? tags.topics.find((t) => t.name === activeTopic) : undefined;
  const headerBarColor = activeProductTag?.color ?? activeTopicTag?.color ?? ALL_COLOR;

  const facetLabel = isSearching
    ? 'Search results'
    : activeProduct && activeTopic
      ? `${activeProduct} · ${activeTopic}`
      : activeProduct || activeTopic || 'All shortcuts';

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
        {/* Subtle colored accent bar reflecting the active facet */}
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
          <div className="flex items-center gap-1">
            {view === 'list' && isAdmin && (
              <button
                onClick={() => setShowManageCategories(true)}
                className="text-ink/40 hover:text-ink transition-colors"
                aria-label="Manage categories"
                title="Manage categories"
              >
                <Settings size={17} />
              </button>
            )}
            <button onClick={closeDrawer} className="text-ink/40 hover:text-ink transition-colors" aria-label="Close">
              <X size={20} />
            </button>
          </div>
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

              {/* Product/Brand facet — drag chips to reorder within this facet only */}
              {visibleProductTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <FacetChip label="All products" active={!activeProduct} color={ALL_COLOR} onClick={() => setActiveProduct(null)} />
                  <DndContext sensors={dndSensors} onDragEnd={(e) => handleReorderTags('product', e)}>
                    <SortableContext items={visibleProductTags.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
                      {visibleProductTags.map((t) => (
                        <SortableFacetChip
                          key={t.id}
                          tag={t}
                          active={activeProduct === t.name}
                          isAdmin={isAdmin}
                          onSelect={() => setActiveProduct(activeProduct === t.name ? null : t.name)}
                          onRename={(newName) => handleRenameTag('product', t, newName)}
                          onRecolor={(newColor) => handleRecolorTag('product', t, newColor)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              )}

              {/* Topic facet — separate DnD context, so dragging never crosses into products */}
              {visibleTopicTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <FacetChip label="All topics" active={!activeTopic} color={ALL_COLOR} onClick={() => setActiveTopic(null)} />
                  <DndContext sensors={dndSensors} onDragEnd={(e) => handleReorderTags('topic', e)}>
                    <SortableContext items={visibleTopicTags.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
                      {visibleTopicTags.map((t) => (
                        <SortableFacetChip
                          key={t.id}
                          tag={t}
                          active={activeTopic === t.name}
                          isAdmin={isAdmin}
                          onSelect={() => setActiveTopic(activeTopic === t.name ? null : t.name)}
                          onRename={(newName) => handleRenameTag('topic', t, newName)}
                          onRecolor={(newColor) => handleRecolorTag('topic', t, newColor)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              )}

              <p className="text-xs font-medium" style={{ color: 'rgba(14,14,14,0.40)' }}>
                {facetLabel} ({filtered.length})
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loading && <div className="flex justify-center py-8"><Spinner /></div>}

              {!loading && (pinnedItems.length > 0 || recentItems.length > 0) && (
                <div className="space-y-3 pb-3" style={{ borderBottom: '1px solid rgba(14,14,14,0.09)' }}>
                  {pinnedItems.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5 px-0.5 flex items-center gap-1.5" style={{ color: 'rgba(14,14,14,0.40)' }}>
                        <Star size={11} strokeWidth={2} fill="currentColor" />
                        Pinned
                      </p>
                      <div className="space-y-1">
                        {pinnedItems.map((s) => (
                          <ShortcutRow
                            key={s.id}
                            shortcut={s}
                            tagColor={tagColorFor(s)}
                            isAdmin={isAdmin}
                            onEdit={() => { setEditing(s); setView('form'); }}
                            onDelete={() => setDeleteTarget(s)}
                            onCopy={(content) => handleCopy(s, content)}
                            onTogglePin={() => handleTogglePin(s)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {recentItems.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5 px-0.5 flex items-center gap-1.5" style={{ color: 'rgba(14,14,14,0.40)' }}>
                        <Clock size={11} strokeWidth={2} />
                        Recent
                      </p>
                      <div className="space-y-1">
                        {recentItems.map((s) => (
                          <ShortcutRow
                            key={s.id}
                            shortcut={s}
                            tagColor={tagColorFor(s)}
                            isAdmin={isAdmin}
                            onEdit={() => { setEditing(s); setView('form'); }}
                            onDelete={() => setDeleteTarget(s)}
                            onCopy={(content) => handleCopy(s, content)}
                            onTogglePin={() => handleTogglePin(s)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!loading && filtered.length === 0 && (
                <EmptyState
                  icon={<ClipboardList size={28} strokeWidth={1.3} />}
                  message={
                    isSearching
                      ? 'No shortcuts match your search'
                      : activeProduct && activeTopic
                        ? `No shortcuts tagged with both "${activeProduct}" and "${activeTopic}" — try clearing one filter.`
                        : 'No shortcuts found'
                  }
                />
              )}
              {!loading && filtered.length > 0 && (
                <div className="space-y-1">
                  {filtered.map((s) => (
                    <ShortcutRow
                      key={s.id}
                      shortcut={s}
                      tagColor={tagColorFor(s)}
                      isAdmin={isAdmin}
                      onEdit={() => { setEditing(s); setView('form'); }}
                      onDelete={() => setDeleteTarget(s)}
                      onCopy={(content) => handleCopy(s, content)}
                      onTogglePin={() => handleTogglePin(s)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* "Copied" toast */}
      <div
        className={`fixed bottom-24 md:bottom-8 right-4 md:right-8 z-[70] px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 transition-all duration-200 ${
          toastMessage ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'
        }`}
        style={{ backgroundColor: '#0E0E0E', color: '#fff' }}
      >
        <Check size={14} />
        {toastMessage}
      </div>

      {/* Rendered before the ConfirmDialogs below so, at equal z-index, DOM order
          puts the delete-category confirmation (triggered from within this modal)
          on top of it rather than hidden behind it. */}
      <ManageCategoriesModal
        open={showManageCategories}
        onClose={() => setShowManageCategories(false)}
        categories={categories}
        shortcuts={shortcuts}
        renamingCategory={renamingCategory}
        renameDraft={renameDraft}
        onRenameDraftChange={setRenameDraft}
        onStartRename={startRenameCategory}
        onCommitRename={commitRenameCategory}
        onCancelRename={() => setRenamingCategory(null)}
        onRequestDelete={setDeleteCategoryTarget}
      />

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

// ─── Facet chip ────────────────────────────────────────────────────────────────

function FacetChip({ label, color, active, onClick }: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 rounded-full text-xs font-medium transition-all"
      style={
        active
          ? { backgroundColor: `${color}26`, color, border: `1px solid ${color}55` }
          : { color: 'rgba(14,14,14,0.45)', backgroundColor: 'rgba(14,14,14,0.05)', border: '1px solid transparent' }
      }
    >
      {label}
    </button>
  );
}

// ─── Sortable, editable facet chip (real product/topic tags) ──────────────────
// Drag reorders within its own facet (the DndContext/SortableContext at the call
// site never mixes products and topics together). Admin-only pencil affordance
// swaps the chip into inline rename + native color-picker mode.

function SortableFacetChip({ tag, active, isAdmin, onSelect, onRename, onRecolor }: {
  tag: ShortcutTag;
  active: boolean;
  isAdmin: boolean;
  onSelect: () => void;
  onRename: (newName: string) => void;
  onRecolor: (newColor: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tag.id });
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(tag.name);

  useEffect(() => {
    if (!editing) setDraftName(tag.name);
  }, [tag.name, editing]);

  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const textColor = textColorForBackground(tag.color);

  const commitRename = () => {
    setEditing(false);
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== tag.name) onRename(trimmed);
    else setDraftName(tag.name);
  };

  if (editing) {
    return (
      <div
        ref={setNodeRef}
        style={{ ...dragStyle, border: `1px solid ${tag.color}55` }}
        className="inline-flex items-center gap-1 px-1.5 py-1 rounded-full"
      >
        <input
          type="color"
          value={tag.color}
          onChange={(e) => onRecolor(e.target.value)}
          className="w-4 h-4 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0"
          title="Change color"
          aria-label={`Change color for ${tag.name}`}
        />
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') { setDraftName(tag.name); setEditing(false); }
          }}
          onBlur={commitRename}
          className="text-xs bg-transparent outline-none w-20"
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={dragStyle} {...attributes} {...listeners} className="group inline-flex items-center rounded-full">
      <button
        onClick={onSelect}
        className="px-2 py-1 rounded-full text-xs font-medium transition-all"
        style={
          active
            ? { backgroundColor: `${tag.color}40`, color: textColor, border: `1px solid ${tag.color}` }
            : { backgroundColor: `${tag.color}20`, color: textColor, border: `1px solid ${tag.color}40` }
        }
      >
        {tag.name}
      </button>
      {isAdmin && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          className="-ml-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
          style={{ color: 'rgba(14,14,14,0.4)' }}
          aria-label={`Edit ${tag.name}`}
          title={`Edit ${tag.name}`}
        >
          <Pencil size={9} />
        </button>
      )}
    </div>
  );
}

// ─── Manage Categories (admin) ─────────────────────────────────────────────────
// The legacy flat category taxonomy still backs the Add/Edit form and the
// product/topic derivation, so renaming/deleting it stays available — just
// relocated out of the main filter UI, which is now facet-driven.

function ManageCategoriesModal({
  open, onClose, categories, shortcuts, renamingCategory, renameDraft,
  onRenameDraftChange, onStartRename, onCommitRename, onCancelRename, onRequestDelete,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  shortcuts: Shortcut[];
  renamingCategory: string | null;
  renameDraft: string;
  onRenameDraftChange: (v: string) => void;
  onStartRename: (cat: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onRequestDelete: (cat: string) => void;
}) {
  if (!open) return null;
  // Not the shared <Modal> (z-50) — this needs to sit above the drawer itself
  // (z-[60]), so it's a matching z-[60] overlay instead; DOM order (rendered
  // before the delete-category ConfirmDialog in the parent) keeps that
  // confirmation visible on top of this when triggered from within it.
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0E0E0E]/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto"
        style={{ border: '1px solid rgba(14,14,14,0.09)' }}
      >
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid rgba(14,14,14,0.09)' }}>
          <h2 className="text-lg font-semibold text-ink">Manage Categories</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-1">
          {categories.length === 0 && (
            <p className="text-sm" style={{ color: 'rgba(14,14,14,0.45)' }}>No categories yet.</p>
          )}
          {categories.map((c) =>
            renamingCategory === c ? (
              <input
                key={c}
                autoFocus
                value={renameDraft}
                onChange={(e) => onRenameDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCommitRename();
                  if (e.key === 'Escape') onCancelRename();
                }}
                onBlur={onCommitRename}
                className="input text-sm py-1.5 px-2 w-full"
              />
            ) : (
              <div key={c} className="group flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-black/[0.02] transition-colors">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hashColor(c) }} />
                <span className="flex-1 min-w-0 truncate text-sm text-ink capitalize">{c}</span>
                <span className="text-xs shrink-0" style={{ color: 'rgba(14,14,14,0.35)' }}>
                  {shortcuts.filter((s) => s.category === c).length}
                </span>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onStartRename(c)} className="p-1 rounded hover:bg-black/5" style={{ color: 'rgba(14,14,14,0.4)' }} aria-label={`Rename ${c}`}>
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => onRequestDelete(c)} className="p-1 rounded hover:bg-red-50 hover:text-red-600" style={{ color: 'rgba(14,14,14,0.4)' }} aria-label={`Delete ${c}`}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Shortcut row (compact list item) ──────────────────────────────────────────

function ShortcutRow({ shortcut, tagColor, isAdmin, onEdit, onDelete, onCopy, onTogglePin }: {
  shortcut: Shortcut;
  tagColor?: string;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: (content: string) => void;
  onTogglePin: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const variants = shortcut.type === 'text' ? effectiveVariants(shortcut) : [];
  const primary = variants[0];
  const previewText = shortcut.type === 'link' ? shortcut.content : (primary?.content ?? '').split('\n')[0];
  const expandable = isExpandable(shortcut);
  const tag = shortcut.product || shortcut.topic;
  const badgeTextColor = tagColor ? textColorForBackground(tagColor) : undefined;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: '1px solid rgba(14,14,14,0.08)', borderLeft: tagColor ? `3px solid ${tagColor}` : undefined }}
    >
      <div
        className={`flex items-center gap-2 px-2.5 py-2 transition-colors hover:bg-black/[0.015] ${expandable ? 'cursor-pointer' : ''}`}
        onClick={() => { if (expandable) setExpanded((v) => !v); }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          className="shrink-0 transition-colors"
          style={{ color: shortcut.pinned ? '#D4A847' : 'rgba(14,14,14,0.25)' }}
          aria-label={shortcut.pinned ? 'Unpin' : 'Pin'}
          title={shortcut.pinned ? 'Unpin' : 'Pin'}
        >
          <Star size={14} fill={shortcut.pinned ? 'currentColor' : 'none'} />
        </button>

        <div className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-ink">{shortcut.title}</span>
          {previewText && <span style={{ color: 'rgba(14,14,14,0.45)' }}>: {previewText}</span>}
        </div>

        {tag && (
          <span
            className="shrink-0 hidden sm:inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={tagColor ? { backgroundColor: `${tagColor}26`, color: badgeTextColor } : undefined}
          >
            {tag}
          </span>
        )}

        {shortcut.type === 'link' ? (
          <a
            href={shortcut.content}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="btn-secondary shrink-0 inline-flex items-center gap-1 text-xs"
          >
            <ExternalLink size={12} />
            Open
          </a>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); if (primary) onCopy(primary.content); }}
            className="btn-secondary shrink-0 inline-flex items-center gap-1 text-xs"
          >
            <Copy size={12} />
            Copy
          </button>
        )}

        {isAdmin && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1 rounded hover:bg-black/5 transition-colors" style={{ color: 'rgba(14,14,14,0.4)' }} aria-label="Edit">
              <Pencil size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 rounded hover:bg-red-50 hover:text-red-600 transition-colors" style={{ color: 'rgba(14,14,14,0.4)' }} aria-label="Delete">
              <Trash2 size={12} />
            </button>
          </div>
        )}

        {expandable && (
          <span className="shrink-0" style={{ color: 'rgba(14,14,14,0.30)' }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        )}
      </div>

      {expanded && shortcut.type === 'text' && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {variants.map((v) => (
            <div key={v.id} className="rounded-lg p-2" style={{ backgroundColor: 'rgba(14,14,14,0.025)' }}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(14,14,14,0.40)' }}>
                  {variants.length > 1 ? v.label : 'Text'}
                </span>
                {variants.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onCopy(v.content); }}
                    className="btn-secondary inline-flex items-center gap-1.5 text-xs shrink-0"
                  >
                    <Copy size={12} />
                    Copy
                  </button>
                )}
              </div>
              <div
                className="shortcut-content text-xs"
                style={{ color: 'rgba(14,14,14,0.55)' }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(v.content) }}
              />
            </div>
          ))}
        </div>
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
