export interface ShortcutVariant {
  id: string;
  label: string;
  content: string;
}

export type ShortcutType = 'text' | 'link';

// 'team' = GET /api/shortcuts (shared, whole team). 'personal' = GET
// /api/personal-shortcuts (private, this signed-in user's own only) — see
// lib/data.ts. Both are normalized to this same shape so the popup's search/
// group/render logic never needs two parallel code paths; `scope` is what
// lets the UI still tell them apart (a small "Personal" badge) and lets
// category-chip browsing correctly skip personal items (they have no
// `category`, only `product`/`topic`).
export type ShortcutScope = 'team' | 'personal';

export interface Shortcut {
  id: string;
  title: string;
  type: ShortcutType;
  content: string;
  variants: ShortcutVariant[];
  category: string;
  product: string;
  topic: string;
  pinned: boolean;
  imageData: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  scope: ShortcutScope;
}

// Raw shape returned by GET/PATCH /api/personal-shortcuts — no `category`
// (personal lists don't have team categories), no createdById/createdByName
// (it's always the caller's own, never shown).
export interface PersonalShortcutRaw {
  id: string;
  userId: string;
  title: string;
  type: ShortcutType;
  content: string;
  variants: ShortcutVariant[];
  product: string;
  topic: string;
  pinned: boolean;
  imageData: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface ShortcutsCache {
  fetchedAt: number;
  shortcuts: Shortcut[];
}
