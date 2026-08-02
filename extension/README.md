# CareSpace Quick Actions (Chrome Extension)

A Command Palette-style popup for instant, keyboard-driven access to
CareSpace's shared shortcuts and text templates from any tab.

## Install

1. Run `npm run build:extension` from the repo root (or `npm run build` inside `/extension`).
2. Open `chrome://extensions` in Chrome.
3. Enable the **Developer mode** toggle (top right).
4. Click **Load unpacked** → select the `/extension/dist` folder.
5. Pin **CareSpace Quick Actions** to the Chrome toolbar.
6. Click the icon from any tab to open the Command Palette.

You must already be signed in to [carespace.struktura.io](https://carespace.struktura.io)
in this browser — the extension reuses that session, it doesn't have its own
login form. If you're signed out, the popup shows a "Sign in to CareSpace
first" prompt with a button that opens the site.

## Usage

- Type to search across every shortcut/template title, category, and content simultaneously.
- `↑` / `↓` to move the selection, `Enter` to act on it, `Esc` to close the popup.
- Text templates with more than one variant expand into sub-items on
  `Enter`/click — press `Enter` again on a variant to copy it.
- A single-variant template copies straight to the clipboard.
- Link shortcuts open in a new tab immediately.

## Development

```bash
cd extension
npm run dev   # vite build --watch — rebuilds dist/ on save
```

Chrome doesn't hot-reload unpacked extensions automatically: after a rebuild,
go to `chrome://extensions` and click the refresh icon on the extension's
card (and reopen the popup) to pick up the change.

## Notes

- Shortcuts are cached in `chrome.storage.local` for 5 minutes; the popup
  shows cached data instantly and only re-fetches once that expires.
- The extension only ever talks to `https://carespace.struktura.io` (see
  `host_permissions` in `manifest.json`) — there's no separate dev/staging
  target, since a Chrome extension can't be pointed at `localhost` for
  a teammate's non-technical machine.
- Personal (private) shortcuts are intentionally **not** included — this
  extension only surfaces the shared, team-wide shortcut list from
  `GET /api/shortcuts`.
