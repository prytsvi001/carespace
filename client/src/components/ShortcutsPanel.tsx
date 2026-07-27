// client/src/components/ShortcutsPanel.tsx
// The full search/facets/pinned/list/form UI for a shortcuts library, parameterized
// so it can render either the shared "Templates" tab or the private "Shortcuts"
// (personal) tab from one implementation instead of duplicating ~700 lines of
// nearly-identical UI. The two tabs differ in exactly two ways this component
// needs to know about: `facetMode` ('category' for Templates' legacy category ->
// product/topic derivation, vs 'direct' for personal items which assign
// product/topic straight on the form) and `canManage` (Templates: real admin
// role check; personal: always true — the owner always manages their own).
import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, Search, Copy, Check, ExternalLink, Plus, Pencil, Trash2,
  ChevronDown, ChevronUp, Star, Settings, Palette, X,
} from 'lucide-react';
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Shortcut, ShortcutType, ShortcutVariant, ShortcutTag, ShortcutTagKind } from '../types';
import { Spinner, EmptyState, ConfirmDialog, AutoTextarea } from './ui';
import { readPastedImage } from '../utils/imagePaste';

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
}

// Structural shape both Shortcut and PersonalShortcut satisfy — `category` is
// optional since only the shared model has it (personal items assign
// product/topic directly, with no legacy category concept).
export interface ShortcutLike {
  id: string;
  title: string;
  type: ShortcutType;
  content: string;
  variants: ShortcutVariant[];
  category?: string;
  product: string;
  topic: string;
  pinned: boolean;
  imageData: string | null;
}

export interface ShortcutFormInput {
  title: string;
  type: ShortcutType;
  content?: string;
  variants?: { label?: string; content: string }[];
  category?: string;
  product?: string;
  topic?: string;
  imageData?: string | null;
}

export interface ShortcutsPanelApi {
  listItems: () => Promise<ShortcutLike[]>;
  listTags: () => Promise<{ products: ShortcutTag[]; topics: ShortcutTag[] }>;
  createItem: (data: ShortcutFormInput) => Promise<ShortcutLike>;
  updateItem: (id: string, data: ShortcutFormInput) => Promise<ShortcutLike>;
  deleteItem: (id: string) => Promise<void>;
  togglePin: (id: string, pinned: boolean) => Promise<ShortcutLike>;
  reorderTags: (kind: ShortcutTagKind, names: string[]) => Promise<void>;
  recolorTag: (kind: ShortcutTagKind, name: string, color: string) => Promise<void>;
  // Templates (legacy category) only — undefined for the personal tab.
  renameCategory?: (from: string, to: string) => Promise<unknown>;
  deleteCategory?: (name: string) => Promise<unknown>;
}

const ALL_COLOR = '#A1F96E';

const HASH_COLORS = ['#85B7EB', '#97C459', '#F0997B', '#AFA9EC', '#D4A847', '#5DCAA5'];
function hashColor(value: string): string {
  if (!value) return 'rgba(14,14,14,0.25)';
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return HASH_COLORS[hash % HASH_COLORS.length];
}

function textColorForBackground(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linearize = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithInk = (luminance + 0.05) / (0.0044 + 0.05);
  return contrastWithWhite >= contrastWithInk ? '#FFFFFF' : '#0E0E0E';
}

function effectiveVariants(s: ShortcutLike): ShortcutVariant[] {
  if (s.variants.length > 0) return s.variants;
  return [{ id: 'legacy', label: 'Variant 1', content: s.content }];
}

const PREVIEW_CHAR_THRESHOLD = 80;
function isExpandable(shortcut: ShortcutLike): boolean {
  if (shortcut.type === 'link') return false;
  const variants = effectiveVariants(shortcut);
  if (variants.length > 1) return true;
  const content = variants[0]?.content ?? '';
  return content.includes('\n') || content.length > PREVIEW_CHAR_THRESHOLD;
}

export function ShortcutsPanel({ facetMode, canManage, cacheNamespace, api, onToast }: {
  facetMode: 'category' | 'direct';
  canManage: boolean;
  cacheNamespace: 'shared' | 'personal';
  api: ShortcutsPanelApi;
  onToast: (message: string) => void;
}) {
  type View = 'list' | 'form';

  const [view, setView] = useState<View>('list');
  const [items, setItems] = useState<ShortcutLike[]>([]);
  const [tags, setTags] = useState<{ products: ShortcutTag[]; topics: ShortcutTag[] }>({ products: [], topics: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ShortcutLike | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShortcutLike | null>(null);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [showTagSettings, setShowTagSettings] = useState(false);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<string | null>(null);

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const filterStorageKey = `carespace_shortcuts_filters:${cacheNamespace}`;
  const [activeProduct, setActiveProduct] = useState<string | null>(() => {
    try { return JSON.parse(localStorage.getItem(filterStorageKey) ?? '{}').product ?? null; } catch { return null; }
  });
  const [activeTopic, setActiveTopic] = useState<string | null>(() => {
    try { return JSON.parse(localStorage.getItem(filterStorageKey) ?? '{}').topic ?? null; } catch { return null; }
  });

  useEffect(() => {
    localStorage.setItem(filterStorageKey, JSON.stringify({ product: activeProduct, topic: activeTopic }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProduct, activeTopic]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      setItems(await api.listItems());
    } catch {
      // ignore — panel just shows empty state
    } finally {
      setLoading(false);
    }
  };

  const fetchTags = async () => {
    try {
      setTags(await api.listTags());
    } catch {
      // ignore — facet chips just render without persisted order/color until next fetch
    }
  };

  useEffect(() => {
    fetchItems();
    fetchTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Legacy flat categories (facetMode 'category' only) — still what the Add/Edit
  // form writes to on the Templates tab, manageable via Manage Categories.
  const categories = useMemo(() => {
    if (facetMode !== 'category') return [];
    const set = new Set<string>();
    items.forEach((s) => { if (s.category) set.add(s.category); });
    return Array.from(set).sort();
  }, [items, facetMode]);

  const visibleProductTags = useMemo(
    () => tags.products.filter((t) => items.some((s) => s.product === t.name)),
    [tags.products, items]
  );
  const visibleTopicTags = useMemo(
    () => tags.topics.filter((t) => items.some((s) => s.topic === t.name)),
    [tags.topics, items]
  );

  const tagColorFor = (s: ShortcutLike): string | undefined => {
    if (s.product) return tags.products.find((t) => t.name === s.product)?.color;
    if (s.topic) return tags.topics.find((t) => t.name === s.topic)?.color;
    return undefined;
  };

  const matchesSearch = (s: ShortcutLike) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    if (s.title.toLowerCase().includes(q)) return true;
    return effectiveVariants(s).some((v) => v.content.toLowerCase().includes(q));
  };

  // A search always looks across every item, ignoring whatever product/topic is
  // selected — the chip selection itself is untouched, so filters silently
  // reapply the moment the search box is cleared.
  const isSearching = search.trim().length > 0;

  const filtered = useMemo(
    () => items.filter((s) =>
      matchesSearch(s) &&
      (isSearching || !activeProduct || s.product === activeProduct) &&
      (isSearching || !activeTopic || s.topic === activeTopic)
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, search, activeProduct, activeTopic, isSearching]
  );

  const pinnedItems = useMemo(
    () => items.filter((s) => s.pinned && matchesSearch(s)).sort((a, b) => a.title.localeCompare(b.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, search]
  );

  const handleCopy = async (content: string) => {
    await navigator.clipboard.writeText(content);
    onToast('Copied to clipboard');
  };

  const handleTogglePin = async (item: ShortcutLike) => {
    const next = !item.pinned;
    setItems((prev) => prev.map((s) => (s.id === item.id ? { ...s, pinned: next } : s)));
    try {
      await api.togglePin(item.id, next);
    } catch (e) {
      console.error(e);
      fetchItems();
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setItems((prev) => prev.filter((s) => s.id !== target.id));
    try {
      await api.deleteItem(target.id);
    } catch (e) {
      console.error(e);
      fetchItems();
    }
  };

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
      api.reorderTags(kind, reordered.map((t) => t.name)).catch((e) => { console.error(e); fetchTags(); });
      return { ...prev, [key]: reordered };
    });
  };

  const handleSaveTagColors = async (changes: { kind: ShortcutTagKind; name: string; color: string }[]) => {
    for (const change of changes) {
      await api.recolorTag(change.kind, change.name, change.color);
    }
    await fetchTags();
  };

  const startRenameCategory = (cat: string) => {
    setRenamingCategory(cat);
    setRenameDraft(cat);
  };

  const commitRenameCategory = async () => {
    if (!renamingCategory || !api.renameCategory) return;
    const from = renamingCategory;
    const to = renameDraft.trim();
    setRenamingCategory(null);
    if (!to || to === from) return;
    try {
      await api.renameCategory(from, to);
      fetchItems();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryTarget || !api.deleteCategory) return;
    const target = deleteCategoryTarget;
    setDeleteCategoryTarget(null);
    setItems((prev) => prev.filter((s) => s.category !== target));
    try {
      await api.deleteCategory(target);
    } catch (e) {
      console.error(e);
      fetchItems();
    }
  };

  const handleFormSave = async (data: ShortcutFormInput) => {
    if (editing) {
      await api.updateItem(editing.id, data);
    } else {
      await api.createItem(data);
    }
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
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-1 shrink-0 transition-colors duration-200" style={{ backgroundColor: headerBarColor }} />

      {view === 'form' ? (
        <ShortcutForm
          initial={editing}
          facetMode={facetMode}
          categories={categories}
          productSuggestions={tags.products.map((t) => t.name)}
          topicSuggestions={tags.topics.map((t) => t.name)}
          onCancel={() => setView('list')}
          onSave={handleFormSave}
          onSaved={() => { setView('list'); fetchItems(); fetchTags(); }}
        />
      ) : (
        <>
          <div className="p-4 space-y-3 shrink-0" style={{ borderBottom: '1px solid rgba(14,14,14,0.09)' }}>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(14,14,14,0.35)' }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search shortcuts..."
                  className="input pl-8 text-sm"
                />
              </div>
              {canManage && facetMode === 'category' && (
                <button
                  onClick={() => setShowManageCategories(true)}
                  className="shrink-0 p-2 rounded-lg hover:bg-black/5 transition-colors"
                  style={{ color: 'rgba(14,14,14,0.45)' }}
                  aria-label="Manage categories"
                  title="Manage categories"
                >
                  <Settings size={16} />
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => setShowTagSettings(true)}
                  className="shrink-0 p-2 rounded-lg hover:bg-black/5 transition-colors"
                  style={{ color: 'rgba(14,14,14,0.45)' }}
                  aria-label="Tag colors"
                  title="Tag colors"
                >
                  <Palette size={16} />
                </button>
              )}
            </div>

            <button
              onClick={() => { setEditing(null); setView('form'); }}
              className="btn-accent w-full flex items-center justify-center gap-1.5"
            >
              <Plus size={14} strokeWidth={2} />
              Add Shortcut
            </button>

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
                        onSelect={() => setActiveProduct(activeProduct === t.name ? null : t.name)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            )}

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
                        onSelect={() => setActiveTopic(activeTopic === t.name ? null : t.name)}
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

            {!loading && pinnedItems.length > 0 && (
              <div className="space-y-1.5 pb-3" style={{ borderBottom: '1px solid rgba(14,14,14,0.09)' }}>
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
                      canManage={canManage}
                      onEdit={() => { setEditing(s); setView('form'); }}
                      onDelete={() => setDeleteTarget(s)}
                      onCopy={handleCopy}
                      onTogglePin={() => handleTogglePin(s)}
                    />
                  ))}
                </div>
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
                    canManage={canManage}
                    onEdit={() => { setEditing(s); setView('form'); }}
                    onDelete={() => setDeleteTarget(s)}
                    onCopy={handleCopy}
                    onTogglePin={() => handleTogglePin(s)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {facetMode === 'category' && (
        <ManageCategoriesModal
          open={showManageCategories}
          onClose={() => setShowManageCategories(false)}
          categories={categories}
          items={items}
          renamingCategory={renamingCategory}
          renameDraft={renameDraft}
          onRenameDraftChange={setRenameDraft}
          onStartRename={startRenameCategory}
          onCommitRename={commitRenameCategory}
          onCancelRename={() => setRenamingCategory(null)}
          onRequestDelete={setDeleteCategoryTarget}
        />
      )}

      <TagSettingsModal
        open={showTagSettings}
        onClose={() => setShowTagSettings(false)}
        products={tags.products}
        topics={tags.topics}
        onSave={handleSaveTagColors}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        message={`Delete "${deleteTarget?.title}"? This can't be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {facetMode === 'category' && (
        <ConfirmDialog
          open={!!deleteCategoryTarget}
          message={`Delete category "${deleteCategoryTarget}" and all ${
            deleteCategoryTarget ? items.filter((s) => s.category === deleteCategoryTarget).length : 0
          } shortcut(s) in it? This can't be undone.`}
          onConfirm={handleDeleteCategory}
          onCancel={() => setDeleteCategoryTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Facet chip (the static "All products"/"All topics" pseudo-filter) ────────

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

// ─── Sortable facet chip (real product/topic tags) ─────────────────────────────
// Click toggles the filter, drag reorders within its own facet (the
// DndContext/SortableContext at the call site never mixes products and
// topics). No inline rename/recolor — that moved to TagSettingsModal.

function SortableFacetChip({ tag, active, onSelect }: {
  tag: ShortcutTag;
  active: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tag.id });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const textColor = textColorForBackground(tag.color);

  return (
    <button
      ref={setNodeRef}
      style={{
        ...dragStyle,
        ...(active
          ? { backgroundColor: `${tag.color}40`, color: textColor, border: `1px solid ${tag.color}` }
          : { backgroundColor: `${tag.color}20`, color: textColor, border: `1px solid ${tag.color}40` }),
      }}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      className="px-2 py-1 rounded-full text-xs font-medium transition-all"
    >
      {tag.name}
    </button>
  );
}

// ─── Tag colors settings (gear/palette-accessible, canManage-gated) ────────────

function TagSettingsModal({ open, onClose, products, topics, onSave }: {
  open: boolean;
  onClose: () => void;
  products: ShortcutTag[];
  topics: ShortcutTag[];
  onSave: (changes: { kind: ShortcutTagKind; name: string; color: string }[]) => Promise<void>;
}) {
  const [draftColors, setDraftColors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    [...products, ...topics].forEach((t) => { initial[t.id] = t.color; });
    setDraftColors(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    const changes: { kind: ShortcutTagKind; name: string; color: string }[] = [];
    [...products, ...topics].forEach((t) => {
      const draft = draftColors[t.id];
      if (draft && draft !== t.color) changes.push({ kind: t.kind, name: t.name, color: draft });
    });
    setSaving(true);
    try {
      await onSave(changes);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (t: ShortcutTag) => (
    <div key={t.id} className="flex items-center gap-2 px-1 py-1.5">
      <input
        type="color"
        value={draftColors[t.id] ?? t.color}
        onChange={(e) => setDraftColors((prev) => ({ ...prev, [t.id]: e.target.value }))}
        className="w-6 h-6 rounded cursor-pointer border-0 p-0 shrink-0 bg-transparent"
        aria-label={`Color for ${t.name}`}
      />
      <span className="text-sm text-ink truncate">{t.name}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0E0E0E]/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto"
        style={{ border: '1px solid rgba(14,14,14,0.09)' }}
      >
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid rgba(14,14,14,0.09)' }}>
          <h2 className="text-lg font-semibold text-ink">Tag Colors</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {products.length === 0 && topics.length === 0 && (
            <p className="text-sm" style={{ color: 'rgba(14,14,14,0.45)' }}>No tags yet.</p>
          )}
          {products.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'rgba(14,14,14,0.40)' }}>Products</p>
              <div className="space-y-0.5">{products.map(renderRow)}</div>
            </div>
          )}
          {topics.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'rgba(14,14,14,0.40)' }}>Topics</p>
              <div className="space-y-0.5">{topics.map(renderRow)}</div>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-accent flex-1">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Manage Categories (legacy, Templates-only, admin/canManage-gated) ─────────

function ManageCategoriesModal({
  open, onClose, categories, items, renamingCategory, renameDraft,
  onRenameDraftChange, onStartRename, onCommitRename, onCancelRename, onRequestDelete,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  items: ShortcutLike[];
  renamingCategory: string | null;
  renameDraft: string;
  onRenameDraftChange: (v: string) => void;
  onStartRename: (cat: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onRequestDelete: (cat: string) => void;
}) {
  if (!open) return null;
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
                  {items.filter((s) => s.category === c).length}
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

function ShortcutRow({ shortcut, tagColor, canManage, onEdit, onDelete, onCopy, onTogglePin }: {
  shortcut: ShortcutLike;
  tagColor?: string;
  canManage: boolean;
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

        {canManage && (
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
          {shortcut.imageData && (
            <img src={shortcut.imageData} alt="" className="max-h-40 rounded-lg" style={{ border: '1px solid rgba(14,14,14,0.08)' }} />
          )}
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
  initial, facetMode, categories, productSuggestions, topicSuggestions, onCancel, onSave, onSaved,
}: {
  initial: ShortcutLike | null;
  facetMode: 'category' | 'direct';
  categories: string[];
  productSuggestions: string[];
  topicSuggestions: string[];
  onCancel: () => void;
  onSave: (data: ShortcutFormInput) => Promise<unknown>;
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
  const [product, setProduct] = useState(initial?.product ?? '');
  const [topic, setTopic] = useState(initial?.topic ?? '');
  const [imageData, setImageData] = useState<string | null>(initial?.imageData ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addVariant = () => setVariants((prev) => [...prev, { label: `Variant ${prev.length + 1}`, content: '' }]);
  const removeVariant = (index: number) => setVariants((prev) => prev.filter((_, i) => i !== index));
  const updateVariant = (index: number, patch: Partial<DraftVariant>) =>
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  const handlePaste = async (e: React.ClipboardEvent<HTMLFormElement>) => {
    const pasted = await readPastedImage(e);
    if (pasted) setImageData(pasted);
  };

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
      const data: ShortcutFormInput = {
        title: title.trim(),
        type,
        imageData,
        ...(type === 'link'
          ? { content: linkContent.trim() }
          : { variants: variants.filter((v) => v.content.trim()).map((v) => ({ label: v.label.trim(), content: v.content.trim() })) }),
        ...(facetMode === 'category' ? { category: category.trim() } : { product: product.trim(), topic: topic.trim() }),
      };
      await onSave(data);
      onSaved();
    } catch {
      setError('Failed to save shortcut');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} onPaste={handlePaste} className="flex-1 overflow-y-auto p-4 space-y-4">
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

      {facetMode === 'category' ? (
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
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Product</label>
            <input
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="Optional"
              list="personal-shortcut-products"
              className="input"
            />
            <datalist id="personal-shortcut-products">
              {productSuggestions.map((p) => <option key={p} value={p} />)}
            </datalist>
          </div>
          <div>
            <label className="label">Topic</label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Optional"
              list="personal-shortcut-topics"
              className="input"
            />
            <datalist id="personal-shortcut-topics">
              {topicSuggestions.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
        </div>
      )}

      <div>
        <label className="label">Image</label>
        <p className="text-xs mb-2" style={{ color: 'rgba(14,14,14,0.40)' }}>Paste a screenshot anywhere in this form (Ctrl+V)</p>
        {imageData ? (
          <div className="relative inline-block">
            <img src={imageData} alt="Pasted preview" className="max-h-32 rounded-lg" style={{ border: '1px solid rgba(14,14,14,0.10)' }} />
            <button
              type="button"
              onClick={() => setImageData(null)}
              className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow"
              style={{ border: '1px solid rgba(14,14,14,0.10)' }}
              aria-label="Remove image"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <p className="text-xs italic" style={{ color: 'rgba(14,14,14,0.30)' }}>No image attached</p>
        )}
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
