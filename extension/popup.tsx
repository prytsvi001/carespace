import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Star } from 'lucide-react';
import './popup.css';
import type { AuthUser, Shortcut, ShortcutVariant } from './lib/types';
import {
  clearShortcutsCache,
  fetchAuthUser,
  getCachedShortcuts,
  isCacheFresh,
  pinShortcut,
  refreshShortcutsCache,
  updateCachedShortcut,
} from './lib/data';

const CARESPACE_URL = 'https://carespace.struktura.io';

type NavRow =
  | { kind: 'shortcut'; shortcut: Shortcut }
  | { kind: 'variant'; shortcut: Shortcut; variant: ShortcutVariant };

function rowKey(row: NavRow): string {
  return row.kind === 'shortcut' ? row.shortcut.id : `${row.shortcut.id}:${row.variant.id}`;
}

function matchScore(s: Shortcut, query: string): number {
  const title = s.title.toLowerCase();
  if (title.startsWith(query)) return 3;
  if (title.includes(query)) return 2;
  const haystack = `${s.category} ${s.product} ${s.topic} ${s.content}`.toLowerCase();
  if (haystack.includes(query)) return 1;
  if (s.variants.some((v) => v.label.toLowerCase().includes(query) || v.content.toLowerCase().includes(query))) {
    return 1;
  }
  return 0;
}

function highlightMatch(title: string, query: string): React.ReactNode {
  if (!query) return title;
  const idx = title.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return title;
  return (
    <>
      {title.slice(0, idx)}
      <mark className="bg-accent/50 text-ink rounded-sm px-0.5">{title.slice(idx, idx + query.length)}</mark>
      {title.slice(idx + query.length)}
    </>
  );
}

function expandRows(items: Shortcut[], expandedId: string | null): NavRow[] {
  return items.flatMap((s) => {
    const rows: NavRow[] = [{ kind: 'shortcut', shortcut: s }];
    if (s.type === 'text' && s.variants.length > 1 && expandedId === s.id) {
      rows.push(...s.variants.map((variant) => ({ kind: 'variant' as const, shortcut: s, variant })));
    }
    return rows;
  });
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function Skeleton() {
  return (
    <div className="px-2 py-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-2.5 animate-pulse">
          <div className="w-4 h-4 rounded bg-slate-200 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="h-3 rounded bg-slate-200" style={{ width: `${60 - i * 8}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultRow({
  row,
  query,
  selected,
  previewOpen,
  copied,
  onHover,
  onActivate,
  onTogglePin,
}: {
  row: NavRow;
  query: string;
  selected: boolean;
  previewOpen: boolean;
  copied: boolean;
  onHover: () => void;
  onActivate: () => void;
  onTogglePin?: () => void;
}) {
  const isVariant = row.kind === 'variant';
  const isLink = !isVariant && row.shortcut.type === 'link';
  const icon = isVariant ? '' : row.shortcut.type === 'text' ? '📋' : '🔗';
  const title = isVariant ? row.variant.label : row.shortcut.title;
  const subtitle = isVariant ? null : row.shortcut.category || null;
  const pinned = !isVariant && row.shortcut.pinned;

  const previewText = isVariant ? row.variant.content : row.shortcut.content;

  return (
    <div>
      <div
        onMouseEnter={onHover}
        className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
          selected ? 'bg-accent/25' : 'hover:bg-accent/15'
        } ${isVariant ? 'pl-8' : ''}`}
      >
        {!isVariant && onTogglePin && (
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
            className="shrink-0 transition-colors"
            style={{ color: pinned ? '#D4A847' : 'rgba(14,14,14,0.25)' }}
            aria-label={pinned ? 'Unpin' : 'Pin'}
            title={pinned ? 'Unpin' : 'Pin'}
          >
            <Star size={13} fill={pinned ? 'currentColor' : 'none'} />
          </button>
        )}
        <button onClick={onActivate} className="flex-1 min-w-0 flex items-center gap-2 text-left">
          {icon && <span className="text-sm shrink-0">{icon}</span>}
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-ink truncate">
              {query ? highlightMatch(title, query) : title}
            </span>
            {subtitle && <span className="block text-xs text-slate-400 truncate">{subtitle}</span>}
          </span>
          {copied && <span className="text-xs font-medium shrink-0" style={{ color: '#3ba648' }}>Copied! ✓</span>}
        </button>
      </div>
      {previewOpen && previewText && (
        <div className={`mx-2.5 mb-1.5 px-2.5 py-2 rounded-md bg-slate-50 text-slate-600 ${isVariant ? 'ml-11' : ''}`}>
          <p
            className={`max-h-28 overflow-y-auto whitespace-pre-wrap ${
              isLink ? 'font-mono text-[11px] break-all' : 'text-xs'
            }`}
          >
            {previewText}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            Click again to {isLink ? 'open' : 'copy'}
          </p>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-slate-400">
      {icon} {label}
    </div>
  );
}

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  const [shortcuts, setShortcuts] = useState<Shortcut[] | null>(null);
  const [shortcutsLoading, setShortcutsLoading] = useState(false);
  const [shortcutsError, setShortcutsError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [previewOpenKey, setPreviewOpenKey] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const loadShortcuts = useCallback(async () => {
    const cache = await getCachedShortcuts();
    if (cache && isCacheFresh(cache)) {
      setShortcuts(cache.shortcuts);
      setShortcutsError(false);
      return;
    }
    setShortcutsLoading(true);
    setShortcutsError(false);
    try {
      const fresh = await refreshShortcutsCache();
      setShortcuts(fresh);
    } catch {
      if (cache) {
        setShortcuts(cache.shortcuts); // stale data beats no data
      } else {
        setShortcutsError(true);
      }
    } finally {
      setShortcutsLoading(false);
    }
  }, []);

  // Manual "Refresh" button — drops the cache first so this always hits the
  // API, regardless of how much of the 5-minute TTL is left.
  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await clearShortcutsCache();
      const fresh = await refreshShortcutsCache();
      setShortcuts(fresh);
      setShortcutsError(false);
    } catch {
      setShortcutsError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const init = useCallback(async () => {
    setAuthError(false);
    setAuthChecked(false);
    try {
      const me = await fetchAuthUser();
      setUser(me);
      setAuthChecked(true);
      if (me) await loadShortcuts();
    } catch {
      setAuthError(true);
      setAuthChecked(true);
    }
  }, [loadShortcuts]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [authChecked]);

  const groups = useMemo(() => {
    if (!shortcuts) return null;
    const byPinnedFirst = (a: Shortcut, b: Shortcut) => Number(b.pinned) - Number(a.pinned);
    const trimmed = query.trim();
    if (!trimmed) {
      const templates = shortcuts.filter((s) => s.type === 'text').sort(byPinnedFirst).slice(0, 5);
      const links = shortcuts.filter((s) => s.type === 'link').sort(byPinnedFirst).slice(0, 5);
      return [
        { label: 'TEMPLATES', icon: '📋', items: templates },
        { label: 'SHORTCUTS', icon: '⌨️', items: links },
      ];
    }
    const q = trimmed.toLowerCase();
    const ranked = shortcuts
      .map((s) => ({ s, score: matchScore(s, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || byPinnedFirst(a.s, b.s));
    return [{ label: null, icon: null, items: ranked.map((r) => r.s) }];
  }, [shortcuts, query]);

  const flatRows = useMemo(() => {
    if (!groups) return [];
    return groups.flatMap((g) => expandRows(g.items, expandedId));
  }, [groups, expandedId]);

  useEffect(() => {
    setSelectedIndex(0);
    setPreviewOpenKey(null);
  }, [query, expandedId]);

  useEffect(() => {
    if (selectedIndex >= flatRows.length && flatRows.length > 0) {
      setSelectedIndex(flatRows.length - 1);
    }
  }, [flatRows.length, selectedIndex]);

  const activateRow = useCallback((row: NavRow) => {
    if (row.kind === 'variant') {
      const key = rowKey(row);
      copyToClipboard(row.variant.content);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
      return;
    }
    const s = row.shortcut;
    if (s.type === 'link') {
      chrome.tabs.create({ url: s.content });
      window.close();
      return;
    }
    if (s.variants.length > 1) {
      setExpandedId((cur) => (cur === s.id ? null : s.id));
      return;
    }
    const key = rowKey(row);
    copyToClipboard(s.content);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
  }, []);

  // A row either copies/opens (variant, link, single-variant template) or
  // expands into variant sub-items (multi-variant template parent). Only the
  // former needs a "click reveals text, click again commits" gate for mouse
  // users — expanding is already itself a reveal, nothing to gate.
  const isLeafAction = (row: NavRow) =>
    row.kind === 'variant' || row.shortcut.type === 'link' || row.shortcut.variants.length <= 1;

  const handleRowClick = useCallback(
    (row: NavRow) => {
      if (!isLeafAction(row)) {
        activateRow(row);
        return;
      }
      const key = rowKey(row);
      if (previewOpenKey === key) {
        setPreviewOpenKey(null);
        activateRow(row);
      } else {
        setPreviewOpenKey(key);
      }
    },
    [activateRow, previewOpenKey]
  );

  const handleTogglePin = useCallback((s: Shortcut) => {
    const next = !s.pinned;
    setShortcuts((prev) => prev && prev.map((x) => (x.id === s.id ? { ...x, pinned: next } : x)));
    pinShortcut(s.id, next)
      .then(() => updateCachedShortcut(s.id, { pinned: next }))
      .catch(() => {
        setShortcuts((prev) => prev && prev.map((x) => (x.id === s.id ? { ...x, pinned: !next } : x)));
      });
  }, []);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      window.close();
      return;
    }
    if (!flatRows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatRows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = flatRows[selectedIndex];
      if (row) activateRow(row);
    }
  };

  const openCareSpace = () => {
    chrome.tabs.create({ url: CARESPACE_URL });
    window.close();
  };

  let rowCursor = 0;

  return (
    <div className="flex flex-col h-full bg-white text-ink">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-1.5">
          <img src="/icons/icon48.png" alt="" className="w-4 h-4" />
          <span className="text-sm font-semibold">Quick Actions</span>
        </div>
        {user && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleManualRefresh}
              disabled={refreshing || shortcutsLoading}
              className="text-sm text-slate-400 hover:text-ink transition-colors disabled:opacity-40"
              aria-label="Refresh shortcuts"
              title="Refresh shortcuts"
            >
              <span className={refreshing ? 'inline-block animate-spin' : 'inline-block'}>🔄</span>
            </button>
            <span className="text-xs text-slate-400 truncate max-w-[160px]">{user.name}</span>
          </div>
        )}
      </div>

      {!authChecked ? (
        <div className="flex-1" />
      ) : authError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-slate-500">Could not reach CareSpace — check your connection</p>
          <button
            onClick={init}
            className="text-sm font-medium px-4 py-1.5 rounded-lg text-white"
            style={{ backgroundColor: '#0E0E0E' }}
          >
            Retry
          </button>
        </div>
      ) : !user ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-slate-500">Sign in to CareSpace first</p>
          <button
            onClick={openCareSpace}
            className="text-sm font-medium px-4 py-1.5 rounded-lg text-ink"
            style={{ backgroundColor: '#A1F96E' }}
          >
            Open CareSpace
          </button>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-slate-100 shrink-0">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search shortcuts and templates..."
                className="w-full text-sm rounded-lg border border-slate-200 pl-3 pr-8 py-2 outline-none focus:border-ink"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-ink"
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {shortcutsLoading ? (
              <Skeleton />
            ) : shortcutsError ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
                <p className="text-sm text-slate-500">Could not load shortcuts — check your connection</p>
                <button
                  onClick={loadShortcuts}
                  className="text-sm font-medium px-4 py-1.5 rounded-lg text-white"
                  style={{ backgroundColor: '#0E0E0E' }}
                >
                  Retry
                </button>
              </div>
            ) : groups && flatRows.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-slate-400">
                {query.trim() ? `No results for "${query.trim()}"` : 'No shortcuts yet'}
              </div>
            ) : (
              <div className="px-2 pb-2">
                {groups?.map((group, gi) => {
                  if (group.items.length === 0) return null;
                  const rows = expandRows(group.items, expandedId);
                  const startIndex = rowCursor;
                  rowCursor += rows.length;
                  return (
                    <div key={group.label ?? gi}>
                      {group.label && <SectionHeader icon={group.icon!} label={group.label} />}
                      {rows.map((row, i) => (
                        <ResultRow
                          key={rowKey(row)}
                          row={row}
                          query={query.trim()}
                          selected={startIndex + i === selectedIndex}
                          previewOpen={previewOpenKey === rowKey(row)}
                          copied={copiedKey === rowKey(row)}
                          onHover={() => setSelectedIndex(startIndex + i)}
                          onActivate={() => handleRowClick(row)}
                          onTogglePin={row.kind === 'shortcut' ? () => handleTogglePin(row.shortcut) : undefined}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 shrink-0">
        <button onClick={openCareSpace} className="text-xs font-medium text-ink hover:underline">
          Open CareSpace →
        </button>
        <span className="text-[11px] text-slate-400">↑↓ navigate · Enter to copy · Esc to close</span>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
