import type { AuthUser, PersonalShortcutRaw, Shortcut, ShortcutsCache } from './types';

export const API_BASE = 'https://carespace.struktura.io/api';
export const CACHE_TTL_MS = 5 * 60_000;
const CACHE_KEY = 'shortcutsCache';

// The extension has host_permissions for carespace.struktura.io, so these
// fetches bypass CORS entirely — but the session cookie is still only sent
// if the server marks it SameSite=None (cross-site request from a
// chrome-extension:// origin), which server/src/app.ts sets in production.
export async function fetchAuthUser(): Promise<AuthUser | null> {
  const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`auth/me failed: ${res.status}`);
  return res.json();
}

export async function fetchShortcuts(): Promise<Shortcut[]> {
  const res = await fetch(`${API_BASE}/shortcuts`, { credentials: 'include' });
  if (!res.ok) throw new Error(`shortcuts failed: ${res.status}`);
  const raw: Omit<Shortcut, 'scope'>[] = await res.json();
  return raw.map((s) => ({ ...s, scope: 'team' as const }));
}

// GET /api/personal-shortcuts is already scoped server-side to the caller's
// own userId — never another agent's items — so surfacing it here doesn't
// cross the privacy boundary the README used to describe; it's still only
// ever "your own" data, just now also reachable from the popup.
function personalToShortcut(p: PersonalShortcutRaw): Shortcut {
  return {
    id: p.id,
    title: p.title,
    type: p.type,
    content: p.content,
    variants: p.variants,
    category: '', // personal lists have no team category, only product/topic
    product: p.product,
    topic: p.topic,
    pinned: p.pinned,
    imageData: p.imageData,
    createdById: p.userId,
    createdByName: null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    scope: 'personal',
  };
}

export async function fetchPersonalShortcuts(): Promise<Shortcut[]> {
  const res = await fetch(`${API_BASE}/personal-shortcuts`, { credentials: 'include' });
  if (!res.ok) throw new Error(`personal-shortcuts failed: ${res.status}`);
  const raw: PersonalShortcutRaw[] = await res.json();
  return raw.map(personalToShortcut);
}

export async function getCachedShortcuts(): Promise<ShortcutsCache | null> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  return (stored[CACHE_KEY] as ShortcutsCache | undefined) ?? null;
}

export function isCacheFresh(cache: ShortcutsCache | null): boolean {
  return !!cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}

// Team shortcuts are the primary list — a failure there surfaces as a real
// error same as before. Personal shortcuts are additive: if that fetch fails
// (network hiccup, etc.) the popup still works with team-only results rather
// than failing the whole refresh over a secondary source.
export async function refreshShortcutsCache(): Promise<Shortcut[]> {
  const [team, personal] = await Promise.all([
    fetchShortcuts(),
    fetchPersonalShortcuts().catch((e) => { console.error('personal-shortcuts fetch failed:', e); return []; }),
  ]);
  const shortcuts = [...team, ...personal];
  const cache: ShortcutsCache = { fetchedAt: Date.now(), shortcuts };
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
  return shortcuts;
}

// Backs the popup's manual Refresh button — drops the cache entirely (not
// just re-fetching over it) so a stale entry can never be served even if the
// following fetch fails; the caller falls back to refreshShortcutsCache().
export async function clearShortcutsCache(): Promise<void> {
  await chrome.storage.local.remove(CACHE_KEY);
}

export async function pinShortcut(id: string, pinned: boolean): Promise<Shortcut> {
  const res = await fetch(`${API_BASE}/shortcuts/${id}/pin`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  });
  if (!res.ok) throw new Error(`pin failed: ${res.status}`);
  const data: Omit<Shortcut, 'scope'> = await res.json();
  return { ...data, scope: 'team' };
}

export async function pinPersonalShortcut(id: string, pinned: boolean): Promise<Shortcut> {
  const res = await fetch(`${API_BASE}/personal-shortcuts/${id}/pin`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  });
  if (!res.ok) throw new Error(`pin failed: ${res.status}`);
  const data: PersonalShortcutRaw = await res.json();
  return personalToShortcut(data);
}

// Keeps the cache in sync with an optimistic pin toggle so the next popup
// open (even before the 5-minute TTL is up) reflects it instead of
// flashing back to the pre-toggle state.
export async function updateCachedShortcut(id: string, patch: Partial<Shortcut>): Promise<void> {
  const cache = await getCachedShortcuts();
  if (!cache) return;
  const shortcuts = cache.shortcuts.map((s) => (s.id === id ? { ...s, ...patch } : s));
  await chrome.storage.local.set({ [CACHE_KEY]: { ...cache, shortcuts } });
}
