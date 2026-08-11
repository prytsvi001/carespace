// client/src/components/ShortcutsDrawer.tsx
// Floating "Quick Actions" button + slide-in drawer, mounted once at the app
// root so it stays visible across every tab. Holds two tabs — Templates (the
// shared, team-wide library) and Shortcuts (private, per-agent) — each
// rendered through the one shared ShortcutsPanel implementation. Self-
// contained: hides itself entirely for peek_handler users.
import React, { useEffect, useState } from 'react';
import { ClipboardList, X, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getShortcuts, createShortcut, updateShortcut, deleteShortcut,
  renameShortcutCategory, deleteShortcutCategory, pinShortcut,
  getShortcutTags, reorderShortcutTags, recolorShortcutTag,
  getPersonalShortcuts, createPersonalShortcut, updatePersonalShortcut, deletePersonalShortcut,
  pinPersonalShortcut, getPersonalShortcutTags, reorderPersonalShortcutTags, recolorPersonalShortcutTag,
  bulkImportVictoriaTemplates,
} from '../api';
import { ShortcutsPanel, ShortcutsPanelApi } from './ShortcutsPanel';

// One-off banner (see personalShortcuts.ts's bulk-import-victoria-templates
// route) — only ever shown to that one account, since the templates are
// hers. Remove this + the API call + the server route once the import is
// confirmed; it has no ongoing purpose.
const VICTORIA_BULK_IMPORT_EMAIL = 'victoria_pryts@struktura.io';

function BulkImportBanner({ onToast }: { onToast: (msg: string) => void }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [summary, setSummary] = useState<{ created: number; skipped: number; total: number } | null>(null);

  if (status === 'done') {
    return (
      <div className="mx-4 mt-3 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: 'rgba(161,249,110,0.15)', color: 'rgba(14,14,14,0.65)' }}>
        ✓ Imported {summary?.created} new template{summary?.created === 1 ? '' : 's'}
        {summary && summary.skipped > 0 ? ` (${summary.skipped} already present, skipped)` : ''}.
      </div>
    );
  }

  return (
    <div className="mx-4 mt-3 flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(14,14,14,0.04)' }}>
      <span className="text-xs text-slate-500">Import your 101 email templates from the shared CSV?</span>
      <button
        type="button"
        disabled={status === 'running'}
        onClick={async () => {
          setStatus('running');
          try {
            const result = await bulkImportVictoriaTemplates();
            setSummary(result);
            setStatus('done');
            onToast(`Imported ${result.created} template${result.created === 1 ? '' : 's'}`);
          } catch (e) {
            console.error(e);
            setStatus('error');
          }
        }}
        className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors hover:brightness-95 disabled:opacity-50"
        style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
      >
        {status === 'running' ? 'Importing…' : status === 'error' ? 'Retry import' : 'Import'}
      </button>
    </div>
  );
}

type DrawerTab = 'templates' | 'personal';

const templatesApi: ShortcutsPanelApi = {
  listItems: getShortcuts,
  listTags: getShortcutTags,
  createItem: createShortcut,
  updateItem: updateShortcut,
  deleteItem: deleteShortcut,
  togglePin: pinShortcut,
  reorderTags: reorderShortcutTags,
  recolorTag: recolorShortcutTag,
  renameCategory: renameShortcutCategory,
  deleteCategory: deleteShortcutCategory,
};

const personalApi: ShortcutsPanelApi = {
  listItems: getPersonalShortcuts,
  listTags: getPersonalShortcutTags,
  createItem: createPersonalShortcut,
  updateItem: updatePersonalShortcut,
  deleteItem: deletePersonalShortcut,
  togglePin: pinPersonalShortcut,
  reorderTags: reorderPersonalShortcutTags,
  recolorTag: recolorPersonalShortcutTag,
};

export function ShortcutsDrawer() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'head' || user?.role === 'lead';

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DrawerTab>('templates');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 2000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // peek_handler users never see the button at all
  if (user?.role === 'peek_handler') return null;

  const closeDrawer = () => setOpen(false);

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-50 flex items-center gap-2 pl-3 pr-4 py-3 rounded-full shadow-lg font-semibold text-sm transition-transform hover:scale-105"
        style={{ backgroundColor: '#A1F96E', color: '#0E0E0E', border: '1px solid rgba(14,14,14,0.14)' }}
        aria-label="Quick Actions"
      >
        <ClipboardList size={18} strokeWidth={1.8} />
        <span className="hidden sm:inline">Quick Actions</span>
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
        <div className="flex items-center justify-between p-4 shrink-0" style={{ borderBottom: '1px solid rgba(14,14,14,0.09)' }}>
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <ClipboardList size={18} strokeWidth={1.8} />
            Quick Actions
          </h2>
          <button onClick={closeDrawer} className="text-ink/40 hover:text-ink transition-colors" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="flex gap-1 p-1 mx-4 mt-3 rounded-lg shrink-0" style={{ backgroundColor: 'rgba(14,14,14,0.06)' }}>
          <button
            onClick={() => setTab('templates')}
            className="flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
            style={
              tab === 'templates'
                ? { backgroundColor: '#fff', color: '#0E0E0E', boxShadow: '0 1px 2px rgba(14,14,14,0.08)' }
                : { color: 'rgba(14,14,14,0.45)' }
            }
          >
            Templates
          </button>
          <button
            onClick={() => setTab('personal')}
            className="flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
            style={
              tab === 'personal'
                ? { backgroundColor: '#fff', color: '#0E0E0E', boxShadow: '0 1px 2px rgba(14,14,14,0.08)' }
                : { color: 'rgba(14,14,14,0.45)' }
            }
          >
            Shortcuts
          </button>
        </div>

        {tab === 'templates' ? (
          <ShortcutsPanel
            key="templates"
            facetMode="category"
            canManage={isAdmin}
            cacheNamespace="shared"
            api={templatesApi}
            onToast={setToastMessage}
          />
        ) : (
          <>
            {user?.email === VICTORIA_BULK_IMPORT_EMAIL && <BulkImportBanner onToast={setToastMessage} />}
            <ShortcutsPanel
              key="personal"
              facetMode="direct"
              canManage
              cacheNamespace="personal"
              api={personalApi}
              onToast={setToastMessage}
            />
          </>
        )}
      </div>

      {/* "Copied" toast — a sibling of the drawer panel, not nested inside it:
          the panel sits under a `transition-transform`, which creates a new CSS
          containing block for `position:fixed` descendants, so a toast rendered
          inside it would be positioned relative to the (possibly off-screen)
          drawer instead of the viewport. */}
      <div
        className={`fixed bottom-24 md:bottom-8 right-4 md:right-8 z-[70] px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 transition-all duration-200 ${
          toastMessage ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'
        }`}
        style={{ backgroundColor: '#0E0E0E', color: '#fff' }}
      >
        <Check size={14} />
        {toastMessage}
      </div>
    </>
  );
}
