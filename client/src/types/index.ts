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

export interface PeakRequest {
  id: string;
  agentId: string;
  agent: Agent;
  contactEmail?: string | null;
  profileNickname?: string | null;
  requestText: string;
  requestDate: string;
  status: RequestStatus;
  comments?: string | null;
  tags: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
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
