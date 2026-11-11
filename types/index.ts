export type PipelineStatus = 
  | 'Lead' 
  | 'Contacted' 
  | 'In Discussion' 
  | 'Meeting' 
  | 'Client' 
  | 'Cold'
  | 'bad email';

export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string; // 'Lead & Business Development (admin)' or 'admin' / 'member'
  systemRole?: UserRole; // 'admin' | 'member'
  color: string;
  initials: string;
  password?: string;
  isActive?: boolean;
  createdAt?: string;
  has2FA?: boolean;
  connectedGmail?: string;
}

export type GmailAccountStatus = 'active' | 'needs_reconnect' | 'paused';

export interface GmailAccount {
  id: string;
  ownerUserId: string;
  email: string;
  status: GmailAccountStatus;
  connectedAt?: string;
  historyId?: string;
  lastSyncAt?: string;
  dailyCap: number; // default 5, hard max 30
  sentToday: number; // sent today in PKT
  warmupStartedAt: string;
  warmupOverride: boolean;
  pauseReason?: string;
  ownerName?: string;
  ownerInitials?: string;
  ownerColor?: string;
  warmupLimit?: number;
  repliesToday?: number;
  bouncesToday?: number;
  dueReminders?: number;
}

export interface Contact {
  id: string;
  email: string;
  name: string;
  company: string;
  status: PipelineStatus | 'bad email';
  tags: string[];
  firstContactedAt: string;
  lastContactedAt: string;
  lastContactedByUserId: string;
  ownerUserId?: string; // exclusive contact ownership
  ownerUserName?: string;
  notesCount?: number;
  phone?: string;
  linkedin?: string;
  dealSize?: string;
  isBadEmail?: boolean;
  bounceReason?: string;
  reminderCount?: number; // max 3 automated reminders
  createdAt?: string;
  updatedAt?: string;
}

export interface AttachmentMetadata {
  id: string;
  messageId?: string;
  filename: string;
  mimeType: string;
  size: number;
  gmailAttachmentId: string;
  partId?: string;
  isExecutableBlocked?: boolean;
}

export interface Message {
  id: string;
  accountId: string; // which mailbox this message belongs to
  threadId: string;
  contactId: string;
  direction: 'inbound' | 'outbound';
  fromEmail: string;
  fromName: string;
  toEmail: string;
  ccEmail?: string;
  bccEmail?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  sentAt: string;
  sentByUserId?: string; // Which teammate sent it
  isAutoReply?: boolean;
  isBounce?: boolean;
  attachments?: AttachmentMetadata[];
}

export interface Thread {
  id: string;
  accountId: string; // which mailbox owns this thread
  gmailThreadId: string;
  subject: string;
  snippet: string;
  lastMessageAt: string;
  unread: boolean; // per-user state in client
  assignedToUserId: string;
  starred: boolean;
  archived?: boolean;
  status?: 'open' | 'waiting' | 'resolved' | 'archived';
  contactEmail: string;
  contactName: string;
  contactCompany: string;
  ownerUserId?: string; // Mailbox owner
  ownerName?: string;
  ownerInitials?: string;
  ownerColor?: string;
}

export interface ThreadUserState {
  userId: string;
  threadId: string;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  lastReadAt?: string;
}

export interface InternalNote {
  id: string;
  contactId: string;
  threadId?: string;
  userId: string;
  userName: string;
  userColor: string;
  content: string;
  createdAt: string;
}

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  connectedEmail: string;
  isConnected: boolean;
  lastSyncedAt: string;
  isMockMode: boolean;
  backfillDays: 30 | 60 | 90;
  syncLabel?: string;
  syncInboxSentOnly: boolean;
  maxDbSizeBytes: number;
  dbSizeBytes: number;
  dbSizeWarnedAt?: string;
}

export interface GmailIgnoreRule {
  id: string;
  ruleType: 'email' | 'domain';
  value: string;
  reason: string;
  createdBy?: string;
  createdAt: string;
}

export interface DoNotContactEntry {
  id: string;
  type: 'email' | 'domain';
  value: string;
  reason: string;
  source: 'auto_opt_out' | 'manual' | 'not_interested_action';
  createdByUserId?: string;
  createdByName?: string;
  createdAt: string;
}

export interface DraftAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  file?: File;
}

export interface Draft {
  id: string;
  userId: string;
  threadId?: string | null;
  toEmail: string;
  ccEmail: string;
  bccEmail: string;
  subject: string;
  body: string;
  attachments?: DraftAttachment[];
  updatedAt: string;
}

export interface Reminder {
  id: string;
  threadId: string;
  contactId?: string;
  userId: string;
  dueAt: string;
  note: string;
  status: 'pending' | 'completed' | 'dismissed' | 'auto_cancelled';
  createdAt: string;
  threadSubject?: string;
  contactName?: string;
}

export interface Snippet {
  id: string;
  userId: string;
  title: string;
  body: string;
  shortcut?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Signature {
  id: string;
  userId: string;
  title: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: number;
  userId?: string;
  userName?: string;
  action: string;
  target?: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  type: 'email_inbound' | 'email_outbound' | 'stage_change' | 'note' | 'assignment' | 'reminder';
  title: string;
  description: string;
  timestamp: string;
  userName?: string;
  userColor?: string;
}

export interface StorageStats {
  totalBytes: number;
  maxBytes: number;
  usagePercent: number;
  isWarning: boolean;
}

export interface RecoveryCode {
  id: string;
  userId: string;
  codeHash: string;
  usedAt?: string;
  createdAt: string;
}

export interface AccountTodayStats {
  id: string;
  ownerUserId: string;
  ownerName?: string;
  ownerInitials?: string;
  ownerColor?: string;
  email: string;
  status: GmailAccountStatus;
  pauseReason?: string;
  sentToday: number;
  dailyCap: number;
  warmupLimit: number;
  warmupStartedAt: string;
  warmupOverride: boolean;
  repliesToday: number;
  bouncesToday: number;
  dueReminders: number;
  warmupWeek?: number;
}

export interface TodayDashboardStats {
  teamTotals: {
    sentToday: number;
    repliesToday: number;
    bouncesToday: number;
    dueReminders: number;
  };
  accounts: AccountTodayStats[];
}

export interface DeliverabilityWarning {
  type: 'link_count' | 'first_email_attachment' | 'spam_words';
  message: string;
}
