// client/src/api/index.ts
import axios from 'axios';
import { cached, invalidateCache } from './cache';
import type { UpdateAttachment } from '../types';

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

export const editPeakRequestComment = (id: string, commentId: string, text: string) =>
  api.patch(`/peak-requests/${id}/comments/${commentId}`, { text }).then(r => r.data);

export const deletePeakRequestComment = (id: string, commentId: string) =>
  api.delete(`/peak-requests/${id}/comments/${commentId}`).then(r => r.data);

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

// recipientIds: one InboxMessage row is created per recipient (same
// content); the response is always an array, even for a single recipient.
export const sendMessage = (data: { recipientIds: string[]; type: string; content: string; replyToId?: string }) =>
  api.post('/inbox', data).then((r) => r.data);

export const deleteMessage = (id: string) =>
  api.delete(`/inbox/${id}`).then((r) => r.data);

// ─── Updates (Inbox tab: lead/head/peekviewerAdmin announcements) ──────────
// `team` is only needed for Victoria Davis/Sandra Moore (whose current space
// determines which team's Updates they see) — everyone else's server-side
// team is inferred from their own account, so omitting it is fine.
export const getUpdates = (team?: 'support' | 'peekviewer') =>
  api.get('/updates', { params: { team } }).then((r) => r.data);

export const createUpdate = (data: { title: string; content: string; tag?: string | null; attachments?: UpdateAttachment[]; team?: 'support' | 'peekviewer' }) =>
  api.post('/updates', data).then((r) => r.data);

export const updateUpdate = (id: string, data: { title: string; content: string; tag?: string | null; attachments?: UpdateAttachment[] }) =>
  api.put(`/updates/${id}`, data).then((r) => r.data);

export const deleteUpdate = (id: string) =>
  api.delete(`/updates/${id}`).then((r) => r.data);

export const markUpdateRead = (id: string) =>
  api.patch(`/updates/${id}/read`).then((r) => r.data);

export const deleteUpdateAttachment = (url: string) =>
  api.delete('/updates/attachments', { data: { url } }).then((r) => r.data);

// The store is private, so attachments aren't fetched via a plain <a href>/<img src> —
// this builds an authenticated proxy URL through /attachments/view instead. Axios's
// cookie-jar auth doesn't apply to a bare browser navigation/img-load, but the session
// cookie is still sent automatically since it's same-origin.
export const getUpdateAttachmentUrl = (url: string) =>
  `/api/updates/attachments/view?url=${encodeURIComponent(url)}`;

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
export const getKpiSettings = (team: 'support' | 'peekviewer' = 'support') =>
  cached(`kpi-settings-${team}`, 60_000, () => api.get('/kpi', { params: { team } }).then((r) => r.data));

export const updateKpiSettings = (data: unknown, team: 'support' | 'peekviewer' = 'support') =>
  api.put('/kpi', data, { params: { team } }).then((r) => { invalidateCache(`kpi-settings-${team}`); return r.data; });

// ─── Boost Requests (Peekviewer Team) ──────────────────────────────────────
export interface BoostRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  boostType: 'likes' | 'followers' | 'comments';
  link: string;
  quantity: number;
  status: 'in_progress' | 'complete';
  completedAt: string | null;
  completedByName: string | null;
  batchId: string | null;
  deletedByRequester: boolean;
  deletedByAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export const getBoostRequests = (includeCompleted?: boolean) =>
  api.get<BoostRequest[]>('/boost-requests', { params: { includeCompleted: includeCompleted ? 1 : undefined } }).then((r) => r.data);

export const getMySentBoostRequests = () =>
  api.get<BoostRequest[]>('/boost-requests/sent').then((r) => r.data);

export const createBoostRequestsBulk = (items: { boostType: 'likes' | 'followers' | 'comments'; link: string; quantity: number }[]) =>
  api.post<BoostRequest[]>('/boost-requests/bulk', { items }).then((r) => r.data);

export const completeBoostRequest = (id: string) =>
  api.patch<BoostRequest>(`/boost-requests/${id}/complete`).then((r) => r.data);

export const updateBoostRequest = (id: string, data: { boostType?: string; link?: string; quantity?: number }) =>
  api.patch<BoostRequest>(`/boost-requests/${id}`, data).then((r) => r.data);

// scope: 'requester' forces this to be treated as "delete from my own sent
// list" even for an admin who happens to be the requester (see server-side
// DELETE /:id) — omit it for the normal admin-queue delete button.
export const deleteBoostRequest = (id: string, scope?: 'requester' | 'admin') =>
  api.delete(`/boost-requests/${id}`, scope ? { data: { scope } } : undefined).then((r) => r.data);

// ─── Proxy pool (Peekviewer Team) ──────────────────────────────────────────
export interface ProxyItem {
  id: string;
  value: string;
  header: string;
  addedById: string;
  addedByName: string;
  takenById: string | null;
  takenByName: string | null;
  takenAt: string | null;
  archived: boolean;
  createdAt: string;
}

export const getProxies = () => api.get<ProxyItem[]>('/proxies').then((r) => r.data);

export const addProxiesBulk = (text: string, header?: string) =>
  api.post<ProxyItem[]>('/proxies/bulk', { text, header }).then((r) => r.data);

export const takeProxy = (id: string) =>
  api.patch<ProxyItem>(`/proxies/${id}/take`).then((r) => r.data);

export const archiveProxy = (id: string) =>
  api.patch<ProxyItem>(`/proxies/${id}/archive`).then((r) => r.data);

export const updateProxy = (id: string, data: { value?: string; header?: string }) =>
  api.patch<ProxyItem>(`/proxies/${id}`, data).then((r) => r.data);

export const deleteProxy = (id: string) =>
  api.delete(`/proxies/${id}`).then((r) => r.data);

// ─── Row Accounts pool (Peekviewer Team) ───────────────────────────────────
export type RowAccountMode = 'with2fa' | 'without2fa';

export interface RowAccountItem {
  id: string;
  login: string;
  password: string;
  twoFaCode: string | null;
  email: string | null;
  emailPassword: string | null;
  header: string;
  addedById: string;
  addedByName: string;
  takenById: string | null;
  takenByName: string | null;
  takenAt: string | null;
  archived: boolean;
  createdAt: string;
}

export const getRowAccounts = () => api.get<RowAccountItem[]>('/row-accounts').then((r) => r.data);

export const addRowAccountsBulk = (text: string, mode: RowAccountMode, header?: string) =>
  api.post<RowAccountItem[]>('/row-accounts/bulk', { text, mode, header }).then((r) => r.data);

export const takeRowAccount = (id: string) =>
  api.patch<RowAccountItem>(`/row-accounts/${id}/take`).then((r) => r.data);

export const archiveRowAccount = (id: string) =>
  api.patch<RowAccountItem>(`/row-accounts/${id}/archive`).then((r) => r.data);

export const updateRowAccount = (id: string, data: Partial<Pick<RowAccountItem, 'login' | 'password' | 'twoFaCode' | 'email' | 'emailPassword' | 'header'>>) =>
  api.patch<RowAccountItem>(`/row-accounts/${id}`, data).then((r) => r.data);

export const deleteRowAccount = (id: string) =>
  api.delete(`/row-accounts/${id}`).then((r) => r.data);

// ─── Reserve email pool (Peekviewer Team, part of Row Accounts) ────────────
export interface ReserveEmailLinkedAccount {
  id: string;
  nickname: string;
  addedById: string;
  addedByName: string;
  createdAt: string;
}

export interface ReserveEmailItem {
  id: string;
  email: string;
  emailPassword: string | null;
  linkedAccounts: ReserveEmailLinkedAccount[];
  addedById: string;
  addedByName: string;
  createdAt: string;
}

export const getReserveEmails = () => api.get<ReserveEmailItem[]>('/reserve-emails').then((r) => r.data);

export const addReserveEmailsBulk = (text: string) =>
  api.post<ReserveEmailItem[]>('/reserve-emails/bulk', { text }).then((r) => r.data);

export const addReserveEmailAccount = (id: string, nickname: string) =>
  api.patch<ReserveEmailItem>(`/reserve-emails/${id}/accounts`, { nickname }).then((r) => r.data);

export const removeReserveEmailAccount = (id: string, accountId: string) =>
  api.delete<ReserveEmailItem>(`/reserve-emails/${id}/accounts/${accountId}`).then((r) => r.data);

export const updateReserveEmail = (id: string, data: { email?: string; emailPassword?: string | null }) =>
  api.patch<ReserveEmailItem>(`/reserve-emails/${id}`, data).then((r) => r.data);

export const deleteReserveEmail = (id: string) =>
  api.delete(`/reserve-emails/${id}`).then((r) => r.data);

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

export const patchSalaryTeamMeta = (body: {
  year: number; month: number; team: 'peekviewer'; totalParsedProfiles: number | null;
}) => api.put('/salary/team-meta', body).then((r) => r.data);

// ─── Request Schedule (Peekviewer Team) ────────────────────────────────────
export interface RequestScheduleDay {
  date: string; // "YYYY-MM-DD"
  userId: string;
  userName: string;
  isOverride: boolean;
}

export interface RequestScheduleRedistributionRow {
  userId: string;
  userName: string;
  days: number[];
}

export interface RequestScheduleData {
  days: RequestScheduleDay[];
  redistribution: RequestScheduleRedistributionRow[];
  calendarAgents: { userId: string; userName: string }[];
}

export const getRequestSchedule = (year: number, month: number) =>
  api.get<RequestScheduleData>('/request-schedule', { params: { year, month } }).then((r) => r.data);

export interface RequestScheduleTodayAssignee { date: string; userId: string; userName: string }

export const getTodayRequestScheduleAssignee = () =>
  api.get<RequestScheduleTodayAssignee>('/request-schedule/today').then((r) => r.data);

export const swapRequestScheduleDay = (date: string, targetDate: string) =>
  api.post('/request-schedule/swap', { date, targetDate }).then((r) => r.data);

export const assignRequestScheduleDay = (date: string, userId: string) =>
  api.patch('/request-schedule/assign', { date, userId }).then((r) => r.data);

// ─── Onboarding (Peekviewer Team, inside My Space) ─────────────────────────
export interface OnboardingAttachment { url: string; pathname: string; name: string; contentType: string; size: number }

export interface OnboardingBlockData {
  id: string;
  authorId: string | null;
  authorName: string;
  title: string;
  content: string;
  attachments: OnboardingAttachment[];
  parentId: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isAuthor: boolean;
}

export const getOnboardingBlocks = () => api.get<OnboardingBlockData[]>('/onboarding').then((r) => r.data);

export const createOnboardingBlock = (data: { title: string; content: string; attachments?: OnboardingAttachment[]; parentId?: string | null }) =>
  api.post<OnboardingBlockData>('/onboarding', data).then((r) => r.data);

export const updateOnboardingBlock = (id: string, data: { title: string; content: string; attachments?: OnboardingAttachment[]; parentId?: string | null }) =>
  api.put<OnboardingBlockData>(`/onboarding/${id}`, data).then((r) => r.data);

export const deleteOnboardingBlock = (id: string) =>
  api.delete(`/onboarding/${id}`).then((r) => r.data);

// ids is the full new order of one sibling group — every top-level block
// (parentId: null) or one specific top-level block's own sub-blocks
// (parentId: that block's id).
export const reorderOnboardingBlocks = (parentId: string | null, ids: string[]) =>
  api.patch('/onboarding/reorder', { parentId, ids }).then((r) => r.data);

export const deleteOnboardingAttachment = (url: string) =>
  api.delete('/onboarding/attachments', { data: { url } }).then((r) => r.data);

// Private store — stream through this authenticated proxy so <img>/<video> can point at it directly.
export const getOnboardingAttachmentUrl = (url: string) =>
  `/api/onboarding/attachments/view?url=${encodeURIComponent(url)}`;

// ─── Account Requests (Peekviewer Team — "New account request" to Anna) ───
export type AccountRequestStatus = 'open' | 'in_progress' | 'done';

export interface AccountRequestComment { id: string; authorName: string; text: string; createdAt: string }

export interface AccountRequestData {
  id: string;
  requesterId: string;
  requesterName: string;
  content: string;
  status: AccountRequestStatus;
  comments: AccountRequestComment[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// Anna's full queue — Anna or peekviewerAdmin only (server-enforced)
export const getAccountRequestsQueue = () => api.get<AccountRequestData[]>('/account-requests').then((r) => r.data);

// The caller's own requests sent to Anna (Inbox's "Requests sent to Anna" view)
export const getMySentAccountRequests = () => api.get<AccountRequestData[]>('/account-requests/sent').then((r) => r.data);

export const createAccountRequest = (content: string) =>
  api.post<AccountRequestData>('/account-requests', { content }).then((r) => r.data);

export const updateAccountRequest = (id: string, data: { status?: AccountRequestStatus; comment?: string; archived?: boolean }) =>
  api.patch<AccountRequestData>(`/account-requests/${id}`, data).then((r) => r.data);

// scope: 'requester' forces this to be treated as "delete from my own sent
// list" even for a manager who happens to be the requester — omit it for
// the normal managers'-queue delete button (see server-side DELETE /:id).
export const deleteAccountRequest = (id: string, scope?: 'requester' | 'admin') =>
  api.delete(`/account-requests/${id}`, scope ? { data: { scope } } : undefined).then((r) => r.data);

// ─── Notes (My Space — both teams) ─────────────────────────────────────────
export interface NoteData {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export const getNotes = () => api.get<NoteData[]>('/notes').then((r) => r.data);

export const createNote = (data: { title: string; content: string }) =>
  api.post<NoteData>('/notes', data).then((r) => r.data);

export const updateNote = (id: string, data: { title: string; content: string }) =>
  api.put<NoteData>(`/notes/${id}`, data).then((r) => r.data);

export const deleteNote = (id: string) =>
  api.delete(`/notes/${id}`).then((r) => r.data);

export default api;
