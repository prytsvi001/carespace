export interface ShortcutVariant {
  id: string;
  label: string;
  content: string;
}

export type ShortcutType = 'text' | 'link';

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
