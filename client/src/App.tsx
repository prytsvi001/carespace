// client/src/App.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  ClipboardList, CalendarDays, Lightbulb, Bot, ChartBar,
  ListTodo, Star, TrendingUp, FileText, LogOut, User,
  ChevronDown, Bell, BarChart3, Send, CheckCircle2,
} from 'lucide-react';

import { AuthProvider, useAuth } from './context/AuthContext';
import { Modal } from './components/ui';
import { getTelegramLinkCode, getTelegramStatus } from './api';
import Login from './pages/Login';
import DailyLog from './pages/DailyLog';
import Statistics from './pages/Statistics';
import ShiftCalendar from './pages/ShiftCalendar';
import AIChatQA from './pages/AIChatQA';
import PeakRequests from './pages/PeakRequests';
import MyPlans from './pages/MyPlans';
import Inbox from './pages/Inbox';
import Reviews from './pages/Reviews';
import PDP from './pages/PDP';
import QAReports from './pages/QAReports';
import MyKPI from './pages/MyKPI';
import { ShortcutsDrawer } from './components/ShortcutsDrawer';
import { getUnreadCount, getNewRequestsCount } from './api';

// ── Tab types ────────────────────────────────────────────────────────────────

type SharedTab = 'daily' | 'calendar' | 'requests' | 'qa' | 'stats';
type SpaceTab  = 'plans' | 'inbox' | 'reviews' | 'pdp' | 'qa-reports' | 'kpi';
type Tab = SharedTab | SpaceTab;

const SHARED_TAB_IDS = new Set<Tab>(['daily', 'calendar', 'requests', 'qa', 'stats', 'inbox']);

const SHARED_TABS: { id: SharedTab; label: string; shortLabel: string; Icon: React.ElementType }[] = [
  { id: 'daily',    label: 'Daily Log',      shortLabel: 'Log',      Icon: ClipboardList },
  { id: 'calendar', label: 'Shift Calendar', shortLabel: 'Calendar', Icon: CalendarDays },
  { id: 'requests', label: 'Peek Requests',  shortLabel: 'Peek',     Icon: Lightbulb },
  { id: 'qa',       label: 'AI Chats QA',   shortLabel: 'QA',       Icon: Bot },
  { id: 'stats',    label: 'Statistics',     shortLabel: 'Stats',    Icon: ChartBar },
];

// qa-reports is only visible to head and lead roles
const ALL_SPACE_TABS: { id: SpaceTab; label: string; shortLabel: string; Icon: React.ElementType; roles: string[] }[] = [
  { id: 'plans',      label: 'My Plans',   shortLabel: 'Plans',   Icon: ListTodo,   roles: ['head', 'lead', 'agent'] },
  { id: 'reviews',    label: 'Reviews',    shortLabel: 'Reviews', Icon: Star,       roles: ['head', 'lead', 'agent'] },
  { id: 'pdp',        label: 'PDP',        shortLabel: 'PDP',     Icon: TrendingUp, roles: ['head', 'lead', 'agent'] },
  { id: 'qa-reports', label: 'QA Reports', shortLabel: 'Reports', Icon: FileText,   roles: ['head', 'lead'] },
  { id: 'kpi',        label: 'My KPI',     shortLabel: 'KPI',     Icon: BarChart3,  roles: ['head', 'lead', 'agent'] },
];

// Tabs accessible to peek_handler role
const PEEK_HANDLER_TABS = new Set<SharedTab>(['requests', 'calendar']);

const ACTIVE_TAB_STORAGE_KEY = 'carespace_active_tab';

// Restores the last tab from localStorage on refresh, falling back to the
// default if there's nothing stored or the stored tab isn't valid for this role
function getInitialTab(userRole: string): Tab {
  const isPeekHandler = userRole === 'peek_handler';
  const fallback: Tab = isPeekHandler ? 'requests' : 'daily';
  const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) as Tab | null;
  if (!stored) return fallback;

  if (isPeekHandler) {
    return PEEK_HANDLER_TABS.has(stored as SharedTab) ? stored : fallback;
  }

  const validSpaceTabIds = new Set(ALL_SPACE_TABS.filter((t) => t.roles.includes(userRole)).map((t) => t.id));
  if (SHARED_TAB_IDS.has(stored) || validSpaceTabIds.has(stored as SpaceTab)) return stored;
  return fallback;
}

// ── Main authenticated app ───────────────────────────────────────────────────

function MainApp() {
  const { user, logout } = useAuth();

  const userRole = user?.role ?? 'agent';
  const isPeekHandler = userRole === 'peek_handler';

  const [activeTab, setActiveTab] = useState<Tab>(() => getInitialTab(userRole));

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);
  const [statsYear, setStatsYear] = useState(new Date().getFullYear());
  const [statsMonth, setStatsMonth] = useState(new Date().getMonth() + 1);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSpaceMenu, setShowSpaceMenu] = useState(false);
  const [showTelegramModal, setShowTelegramModal] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(!!user?.telegramChatId);

  useEffect(() => { setTelegramConnected(!!user?.telegramChatId); }, [user?.telegramChatId]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [newRequestsCount, setNewRequestsCount] = useState(0);
  const [dismissedRequestsCount, setDismissedRequestsCount] = useState<number>(() => {
    if (!user?.id) return 0;
    const stored = localStorage.getItem(`peek_dismissed_${user.id}`);
    return stored ? parseInt(stored, 10) : 0;
  });

  const newRequestsBadge = Math.max(0, newRequestsCount - dismissedRequestsCount);

  const inSpace = !SHARED_TAB_IDS.has(activeTab);
  const spaceTabsForRole = ALL_SPACE_TABS.filter((t) => t.roles.includes(userRole));
  const visibleSharedTabs = isPeekHandler
    ? SHARED_TABS.filter((t) => PEEK_HANDLER_TABS.has(t.id))
    : SHARED_TABS;

  // Keep dismissedCount in sync when newRequestsCount drops below it
  // (e.g. a request was processed), so the next new request shows a badge
  useEffect(() => {
    if (newRequestsCount < dismissedRequestsCount) {
      setDismissedRequestsCount(newRequestsCount);
      if (user?.id) {
        localStorage.setItem(`peek_dismissed_${user.id}`, String(newRequestsCount));
      }
    }
  }, [newRequestsCount, dismissedRequestsCount, user?.id]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await getUnreadCount();
      setUnreadCount(data.count);
    } catch {
      setUnreadCount(0);
    }
  }, []);

  const fetchNewRequestsCount = useCallback(async () => {
    try {
      const data = await getNewRequestsCount();
      setNewRequestsCount(data.count);
    } catch {
      // ignore network errors silently
    }
  }, []);

  useEffect(() => { fetchUnreadCount(); }, [fetchUnreadCount]);

  useEffect(() => {
    fetchNewRequestsCount();
    const id = setInterval(fetchNewRequestsCount, 30_000);
    return () => clearInterval(id);
  }, [fetchNewRequestsCount]);

  const handleRequestsTabClick = useCallback(() => {
    setActiveTab('requests');
    setDismissedRequestsCount(newRequestsCount);
    if (user?.id) {
      localStorage.setItem(`peek_dismissed_${user.id}`, String(newRequestsCount));
    }
  }, [newRequestsCount, user?.id]);

  const syncStatsMonth = useCallback((year: number, month: number) => {
    setStatsYear(year); setStatsMonth(month);
  }, []);
  const notifyStatsRefresh = useCallback(() => setStatsRefreshKey((k) => k + 1), []);

  const userInitial = user?.name?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Top header ── */}
      <header
        className="bg-white sticky top-0 z-40"
        style={{ borderBottom: '1px solid rgba(14,14,14,0.09)' }}
      >
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14 gap-2">

            {/* Logo */}
            <div className="flex items-center gap-2 shrink-0">
              <img src="/logo.png" alt="CareSpace" className="h-7 w-7 object-contain" />
              <span className="font-bold text-ink text-lg hidden sm:block">CareSpace</span>
              <span className="text-xs hidden sm:block" style={{ color: 'rgba(14,14,14,0.40)' }}>
                struktura
              </span>
            </div>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-0.5 flex-1 justify-center">
              {visibleSharedTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => tab.id === 'requests' ? handleRequestsTabClick() : setActiveTab(tab.id)}
                  className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={
                    activeTab === tab.id
                      ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
                      : { color: 'rgba(14,14,14,0.40)' }
                  }
                >
                  <tab.Icon size={14} strokeWidth={1.6} />
                  <span>{tab.label}</span>
                  {tab.id === 'requests' && newRequestsBadge > 0 && (
                    <span
                      className="flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold rounded-full"
                      style={{ backgroundColor: '#ef4444', color: '#fff' }}
                    >
                      {newRequestsBadge > 99 ? '99+' : newRequestsBadge}
                    </span>
                  )}
                </button>
              ))}

              {/* My Space dropdown — hidden for peek_handler */}
              {!isPeekHandler && (
                <div className="relative ml-1">
                  <button
                    onClick={() => { setShowSpaceMenu((v) => !v); setShowUserMenu(false); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all"
                    style={
                      inSpace || showSpaceMenu
                        ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
                        : { color: 'rgba(14,14,14,0.40)' }
                    }
                  >
                    <User size={14} strokeWidth={1.6} />
                    <span>My Space</span>
                    <ChevronDown size={12} strokeWidth={1.8} />
                  </button>

                  {showSpaceMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowSpaceMenu(false)} />
                      <div className="absolute left-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-slate-100 py-1 w-44 z-50">
                        {spaceTabsForRole.map((tab) => (
                          <button
                            key={tab.id}
                            onClick={() => { setActiveTab(tab.id); setShowSpaceMenu(false); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
                            style={{
                              color: activeTab === tab.id ? '#0E0E0E' : 'rgba(14,14,14,0.60)',
                              fontWeight: activeTab === tab.id ? 600 : 400,
                            }}
                          >
                            <tab.Icon size={14} strokeWidth={1.6} />
                            <span>{tab.label}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </nav>

            {/* Bell / Inbox — hidden for peek_handler */}
            {!isPeekHandler && (
              <button
                onClick={() => { setActiveTab('inbox'); setShowSpaceMenu(false); setShowUserMenu(false); }}
                className="relative shrink-0 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                style={{ color: activeTab === 'inbox' ? '#0E0E0E' : 'rgba(14,14,14,0.40)' }}
                aria-label="Inbox"
              >
                <Bell size={18} strokeWidth={1.6} />
                {unreadCount > 0 && (
                  <span
                    className="absolute top-0 right-0 flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold rounded-full"
                    style={{ backgroundColor: '#ef4444', color: '#fff', transform: 'translate(30%,-30%)' }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            )}

            {/* User menu */}
            <div className="relative shrink-0">
              <button
                onClick={() => { setShowUserMenu((v) => !v); setShowSpaceMenu(false); }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
                >
                  {userInitial}
                </div>
                <span className="text-xs font-medium text-slate-600 hidden sm:block max-w-[80px] truncate">
                  {user?.name?.split(' ')[0]}
                </span>
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-slate-100 py-1 w-52 z-50">
                    <div className="px-3 py-2 border-b border-slate-50">
                      <p className="text-sm font-medium text-slate-800 truncate">{user?.name}</p>
                      <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                      <span
                        className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full capitalize"
                        style={{ backgroundColor: 'rgba(14,14,14,0.07)', color: 'rgba(14,14,14,0.60)' }}
                      >
                        {user?.role}
                      </span>
                    </div>
                    <button
                      onClick={() => { setShowUserMenu(false); setShowTelegramModal(true); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      {telegramConnected ? (
                        <CheckCircle2 size={14} strokeWidth={1.5} style={{ color: '#A1F96E' }} />
                      ) : (
                        <Send size={14} strokeWidth={1.5} />
                      )}
                      {telegramConnected ? 'Telegram connected' : 'Connect Telegram'}
                    </button>
                    <button
                      onClick={() => { setShowUserMenu(false); logout(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <LogOut size={14} strokeWidth={1.5} />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile My Space sub-nav strip — visible only when a space tab is active */}
        {inSpace && (
          <div
            className="md:hidden overflow-x-auto"
            style={{ borderTop: '1px solid rgba(14,14,14,0.06)' }}
          >
            <div className="flex px-4 py-1.5 gap-1 min-w-max">
              {spaceTabsForRole.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
                  style={
                    activeTab === tab.id
                      ? { backgroundColor: 'rgba(161,249,110,0.22)', color: '#0E0E0E' }
                      : { color: 'rgba(14,14,14,0.45)' }
                  }
                >
                  <tab.Icon size={12} strokeWidth={1.6} />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-5 pb-24 md:pb-5">
        {activeTab === 'daily'      && <DailyLog onSyncStats={syncStatsMonth} onDataChanged={notifyStatsRefresh} />}
        {activeTab === 'stats'      && <Statistics year={statsYear} month={statsMonth} onYearChange={setStatsYear} onMonthChange={setStatsMonth} refreshKey={statsRefreshKey} />}
        {activeTab === 'calendar'   && <ShiftCalendar onDataChanged={notifyStatsRefresh} readOnly={isPeekHandler} />}
        {activeTab === 'qa'         && <AIChatQA />}
        {activeTab === 'requests'   && <PeakRequests onDataChanged={fetchNewRequestsCount} />}
        {activeTab === 'plans'      && <MyPlans />}
        {activeTab === 'inbox'      && <Inbox onRead={fetchUnreadCount} />}
        {activeTab === 'reviews'    && <Reviews />}
        {activeTab === 'pdp'        && <PDP />}
        {activeTab === 'qa-reports' && <QAReports />}
        {activeTab === 'kpi'        && <MyKPI />}
      </main>

      {/* ── Mobile bottom nav ── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white z-40"
        style={{ borderTop: '1px solid rgba(14,14,14,0.09)' }}
      >
        <div className="flex">
          {visibleSharedTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => tab.id === 'requests' ? handleRequestsTabClick() : setActiveTab(tab.id)}
              className="flex-1 flex flex-col items-center py-2 gap-0.5 text-[10px] font-medium transition-colors"
              style={{ color: activeTab === tab.id ? '#0E0E0E' : 'rgba(14,14,14,0.35)' }}
            >
              <div className="relative">
                <tab.Icon size={18} strokeWidth={1.6} />
                {tab.id === 'requests' && newRequestsBadge > 0 && (
                  <span
                    className="absolute -top-1 -right-1.5 flex items-center justify-center min-w-[14px] h-3.5 px-0.5 text-[8px] font-bold rounded-full"
                    style={{ backgroundColor: '#ef4444', color: '#fff' }}
                  >
                    {newRequestsBadge > 9 ? '9+' : newRequestsBadge}
                  </span>
                )}
              </div>
              <span>{tab.shortLabel}</span>
            </button>
          ))}
          {/* My Space entry on mobile — hidden for peek_handler */}
          {!isPeekHandler && (
            <button
              onClick={() => setActiveTab(inSpace ? activeTab : (spaceTabsForRole[0]?.id ?? 'plans'))}
              className="flex-1 flex flex-col items-center py-2 gap-0.5 text-[10px] font-medium transition-colors"
              style={{ color: inSpace ? '#0E0E0E' : 'rgba(14,14,14,0.35)' }}
            >
              <div className="relative">
                <User size={18} strokeWidth={1.6} />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1.5 flex items-center justify-center min-w-[14px] h-3.5 px-0.5 text-[8px] font-bold rounded-full"
                    style={{ backgroundColor: '#A1F96E', color: '#0E0E0E' }}
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <span>Space</span>
            </button>
          )}
        </div>
      </nav>

      <ShortcutsDrawer />

      <TelegramModal
        open={showTelegramModal}
        onClose={() => setShowTelegramModal(false)}
        onConnected={() => setTelegramConnected(true)}
      />
    </div>
  );
}

// ── Connect Telegram modal ──────────────────────────────────────────────────

function TelegramModal({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(null);
    setConnected(false);
    setError(false);
    setLoading(true);
    getTelegramLinkCode()
      .then((data) => { setCode(data.code); setBotUsername(data.botUsername); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [open]);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const status = await getTelegramStatus();
      if (status.connected) {
        setConnected(true);
        onConnected();
      }
    } catch {
      // ignore — user can just try again
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Connect Telegram">
      {error ? (
        <p className="text-sm text-red-500">Couldn't generate a code — try again in a moment.</p>
      ) : connected ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: '#0E0E0E' }}>
          <CheckCircle2 size={16} strokeWidth={1.5} style={{ color: '#A1F96E' }} />
          Telegram connected! You'll get CareSpace notifications there from now on.
        </div>
      ) : loading || !code ? (
        <p className="text-sm text-slate-400">Generating your code…</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {botUsername ? (
              <>Open{' '}
                <a
                  href={`https://t.me/${botUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                  style={{ color: '#0E0E0E' }}
                >
                  @{botUsername}
                </a>{' '}
                on Telegram and send it this code:
              </>
            ) : (
              'Open the CareSpace bot on Telegram and send it this code:'
            )}
          </p>
          <div
            className="text-2xl font-mono font-bold text-center py-3 rounded-xl"
            style={{ backgroundColor: 'rgba(14,14,14,0.05)', letterSpacing: '0.15em' }}
          >
            {code}
          </div>
          <p className="text-xs text-center" style={{ color: 'rgba(14,14,14,0.40)' }}>
            Code expires in 10 minutes.
          </p>
          <button onClick={handleCheck} disabled={checking} className="btn-accent text-sm w-full">
            {checking ? 'Checking…' : "I've sent it — refresh"}
          </button>
        </div>
      )}
    </Modal>
  );
}

// ── Auth gate ────────────────────────────────────────────────────────────────

function AppContent() {
  const { user, loading } = useAuth();
  const urlError = new URLSearchParams(window.location.search).get('error');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f8fafc' }}>
        <div
          className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: '#0E0E0E', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  if (!user) return <Login error={urlError} />;
  return <MainApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
