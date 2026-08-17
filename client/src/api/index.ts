// client/src/api/index.ts
import axios from 'axios';
import { cached, invalidateCache } from './cache';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // send session cookie on every request
});

// ─── Agents ────────────────────────────────────────────────────────────────
// No client-side create/update/delete exists for agents, so a plain TTL is safe —
// nothing in the app can make this stale mid-session besides an admin editing the
// roster directly, which is rare enough that a 5-minute cache is an easy trade.
export const getAgents = () => cached('agents', 5 * 60_000, () => api.get('/agents').then(r => r.data));

// ─── Shift Logs ────────────────────────────────────────────────────────────
export const getShiftLogs = (params?: { date?: string; dateFrom?: string; dateTo?: string; month?: number; year?: number; agentId?: string; limit?: number; offset?: number; includeArchived?: boolean }) =>
  api.get('/shift-logs', { params }).then(r => r.data);

export const getTodayLogs = () => api.get('/shift-logs/today').then(r => r.data);

export const createShiftLog = (data: {
  agentId: string;
  shiftType: string;
  shiftDate: string;
  chatsCount: number;
  ticketsCount: number;
  callsCount: number;
  refundRequestsCount: number;
  comments?: string;
}) => api.post('/shift-logs', data).then(r => r.data);

export const updateShiftLog = (id: string, data: {
  chatsCount: number;
  ticketsCount: number;
  callsCount: number;
  refundRequestsCount: number;
  comments?: string;
}) => api.put(`/shift-logs/${id}`, data).then(r => r.data);

export const archiveShiftLog = (id: string) =>
  api.delete(`/shift-logs/${id}`).then(r => r.data);
export const deleteShiftLog = (id: string) =>
  api.delete(`/shift-logs/delete/${id}`).then(r => r.data);

// ─── Calendar ──────────────────────────────────────────────────────────────
export const getCalendarEvents = (params?: { year?: number; month?: number; includeArchived?: boolean }) =>
  api.get('/calendar', { params }).then(r => r.data);

export const createCalendarEvent = (data: {
  agentId: string;
  eventDate: string;
  leaveType: string;
  shiftType?: string | null;
  isExtraShift?: boolean;
  notes?: string;
}) => api.post('/calendar', data).then(r => r.data);

export const updateCalendarEvent = (id: string, data: Partial<{
  agentId: string;
  eventDate: string;
  leaveType: string;
  shiftType: string | null;
  isExtraShift: boolean;
  notes: string;
}>) => api.put(`/calendar/${id}`, data).then(r => r.data);

export const archiveCalendarEvent = (id: string) =>
  api.delete(`/calendar/${id}`).then(r => r.data);
export const deleteCalendarEvent = (id: string) =>
  api.delete(`/calendar/delete/${id}`).then(r => r.data);

// Drag & drop date change — atomic move-or-swap server-side (see calendar.ts),
// so a plain move off a rotation agent's native day can also stamp the
// vacated day without a client-side race between two independent PUTs.
export const rescheduleCalendarEvent = (id: string, newDate: string) =>
  api.patch(`/calendar/${id}/reschedule`, { newDate }).then(r => r.data);

// One-off admin action (head/lead only) — see calendar.ts for the full
// writeup. Remove this + its button in ShiftCalendar.tsx once August's
// numbers are confirmed correct.
export const fixVictoriaNickyAugustSwap = () =>
  api.post('/calendar/fix-victoria-nicky-august-2026-swap').then(r => r.data as { success: boolean; results: string[] });

// ─── Peek Requests Calendar ──────────────────────────────────────────────────
export const getPeekCalendarAccess = (): Promise<{ canAccess: boolean }> =>
  api.get('/peek-calendar/access').then(r => r.data);

export const getPeekCalendarAssignees = () =>
  api.get('/peek-calendar/assignees').then(r => r.data);

export const getPeekCalendarEntries = (params?: { year?: number; month?: number }) =>
  api.get('/peek-calendar', { params }).then(r => r.data);

export const createPeekCalendarEntry = (data: { userId: string; eventDate: string; hours?: string }) =>
  api.post('/peek-calendar', data).then(r => r.data);

export const updatePeekCalendarEntry = (id: string, data: Partial<{ eventDate: string; hours: string }>) =>
  api.put(`/peek-calendar/${id}`, data).then(r => r.data);

export const deletePeekCalendarEntry = (id: string) =>
  api.delete(`/peek-calendar/${id}`).then(r => r.data);

export const getPeekResolutionStats = (params?: { year?: number; month?: number }) =>
  api.get('/peek-calendar/resolution-stats', { params }).then(r => r.data);

// ─── QA ────────────────────────────────────────────────────────────────────
export const getQAEntries = (params?: { channel?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }) =>
  api.get('/qa', { params }).then(r => r.data);

export const createQAEntry = (data: {
  channel: string;
  status?: string;
  chatText: string;
  issueDate: string;
  comment: string;
}) => api.post('/qa', data).then(r => r.data);

export const updateQAEntry = (id: string, data: Partial<{
  channel: string;
  status: string;
  chatText: string;
  issueDate: string;
  comment: string;
}>) => api.put(`/qa/${id}`, data).then(r => r.data);

export const deleteQAEntry = (id: string) =>
  api.delete(`/qa/delete/${id}`).then(r => r.data);

// One-off cleanup (head/lead only) — see qa.ts's purge-archived for the full writeup.
export const purgeArchivedQAEntries = () =>
  api.post('/qa/purge-archived').then(r => r.data as {
    deletedCount: number;
    deleted: { id: string; channel: string; issueDate: string; comment: string }[];
  });

// ─── Peak Requests ─────────────────────────────────────────────────────────
export const getPeakRequests = (params?: { status?: string; agentId?: string; limit?: number; offset?: number; includeArchived?: boolean; search?: string }) =>
  api.get('/peak-requests', { params }).then(r => r.data);

export const createPeakRequest = (data: {
  agentId: string;
  contactEmail?: string;
  profileNickname?: string;
  requestText: string;
}) => api.post('/peak-requests', data).then(r => r.data);

export const updatePeakRequest = (id: string, data: {
  agentId: string;
  contactEmail?: string;
  profileNickname?: string;
  requestText: string;
}) => api.put(`/peak-requests/${id}`, data).then(r => r.data);

export const patchPeakRequestFields = (id: string, fields: { tags?: string }) =>
  api.patch(`/peak-requests/${id}/fields`, fields).then(r => r.data);

export const addPeakRequestComment = (id: string, text: string) =>
  api.post(`/peak-requests/${id}/comments`, { text }).then(r => r.data);

export const getNewRequestsCount = () =>
  api.get('/peak-requests/new-count').then(r => r.data as { count: number });

// ─── Peak Requests: card-level actions (keyed by ClientCard id) ────────────
export const updatePeakRequestCardStatus = (cardId: string, status: string) =>
  api.patch(`/peak-requests/cards/${cardId}/status`, { status }).then(r => r.data);

export const togglePeakRequestCardStar = (cardId: string, starred: boolean) =>
  api.patch(`/peak-requests/cards/${cardId}/star`, { starred }).then(r => r.data);

export const checkPeakRequestCard = (cardId: string) =>
  api.patch(`/peak-requests/cards/${cardId}/checked`).then(r => r.data);

export const archivePeakRequestCard = (cardId: string) =>
  api.delete(`/peak-requests/cards/${cardId}`).then(r => r.data);
export const deletePeakRequestCard = (cardId: string) =>
  api.delete(`/peak-requests/cards/delete/${cardId}`).then(r => r.data);

// ─── Statistics ────────────────────────────────────────────────────────────
export const getStatistics = (params?: { year?: number; month?: number; dateFrom?: string; dateTo?: string }) =>
  api.get('/statistics', { params }).then(r => r.data);

export const getAgentStats = (agentId: string, months?: number) =>
  api.get(`/statistics/agent/${agentId}`, { params: { months } }).then(r => r.data);

// ─── Auth ──────────────────────────────────────────────────────────────────
export const getMe = () => api.get('/auth/me').then((r) => r.data);
export const logout = () => api.post('/auth/logout').then((r) => r.data);

// ─── Telegram ──────────────────────────────────────────────────────────────
export const getTelegramLinkCode = (): Promise<{ code: string; botUsername: string | null }> =>
  api.post('/telegram/link-code').then((r) => r.data);

export const getTelegramStatus = (): Promise<{ connected: boolean }> =>
  api.get('/telegram/status').then((r) => r.data);

// ─── Plans ─────────────────────────────────────────────────────────────────
export const getPlans = () => api.get('/plans').then((r) => r.data);

export const createPlan = (data: {
  title: string;
  date?: string | null;
  priority?: string;
  category?: string;
  dueTime?: string | null;
}) => api.post('/plans', data).then((r) => r.data);

export const updatePlan = (id: string, data: {
  title?: string;
  completed?: boolean;
  priority?: string;
  category?: string;
  dueTime?: string | null;
  date?: string | null;
  carriedOverDismissed?: boolean;
}) => api.patch(`/plans/${id}`, data).then((r) => r.data);

export const deletePlan = (id: string) =>
  api.delete(`/plans/${id}`).then((r) => r.data);

// ─── Inbox ─────────────────────────────────────────────────────────────────
export const getInbox = () => api.get('/inbox').then((r) => r.data);

export const getSentMessages = () => api.get('/inbox/sent').then((r) => r.data);

export const getInboxUsers = () => api.get('/inbox/users').then((r) => r.data);

export const getUnreadCount = () =>
  api.get('/inbox/unread-count').then((r) => r.data as { count: number });

export const markMessageRead = (id: string) =>
  api.patch(`/inbox/${id}/read`).then((r) => r.data);

export const sendMessage = (data: { recipientId: string; type: string; content: string; replyToId?: string }) =>
  api.post('/inbox', data).then((r) => r.data);

export const deleteMessage = (id: string) =>
  api.delete(`/inbox/${id}`).then((r) => r.data);

// ─── Updates (Inbox tab: lead/head announcements) ──────────────────────────
export const getUpdates = () => api.get('/updates').then((r) => r.data);

export const createUpdate = (data: { title: string; content: string; tag?: string | null }) =>
  api.post('/updates', data).then((r) => r.data);

export const updateUpdate = (id: string, data: { title: string; content: string; tag?: string | null }) =>
  api.put(`/updates/${id}`, data).then((r) => r.data);

export const deleteUpdate = (id: string) =>
  api.delete(`/updates/${id}`).then((r) => r.data);

export const markUpdateRead = (id: string) =>
  api.patch(`/updates/${id}/read`).then((r) => r.data);

// ─── Reviews ───────────────────────────────────────────────────────────────
export const getReviews = (params?: {
  userId?: string;
  month?: number;
  year?: number;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}) => api.get('/reviews', { params }).then((r) => r.data);

export const createReview = (data: { url: string; clientName?: string; submittedAt?: string }) =>
  api.post('/reviews', data).then((r) => r.data);

export const archiveReview = (id: string) =>
  api.delete(`/reviews/${id}`).then((r) => r.data);

export const deleteReview = (id: string) =>
  api.delete(`/reviews/delete/${id}`).then((r) => r.data);

// ─── QA Reports ────────────────────────────────────────────────────────────
export const getQAReport = (params: { year: number; month: number }) =>
  api.get('/qa-reports', { params }).then((r) => r.data);

export const updateQAReportTotal = (
  params: { year: number; month: number },
  totalChats: number | null,
) => api.patch('/qa-reports', { totalChats }, { params }).then((r) => r.data);

export const createQAIssue = (data: {
  year: number;
  month: number;
  agentId: string;
  chatRef: string;
  issueType: string;
  notes?: string;
}) => api.post('/qa-reports/issues', data).then((r) => r.data);

export const updateQAIssue = (
  id: string,
  data: { agentId: string; chatRef: string; issueType: string; notes?: string },
) => api.put(`/qa-reports/issues/${id}`, data).then((r) => r.data);

export const deleteQAIssue = (id: string) =>
  api.delete(`/qa-reports/issues/${id}`).then((r) => r.data);

export const getQAAgentReports = (params: { year: number; month: number }) =>
  api.get('/qa-reports/agent-reports', { params }).then((r) => r.data);

export const saveQAAgentReportDraft = (data: {
  year: number; month: number; agentId: string; note: string;
}) => api.patch('/qa-reports/agent-reports', data).then((r) => r.data);

export const updateQAAgentReportTotal = (
  params: { year: number; month: number; agentId: string },
  totalChats: number | null,
) => api.patch('/qa-reports/agent-reports', { ...params, totalChats }).then((r) => r.data);

export const sendQAAgentReport = (data: {
  year: number; month: number; agentId: string; note: string; totalChats?: number | null;
}) => api.post('/qa-reports/agent-reports/send', data).then((r) => r.data);

export const addQAAgentReportComment = (data: {
  year: number; month: number; agentId: string; text: string; action?: 'comment' | 'return';
}) => api.post('/qa-reports/agent-reports/comment', data).then((r) => r.data);

export const addQAIssueComment = (
  issueId: string,
  data: { text: string; action?: 'comment' | 'return' },
) => api.post(`/qa-reports/issues/${issueId}/comment`, data).then((r) => r.data);

export const resetAllQaReports = () =>
  api.delete('/qa-reports/reset-all').then((r) => r.data);

// ─── PDP ──────────────────────────────────────────────────────────────────────
export const getMyPDP = () => api.get('/pdp/me').then((r) => r.data);

export const getPDPSummary = () => api.get('/pdp/summary').then((r) => r.data);

export const getPDPByUser = (userId: string) =>
  api.get(`/pdp/user/${userId}`).then((r) => r.data);

export const createPDP = (data: { periodStart?: string; periodEnd?: string }) =>
  api.post('/pdp', data).then((r) => r.data);

export const updatePDPPeriod = (id: string, data: { periodStart?: string; periodEnd?: string }) =>
  api.patch(`/pdp/${id}`, data).then((r) => r.data);

export const createPDPGoal = (
  planId: string,
  data: { goal: string; specificActions?: string; targetDate?: string },
) => api.post(`/pdp/${planId}/goals`, data).then((r) => r.data);

export const updatePDPGoal = (
  goalId: string,
  data: Partial<{
    goal: string;
    specificActions: string | null;
    progressPct: number;
    status: string;
    targetDate: string | null;
    adminRating: number | null;
  }>,
) => api.patch(`/pdp/goals/${goalId}`, data).then((r) => r.data);

export const deletePDPGoal = (goalId: string) =>
  api.delete(`/pdp/goals/${goalId}`).then((r) => r.data);

export const createPDPTask = (
  planId: string,
  data: { task: string; goalId?: string },
) => api.post(`/pdp/${planId}/tasks`, data).then((r) => r.data);

export const updatePDPTask = (
  taskId: string,
  data: Partial<{
    task: string;
    goalId: string | null;
    completed: boolean;
    status: string;
    adminGrade: number | null;
  }>,
) => api.patch(`/pdp/tasks/${taskId}`, data).then((r) => r.data);

export const deletePDPTask = (taskId: string) =>
  api.delete(`/pdp/tasks/${taskId}`).then((r) => r.data);

export const addPDPTaskComment = (taskId: string, text: string) =>
  api.post(`/pdp/tasks/${taskId}/comments`, { text }).then((r) => r.data);

export const savePDPFeedback = (
  planId: string,
  data: {
    mentorRating?: number | null;
    mostHelpful?: string;
    improvements?: string;
    achievements?: string;
    nextFocus?: string;
  },
) => api.put(`/pdp/${planId}/feedback`, data).then((r) => r.data);

export const submitPDPFeedback = (planId: string) =>
  api.post(`/pdp/${planId}/feedback/submit`).then((r) => r.data);

// ─── KPI Settings ──────────────────────────────────────────────────────────────
export const getKpiSettings = () =>
  cached('kpi-settings', 60_000, () => api.get('/kpi').then((r) => r.data));

export const updateKpiSettings = (data: unknown) =>
  api.put('/kpi', data).then((r) => { invalidateCache('kpi-settings'); return r.data; });

// ─── Quick Links ───────────────────────────────────────────────────────────────
export const getQuickLinks = () =>
  api.get('/quick-links').then((r) => r.data);

export const createQuickLink = (data: { title: string; url: string; category?: string }) =>
  api.post('/quick-links', data).then((r) => r.data);

export const deleteQuickLink = (id: string) =>
  api.delete(`/quick-links/${id}`).then((r) => r.data);

// ─── Shortcuts — Templates (shared team-wide library) ──────────────────────
// Cache keys are namespaced ":shared" vs ":personal" (see the Personal Shortcuts
// section below) — sharing one key between the two tabs would let switching
// tabs within the TTL window silently serve the other tab's cached data.
export const getShortcuts = () =>
  cached('shortcuts:shared', 60_000, () => api.get('/shortcuts').then((r) => r.data));

export const createShortcut = (data: {
  title: string;
  type: 'text' | 'link';
  content?: string;
  variants?: { label?: string; content: string }[];
  category?: string;
  imageData?: string | null;
}) => api.post('/shortcuts', data).then((r) => { invalidateCache('shortcuts:shared'); return r.data; });

export const updateShortcut = (id: string, data: {
  title: string;
  type: 'text' | 'link';
  content?: string;
  variants?: { label?: string; content: string }[];
  category?: string;
  imageData?: string | null;
}) => api.put(`/shortcuts/${id}`, data).then((r) => { invalidateCache('shortcuts:shared'); return r.data; });

export const deleteShortcut = (id: string) =>
  api.delete(`/shortcuts/${id}`).then((r) => { invalidateCache('shortcuts:shared'); return r.data; });

export const renameShortcutCategory = (from: string, to: string) =>
  api.patch('/shortcuts/category', { from, to }).then((r) => { invalidateCache('shortcuts:shared'); return r.data; });

export const deleteShortcutCategory = (name: string) =>
  api.delete(`/shortcuts/category/${encodeURIComponent(name)}`).then((r) => { invalidateCache('shortcuts:shared'); return r.data; });

export const pinShortcut = (id: string, pinned: boolean) =>
  api.patch(`/shortcuts/${id}/pin`, { pinned }).then((r) => { invalidateCache('shortcuts:shared'); return r.data; });

export const getShortcutTags = () =>
  cached('shortcut-tags:shared', 60_000, () => api.get('/shortcuts/tags').then((r) => r.data));

export const reorderShortcutTags = (kind: 'product' | 'topic', names: string[]) =>
  api.patch('/shortcuts/tags/reorder', { kind, names }).then((r) => { invalidateCache('shortcut-tags:shared'); return r.data; });

export const recolorShortcutTag = (kind: 'product' | 'topic', name: string, color: string) =>
  api.patch(`/shortcuts/tags/${kind}/${encodeURIComponent(name)}/color`, { color })
    .then((r) => { invalidateCache('shortcut-tags:shared'); return r.data; });

// ─── Personal Shortcuts (private, per-agent library) ───────────────────────
export const getPersonalShortcuts = () =>
  cached('shortcuts:personal', 60_000, () => api.get('/personal-shortcuts').then((r) => r.data));

export const createPersonalShortcut = (data: {
  title: string;
  type: 'text' | 'link';
  content?: string;
  variants?: { label?: string; content: string }[];
  product?: string;
  topic?: string;
  imageData?: string | null;
}) => api.post('/personal-shortcuts', data).then((r) => { invalidateCache('shortcuts:personal'); return r.data; });

export const updatePersonalShortcut = (id: string, data: {
  title: string;
  type: 'text' | 'link';
  content?: string;
  variants?: { label?: string; content: string }[];
  product?: string;
  topic?: string;
  imageData?: string | null;
}) => api.put(`/personal-shortcuts/${id}`, data).then((r) => { invalidateCache('shortcuts:personal'); return r.data; });

export const deletePersonalShortcut = (id: string) =>
  api.delete(`/personal-shortcuts/${id}`).then((r) => { invalidateCache('shortcuts:personal'); return r.data; });

export const pinPersonalShortcut = (id: string, pinned: boolean) =>
  api.patch(`/personal-shortcuts/${id}/pin`, { pinned }).then((r) => { invalidateCache('shortcuts:personal'); return r.data; });

export const getPersonalShortcutTags = () =>
  cached('shortcut-tags:personal', 60_000, () => api.get('/personal-shortcuts/tags').then((r) => r.data));

export const reorderPersonalShortcutTags = (kind: 'product' | 'topic', names: string[]) =>
  api.patch('/personal-shortcuts/tags/reorder', { kind, names }).then((r) => { invalidateCache('shortcut-tags:personal'); return r.data; });

export const recolorPersonalShortcutTag = (kind: 'product' | 'topic', name: string, color: string) =>
  api.patch(`/personal-shortcuts/tags/${kind}/${encodeURIComponent(name)}/color`, { color })
    .then((r) => { invalidateCache('shortcut-tags:personal'); return r.data; });

// One-off (see personalShortcuts.ts) — remove alongside its button once the
// import is confirmed.
export const bulkImportVictoriaTemplates = () =>
  api.post('/personal-shortcuts/bulk-import-victoria-templates').then((r) => {
    invalidateCache('shortcuts:personal');
    return r.data as { success: boolean; created: number; skipped: number; total: number };
  });

// ─── Duty status (Peek Requests) ────────────────────────────────────────────
export interface DutyStatus {
  myOnDuty: boolean;
  eligible: boolean;
  peekTeamOnline: string[];
  supportShift: { morning: string | null; night: string | null };
}

export const getDutyStatus = () =>
  api.get('/duty').then((r) => r.data as DutyStatus);

export const setDutyStatus = (onDuty: boolean) =>
  api.patch('/duty/me', { onDuty }).then((r) => r.data);

export const downloadBackup = () =>
  api.get('/backup', { responseType: 'blob' }).then((r) => r.data as Blob);

// ─── Salary ──────────────────────────────────────────────────────────────────
export const getSalary = (params: { year: number; month: number; team: 'support' | 'peekviewer' }) =>
  api.get('/salary', { params }).then((r) => r.data);

export const patchSalary = (personKey: string, body: {
  year: number; month: number; team: 'support' | 'peekviewer';
  overrides?: Record<string, number | boolean | null>;
  bonuses?: { id: string; description: string; amount: number }[];
}) => api.patch(`/salary/${personKey}`, body).then((r) => r.data);

export const sendSalaryNotification = (personKey: string, body: {
  year: number; month: number; team: 'support' | 'peekviewer'; message: string;
}) => api.post(`/salary/${personKey}/notify`, body).then((r) => r.data);

export default api;
