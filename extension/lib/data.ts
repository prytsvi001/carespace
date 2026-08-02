import type { AuthUser, Shortcut, ShortcutsCache } from './types';

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
  return res.json();
}

export async function getCachedShortcuts(): Promise<ShortcutsCache | null> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  return (stored[CACHE_KEY] as ShortcutsCache | undefined) ?? null;
}

export function isCacheFresh(cache: ShortcutsCache | null): boolean {
  return !!cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}

export async function refreshShortcutsCache(): Promise<Shortcut[]> {
  const shortcuts = await fetchShortcuts();
  const cache: ShortcutsCache = { fetchedAt: Date.now(), shortcuts };
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
  return shortcuts;
}
