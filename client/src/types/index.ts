// client/src/types/index.ts

export type ShiftType = 'MORNING' | 'NIGHT';
export type LeaveType = 'SHIFT' | 'VACATION' | 'SICK_LEAVE_WITH_NOTE' | 'SICK_LEAVE_WITHOUT_NOTE' | 'BIRTHDAY_OFF';
export type QAChannel = 'PEEKVIEWER_AI' | 'PENDING_AI' | 'UPDATE_DATA_AI' | 'UMOBIX_AI' | 'XMOBI_AI' | 'SPYBUBBLE_AI' | 'XNSPY_AI' | 'GEOFINDER_AI' | 'GEOFINDER_USERSPACE_AI' | 'LOCATIONTRACKER_AI' | 'GEOTRACKING_PRO_AI' | 'FOLLOWERS_STORY_PRO_AI' | 'LOCATIONTRACKIN_PRO_AI' | 'ACCOUNTVIEWER_AI';
export type QAStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';
export type RequestStatus = 'NEW' | 'IN_PROGRESS' | 'DONE';

export interface Agent {
  id: string;
  name: string;
  createdAt: string;
  archived: boolean;
}

export interface ShiftLog {
  id: string;
  agentId: string;
  agent: Agent;
  shiftType: ShiftType;
  shiftDate: string;
  hoursWorked: number;
  chatsCount: number;
  ticketsCount: number;
  callsCount: number;
  refundRequestsCount: number;
  comments: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface CalendarEvent {
  id: string;
  agentId: string;
  agent: Agent;
  eventDate: string;
  leaveType: LeaveType;
  shiftType: ShiftType | null;
  isExtraShift?: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  isGenerated?: boolean;
}

export interface AIChatQA {
  id: string;
  channel: QAChannel;
  status: QAStatus;
  chatText: string;
  issueDate: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface PeakRequestComment {
  authorId: string | null;
  authorName: string;
  text: string;
  createdAt: string;
}

// One entry in a ClientCard's timeline — either the active request or a
// read-only history item. contactEmail/profileNickname/archived now live on
// ClientCard (the card's identity/lifecycle), not per-request.
export interface PeakRequest {
  id: string;
  agentId: string;
  agent: Agent;
  requestText: string;
  status: RequestStatus;
  doneAt: string | null;
  comments: PeakRequestComment[];
  tags: string;
  createdAt: string;
  updatedAt: string;
}

// One card per unique client (matched by contactEmail + profileNickname).
export interface ClientCardView {
  id: string;
  contactEmail: string | null;
  profileNickname: string | null;
  status: RequestStatus;
  starred: boolean;
  archived: boolean;
  requestCount: number;
  lastActivityAt: string;
  lastCheckedByName: string | null;
  lastCheckedAt: string | null;
  hasNewActivity: boolean;
  activeRequest: PeakRequest;
  history: PeakRequest[]; // newest-first, excludes activeRequest
}

// Daily/monthly counts of resolved (Done) client cards credited per peek
// agent — already filtered server-side to what the viewer is allowed to see.
export interface PeekResolutionStats {
  byDay: Record<string, { name: string; count: number }[]>; // "yyyy-MM-dd" -> per-agent counts
  totals: { name: string; count: number }[];
}

export interface PeekCalendarEntry {
  id: string;
  userId: string;
  user: { id: string; name: string };
  eventDate: string;
  hours: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentStats {
  agentId: string;
  agentName: string;
  totalHours: number;
  totalShifts: number;
  morningShifts: number;
  nightShifts: number;
  totalChats: number;
  totalTickets: number;
  totalCalls: number;
  totalRefunds: number;
}

export type UserRole = 'head' | 'lead' | 'agent' | 'peek_handler';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  agentId: string | null;
  telegramChatId: string | null;
  avatarUrl: string | null;
}

export interface Plan {
  id: string;
  userId: string;
  title: string;
  completed: boolean;
  type: 'daily' | 'monthly';
  date: string | null;
  priority: 'high' | 'medium' | 'low';
  category: 'work' | 'learning' | 'personal';
  dueTime: string | null;
  carriedOver: boolean;
  carriedOverDismissed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QAComment {
  id: string;
  type: 'comment' | 'status_change';
  authorId?: string;
  authorName?: string;
  authorRole?: string;
  status?: string;
  text: string;
  createdAt: string;
}

export interface InboxMessageMetadata {
  year: number;
  month: number;
  agentId: string;
  reportId: string;
  status: string;
  agentName?: string;
  totalChats?: number | null;
  note?: string | null;
  issues?: { id: string; chatRef: string; issueType: string; notes: string | null; comments?: QAComment[] }[];
  timeline?: QAComment[];
}

export interface InboxMessage {
  id: string;
  senderId: string;
  sender: { id: string; name: string; role: string };
  receiverId: string;
  receiver?: { id: string; name: string; role: string };
  type: string;
  subject: string | null;
  content: string;
  metadata?: InboxMessageMetadata | null;
  replyToId?: string | null;
  replyTo?: { id: string; subject: string | null; content: string; senderName: string } | null;
  read: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QAIssue {
  id: string;
  reportId: string;
  agentId: string;
  agent: { id: string; name: string };
  chatRef: string;
  issueType: string;
  notes: string | null;
  comments: QAComment[];
  createdAt: string;
  updatedAt: string;
}

export interface QAReport {
  id: string | null;
  year: number;
  month: number;
  totalChats: number | null;
  issues: QAIssue[];
}

export interface QAAgentReport {
  id: string;
  reportId: string;
  agentId: string;
  agent: { id: string; name: string };
  status: 'draft' | 'sent' | 'returned' | 'resent';
  totalChats: number | null;
  note: string | null;
  comments: QAComment[];
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientReview {
  id: string;
  userId: string;
  user: { id: string; name: string; role: string };
  url: string;
  clientName: string | null;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

// ─── PDP ───────────────────────────────────────────────────────────────────

export interface PdpComment {
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface PdpGoal {
  id: string;
  planId: string;
  goal: string;
  specificActions: string | null;
  progressPct: number;
  status: 'not_started' | 'in_progress' | 'done';
  adminRating: number | null;
  targetDate: string | null;
  assignedByName: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PdpTask {
  id: string;
  planId: string;
  goalId: string | null;
  task: string;
  completed: boolean;
  status: 'not_started' | 'in_progress' | 'completed';
  adminGrade: number | null;
  comments: PdpComment[];
  assignedByName: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PdpFeedback {
  id: string;
  planId: string;
  mentorRating: number | null;
  mostHelpful: string | null;
  improvements: string | null;
  achievements: string | null;
  nextFocus: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PdpPlan {
  id: string;
  userId: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: 'in_progress' | 'completed';
  createdAt: string;
  updatedAt: string;
  goals: PdpGoal[];
  tasks: PdpTask[];
  feedback?: PdpFeedback | null;
  user?: { id: string; name: string; role: string };
}

export interface PdpSummaryItem {
  userId: string;
  userName: string;
  pdpStatus: 'none' | 'in_progress' | 'completed';
  totalGoals: number;
  doneGoals: number;
}

export interface QuickLink {
  id: string;
  userId: string;
  title: string;
  url: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export type ShortcutType = 'text' | 'link';

export interface ShortcutVariant {
  id: string;
  label: string;
  content: string;
}

export type ShortcutTagKind = 'product' | 'topic';

export interface ShortcutTag {
  id: string;
  kind: ShortcutTagKind;
  name: string;
  color: string;
  order: number;
}

export interface Shortcut {
  id: string;
  title: string;
  type: ShortcutType;
  content: string;
  variants: ShortcutVariant[]; // "text" shortcuts only — empty for legacy rows and all "link" shortcuts
  category: string; // legacy flat tag — still the only field the Add/Edit form writes to
  product: string; // facet, derived server-side from category — "" if uncategorized
  topic: string; // facet, derived server-side from category — "" if uncategorized
  pinned: boolean;
  imageData: string | null; // full data URL of a pasted/resized image, e.g. "data:image/jpeg;base64,..."
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

// Private, per-agent shortcuts — same shape as Shortcut minus the legacy
// category field (product/topic are assigned directly, not derived).
export interface PersonalShortcut {
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

export type UpdateTag = 'Important' | 'Policy change' | 'Reminder';

export interface TeamUpdate {
  id: string;
  authorId: string | null;
  authorName: string;
  title: string;
  content: string;
  tag: UpdateTag | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isAuthor: boolean;
  read: boolean;
  readCount: number;
  totalCount: number;
  readNames?: string[];   // present only for head/lead/author viewers
  unreadNames?: string[]; // present only for head/lead/author viewers
}

// ─── Salary ────────────────────────────────────────────────────────────────

export interface BonusEntry {
  id: string;
  description: string;
  amount: number;
}

export interface SalaryToggle {
  key: 'trustpilotOn' | 'updateOn' | 'uMobixOn' | 'strukturaOn';
  label: string;
  amount: number;
  on: boolean;
}

export interface SalaryRow {
  personKey: string;
  displayName: string;
  team: 'support' | 'peekviewer';
  hours: number;
  rate: number | null;
  base: number;
  hasReviews: boolean;
  reviewsCount: number;
  reviewsBonus: number;
  hasPeekBonus: boolean;
  peekCount?: number;
  peekBonus: number;
  shifts: number;
  toggles: SalaryToggle[];
  bonuses: BonusEntry[];
  bonusesTotal: number;
  total: number;
  editedFields: string[];
  canNotify: boolean;
  notifiedAt: string | null;
}

export interface SalaryOverrides {
  hours?: number | null;
  rate?: number | null;
  reviewsCount?: number | null;
  reviewsBonus?: number | null;
  peekBonus?: number | null;
  trustpilotOn?: boolean | null;
  updateOn?: boolean | null;
  uMobixOn?: boolean | null;
  strukturaOn?: boolean | null;
  total?: number | null;
}

export interface MonthlyStats {
  year?: number;
  month?: number;
  dateFrom: string;
  dateTo: string;
  stats: AgentStats[];
  totals: {
    totalHours: number;
    totalShifts: number;
    totalChats: number;
    totalTickets: number;
    totalCalls: number;
    totalRefunds: number;
  };
}
