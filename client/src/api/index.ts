// client/src/api/index.ts
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // send session cookie on every request
});

// ─── Agents ────────────────────────────────────────────────────────────────
export const getAgents = () => api.get('/agents').then(r => r.data);

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

// ─── QA ────────────────────────────────────────────────────────────────────
export const getQAEntries = (params?: { channel?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number; includeArchived?: boolean }) =>
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

export const archiveQAEntry = (id: string) =>
  api.delete(`/qa/${id}`).then(r => r.data);
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

export const updatePeakRequestStatus = (id: string, status: string) =>
  api.patch(`/peak-requests/${id}/status`, { status }).then(r => r.data);

export const patchPeakRequestFields = (id: string, fields: { tags?: string }) =>
  api.patch(`/peak-requests/${id}/fields`, fields).then(r => r.data);

export const addPeakRequestComment = (id: string, text: string) =>
  api.post(`/peak-requests/${id}/comments`, { text }).then(r => r.data);

export const getNewRequestsCount = () =>
  api.get('/peak-requests/new-count').then(r => r.data as { count: number });

export const archivePeakRequest = (id: string) =>
  api.delete(`/peak-requests/${id}`).then(r => r.data);
export const deletePeakRequest = (id: string) =>
  api.delete(`/peak-requests/delete/${id}`).then(r => r.data);

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
  api.get('/kpi').then((r) => r.data);

export const updateKpiSettings = (data: unknown) =>
  api.put('/kpi', data).then((r) => r.data);

// ─── Quick Links ───────────────────────────────────────────────────────────────
export const getQuickLinks = () =>
  api.get('/quick-links').then((r) => r.data);

export const createQuickLink = (data: { title: string; url: string; category?: string }) =>
  api.post('/quick-links', data).then((r) => r.data);

export const deleteQuickLink = (id: string) =>
  api.delete(`/quick-links/${id}`).then((r) => r.data);

// ─── Shortcuts (shared team-wide library) ──────────────────────────────────
export const getShortcuts = () =>
  api.get('/shortcuts').then((r) => r.data);

export const createShortcut = (data: {
  title: string;
  type: 'text' | 'link';
  content?: string;
  variants?: { label?: string; content: string }[];
  category?: string;
}) => api.post('/shortcuts', data).then((r) => r.data);

export const updateShortcut = (id: string, data: {
  title: string;
  type: 'text' | 'link';
  content?: string;
  variants?: { label?: string; content: string }[];
  category?: string;
}) => api.put(`/shortcuts/${id}`, data).then((r) => r.data);

export const deleteShortcut = (id: string) =>
  api.delete(`/shortcuts/${id}`).then((r) => r.data);

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

export default api;
