// Warms the shortcuts cache right after install/update so the very first
// popup open has something to show instantly instead of a cold fetch.
// Every subsequent open is driven by popup.tsx's own TTL check — this is
// just a head start, not the source of truth for freshness.
import { fetchAuthUser, refreshShortcutsCache } from './lib/data';

chrome.runtime.onInstalled.addListener(() => {
  fetchAuthUser()
    .then((user) => (user ? refreshShortcutsCache() : null))
    .catch(() => {
      // Silent — popup.tsx will surface any real error to the user on open.
    });
});
