'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  User, 
  Contact, 
  Thread, 
  Message, 
  InternalNote, 
  GmailConfig, 
  GmailAccount,
  DoNotContactEntry,
  TodayDashboardStats,
  PipelineStatus 
} from '@/types';
import { createClient } from '@/lib/supabase/client';
import { getTeamMembersAction, getCurrentUserAction } from './actions/team';
import { getContactsAction, updateContactStatusAction, addContactNoteAction } from './actions/contacts';
import { 
  searchCrmThreadsAction, 
  loadThreadMessagesLazyAction, 
  toggleThreadStarAction, 
  markThreadReadAction, 
  assignThreadAction,
  SearchResultThread 
} from './actions/search';
import { getGmailAccountsAction, updateDailyCapAction } from './actions/mailboxes';
import { getDoNotContactListAction, addToDoNotContactAction, removeFromDoNotContactAction } from './actions/do-not-contact';
import { sendOutreachOrReplyAction } from './actions/sending';
import { calculateWarmupDailyCap } from './deliverability';

interface AppContextType {
  users: User[];
  currentUser: User;
  authenticatedUser: User | null;
  logout: () => Promise<void>;
  contacts: Contact[];
  threads: Thread[];
  messages: Message[];
  notes: InternalNote[];
  gmailConfig: GmailConfig;
  gmailAccounts: GmailAccount[];
  doNotContactList: DoNotContactEntry[];
  selectedThreadId: string | null;
  setSelectedThreadId: (id: string | null) => void;
  selectedContactId: string | null;
  setSelectedContactId: (id: string | null) => void;
  activeView: 'inbox' | 'sent' | 'contacts' | 'settings' | 'archived' | 'today';
  setActiveView: (view: 'inbox' | 'sent' | 'contacts' | 'settings' | 'archived' | 'today') => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  mineEveryoneFilter: 'mine' | 'everyone';
  setMineEveryoneFilter: (filter: 'mine' | 'everyone') => void;
  activeAccountIdFilter: string;
  setActiveAccountIdFilter: (id: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  isLoadingThreads: boolean;
  hasMoreThreads: boolean;
  loadMoreThreads: () => Promise<void>;
  dueRemindersCount: number;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  
  // Actions
  sendReply: (threadId: string, body: string) => Promise<{ success: boolean; error?: string }>;
  composeEmail: (
    toEmail: string, 
    toName: string, 
    company: string, 
    subject: string, 
    body: string,
    adminOverride?: boolean
  ) => Promise<{ success: boolean; error?: string; collision?: any }>;
  updateContactStatus: (contactId: string, status: PipelineStatus) => Promise<void>;
  addInternalNote: (contactId: string, content: string) => Promise<void>;
  toggleStar: (threadId: string) => Promise<void>;
  assignThread: (threadId: string, userId: string) => Promise<void>;
  markThreadRead: (threadId: string) => Promise<void>;
  markThreadNotInterested: (threadId: string) => Promise<void>;
  addToDnc: (value: string, type: 'email' | 'domain', reason: string) => Promise<void>;
  removeFromDnc: (id: string) => Promise<void>;
  updateAccountCap: (accountId: string, newCap: number, warmupOverride?: boolean) => Promise<void>;
  syncGmail: () => Promise<void>;
  updateGmailConfig: (newConfig: Partial<GmailConfig>) => void;
  isSyncing: boolean;
  activeCollaborator: User | null;
  todayStats: TodayDashboardStats;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const DEFAULT_USER: User = {
  id: '',
  name: 'Loading...',
  email: '',
  role: 'Teammate',
  systemRole: 'member',
  color: 'bg-[#0A84FF]',
  initials: '..',
  isActive: true,
};

const DEFAULT_GMAIL_CONFIG: GmailConfig = {
  clientId: '',
  clientSecret: '',
  refreshToken: '',
  connectedEmail: '',
  isConnected: false,
  lastSyncedAt: new Date().toISOString(),
  isMockMode: false,
  backfillDays: 60,
  syncInboxSentOnly: true,
  maxDbSizeBytes: 524288000,
  dbSizeBytes: 0,
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [users, setUsers] = useState<User[]>([]);
  const [authenticatedUser, setAuthenticatedUser] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<User>(DEFAULT_USER);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [gmailConfig, setGmailConfig] = useState<GmailConfig>(DEFAULT_GMAIL_CONFIG);
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccount[]>([]);
  const [doNotContactList, setDoNotContactList] = useState<DoNotContactEntry[]>([]);
  
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'inbox' | 'sent' | 'contacts' | 'settings' | 'archived' | 'today'>('inbox');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [mineEveryoneFilter, setMineEveryoneFilter] = useState<'mine' | 'everyone'>('everyone');
  const [activeAccountIdFilter, setActiveAccountIdFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoadingThreads, setIsLoadingThreads] = useState<boolean>(true);
  const [hasMoreThreads, setHasMoreThreads] = useState<boolean>(false);
  const [threadPage, setThreadPage] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [activeCollaborator, setActiveCollaborator] = useState<User | null>(null);
  const [dueRemindersCount, setDueRemindersCount] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Convert SearchResultThread to Thread format
  const mapSearchThread = useCallback((st: SearchResultThread): Thread => {
    return {
      id: st.id,
      accountId: '',
      gmailThreadId: st.id,
      subject: st.subject || '(No Subject)',
      snippet: st.snippet || '',
      lastMessageAt: st.lastMessageAt || new Date().toISOString(),
      unread: st.unread,
      assignedToUserId: st.assignedToUserId,
      starred: st.starred,
      contactEmail: st.contactEmail,
      contactName: st.contactName,
      contactCompany: st.contactCompany,
    };
  }, []);

  // Fetch initial data from Supabase
  const loadInitialData = useCallback(async () => {
    setIsLoadingThreads(true);
    try {
      const [currUser, teamList, accounts, contactList, dncList, searchRes] = await Promise.all([
        getCurrentUserAction(),
        getTeamMembersAction(),
        getGmailAccountsAction(),
        getContactsAction(),
        getDoNotContactListAction(),
        searchCrmThreadsAction('', 0, 30),
      ]);

      if (currUser) {
        setCurrentUser(currUser);
        setAuthenticatedUser(currUser);
      }

      setUsers(teamList);
      setGmailAccounts(accounts);
      setContacts(contactList);
      setDoNotContactList(dncList);

      const mappedThreads = searchRes.threads.map(mapSearchThread);
      setThreads(mappedThreads);
      setHasMoreThreads(searchRes.hasMore);
      setThreadPage(0);

      if (mappedThreads.length > 0 && !selectedThreadId) {
        setSelectedThreadId(mappedThreads[0].id);
      }
    } catch (err) {
      console.error('Error loading initial data from Supabase:', err);
    } finally {
      setIsLoadingThreads(false);
    }
  }, [mapSearchThread, selectedThreadId]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Debounced Search using Postgres FTS
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      setIsLoadingThreads(true);
      try {
        const searchRes = await searchCrmThreadsAction(searchQuery, 0, 30);
        const mapped = searchRes.threads.map(mapSearchThread);
        setThreads(mapped);
        setHasMoreThreads(searchRes.hasMore);
        setThreadPage(0);
        if (mapped.length > 0 && !selectedThreadId) {
          setSelectedThreadId(mapped[0].id);
        }
      } catch (err) {
        console.error('Failed to execute debounced search:', err);
      } finally {
        setIsLoadingThreads(false);
      }
    }, 300);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery, mapSearchThread, selectedThreadId]);

  // Load more threads (pagination: 30 items per page)
  const loadMoreThreads = async () => {
    if (!hasMoreThreads || isLoadingThreads) return;

    const nextPage = threadPage + 1;
    try {
      const res = await searchCrmThreadsAction(searchQuery, nextPage, 30);
      const newThreads = res.threads.map(mapSearchThread);
      setThreads(prev => [...prev, ...newThreads]);
      setHasMoreThreads(res.hasMore);
      setThreadPage(nextPage);
    } catch (err) {
      console.error('Error loading more threads:', err);
    }
  };

  // Lazy load message bodies only when a thread is selected
  useEffect(() => {
    if (!selectedThreadId) return;

    let isCancelled = false;
    async function fetchThreadMessages() {
      try {
        const res = await loadThreadMessagesLazyAction(selectedThreadId!);
        if (res.success && res.messages && !isCancelled) {
          const mapped: Message[] = res.messages.map((m: any) => ({
            id: m.id,
            accountId: m.account_id || '',
            threadId: m.thread_id,
            contactId: m.contact_id || '',
            direction: m.direction as 'inbound' | 'outbound',
            fromEmail: m.from_email || '',
            fromName: m.from_name || '',
            toEmail: m.to_email || '',
            ccEmail: m.cc_email || undefined,
            bccEmail: m.bcc_email || undefined,
            subject: m.subject || '',
            body: m.body_text || '',
            bodyHtml: m.body_html || undefined,
            sentAt: m.sent_at,
            sentByUserId: m.sent_by_user_id || undefined,
            attachments: (m.attachments || []).map((att: any) => ({
              id: att.id,
              filename: att.filename,
              mimeType: att.mime_type,
              size: Number(att.size) || 0,
              gmailAttachmentId: att.gmail_attachment_id
            }))
          }));
          setMessages(mapped);
        }
      } catch (err) {
        console.warn('Error lazy loading thread messages:', err);
      }
    }

    fetchThreadMessages();
    return () => {
      isCancelled = true;
    };
  }, [selectedThreadId]);

  // Logout handler
  const logout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Sign out error:', err);
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  // Calculate Today Dashboard Stats
  const todayStats: TodayDashboardStats = {
    teamTotals: {
      sentToday: gmailAccounts.reduce((sum, acc) => sum + (acc.sentToday || 0), 0),
      repliesToday: gmailAccounts.reduce((sum, acc) => sum + (acc.repliesToday || 0), 0),
      bouncesToday: gmailAccounts.reduce((sum, acc) => sum + (acc.bouncesToday || 0), 0),
      dueReminders: dueRemindersCount
    },
    accounts: gmailAccounts.map(acc => {
      const warmup = calculateWarmupDailyCap(acc.warmupStartedAt, acc.dailyCap, acc.warmupOverride);
      return {
        ...acc,
        warmupLimit: warmup.allowedCap,
        warmupWeek: warmup.weekNumber,
        dueReminders: acc.dueReminders || 0,
        repliesToday: acc.repliesToday || 0,
        bouncesToday: acc.bouncesToday || 0,
      };
    })
  };

  const currentUserAccount = gmailAccounts.find(a => a.ownerUserId === currentUser.id) || gmailAccounts[0] || {
    id: '',
    ownerUserId: currentUser.id,
    email: currentUser.email || 'user@ourteam.io',
    status: 'active' as const,
    dailyCap: 5,
    sentToday: 0,
    warmupStartedAt: new Date().toISOString(),
    warmupOverride: false,
  };

  // Send Reply on existing thread
  const sendReply = async (threadId: string, body: string): Promise<{ success: boolean; error?: string }> => {
    const thread = threads.find(t => t.id === threadId);
    if (!thread) return { success: false, error: 'Thread not found' };

    const account = gmailAccounts.find(a => a.id === thread.accountId) || currentUserAccount;

    const res = await sendOutreachOrReplyAction({
      accountId: account.id,
      toEmail: thread.contactEmail,
      toName: thread.contactName,
      company: thread.contactCompany,
      subject: thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`,
      body,
      threadId,
      isReply: true,
      idempotencyKey: `reply-${threadId}-${Date.now()}`
    });

    if (res.success) {
      // Re-fetch thread messages
      const updatedMessages = await loadThreadMessagesLazyAction(threadId);
      if (updatedMessages.success && updatedMessages.messages) {
        setMessages(updatedMessages.messages as any);
      }
    }

    return { success: res.success, error: res.error };
  };

  // Compose new outreach
  const composeEmail = async (
    toEmail: string,
    toName: string,
    company: string,
    subject: string,
    body: string,
    adminOverride?: boolean
  ): Promise<{ success: boolean; error?: string; collision?: any }> => {
    const account = currentUserAccount;
    if (!account.id) {
      return { success: false, error: 'No active personal Gmail mailbox connected.' };
    }

    const res = await sendOutreachOrReplyAction({
      accountId: account.id,
      toEmail,
      toName,
      company,
      subject,
      body,
      isReply: false,
      adminOverride,
      idempotencyKey: `compose-${Date.now()}`
    });

    if (res.success) {
      // Refresh threads
      const searchRes = await searchCrmThreadsAction('', 0, 30);
      setThreads(searchRes.threads.map(mapSearchThread));
    }

    return { 
      success: res.success, 
      error: res.error, 
      collision: res.collisionWarning 
    };
  };

  // Update contact status
  const updateContactStatus = async (contactId: string, status: PipelineStatus) => {
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, status } : c));
    await updateContactStatusAction(contactId, status);
  };

  // Add internal note
  const addInternalNote = async (contactId: string, content: string) => {
    await addContactNoteAction(contactId, content);
  };

  // Toggle star
  const toggleStar = async (threadId: string) => {
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, starred: !t.starred } : t));
    await toggleThreadStarAction(threadId);
  };

  // Assign thread
  const assignThread = async (threadId: string, userId: string) => {
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, assignedToUserId: userId } : t));
    await assignThreadAction(threadId, userId);
  };

  // Mark thread read
  const markThreadRead = async (threadId: string) => {
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, unread: false } : t));
    await markThreadReadAction(threadId, true);
  };

  // Mark thread not interested / DNC
  const markThreadNotInterested = async (threadId: string) => {
    const thread = threads.find(t => t.id === threadId);
    if (!thread) return;

    await addToDoNotContactAction({
      type: 'email',
      value: thread.contactEmail,
      reason: 'Marked not interested / auto-opt out',
      source: 'not_interested_action'
    });

    const updatedDnc = await getDoNotContactListAction();
    setDoNotContactList(updatedDnc);
  };

  // Add to DNC
  const addToDnc = async (value: string, type: 'email' | 'domain', reason: string) => {
    await addToDoNotContactAction({ value, type, reason, source: 'manual' });
    const updated = await getDoNotContactListAction();
    setDoNotContactList(updated);
  };

  // Remove from DNC
  const removeFromDnc = async (id: string) => {
    await removeFromDoNotContactAction(id);
    const updated = await getDoNotContactListAction();
    setDoNotContactList(updated);
  };

  // Update account daily cap
  const updateAccountCap = async (accountId: string, newCap: number, warmupOverride?: boolean) => {
    await updateDailyCapAction(accountId, newCap, warmupOverride);
    const updated = await getGmailAccountsAction();
    setGmailAccounts(updated);
  };

  // Sync Gmail
  const syncGmail = async () => {
    setIsSyncing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      // Refresh mailbox and thread states
      const [accounts, searchRes] = await Promise.all([
        getGmailAccountsAction(),
        searchCrmThreadsAction(searchQuery, 0, 30)
      ]);
      setGmailAccounts(accounts);
      setThreads(searchRes.threads.map(mapSearchThread));
    } catch (err) {
      console.warn('Sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const updateGmailConfig = (newConfig: Partial<GmailConfig>) => {
    setGmailConfig(prev => ({ ...prev, ...newConfig }));
  };

  return (
    <AppContext.Provider
      value={{
        users,
        currentUser,
        authenticatedUser,
        logout,
        contacts,
        threads,
        messages,
        notes,
        gmailConfig,
        gmailAccounts,
        doNotContactList,
        selectedThreadId,
        setSelectedThreadId,
        selectedContactId,
        setSelectedContactId,
        activeView,
        setActiveView,
        statusFilter,
        setStatusFilter,
        mineEveryoneFilter,
        setMineEveryoneFilter,
        activeAccountIdFilter,
        setActiveAccountIdFilter,
        searchQuery,
        setSearchQuery,
        isLoadingThreads,
        hasMoreThreads,
        loadMoreThreads,
        dueRemindersCount,
        soundEnabled,
        setSoundEnabled,
        sendReply,
        composeEmail,
        updateContactStatus,
        addInternalNote,
        toggleStar,
        assignThread,
        markThreadRead,
        markThreadNotInterested,
        addToDnc,
        removeFromDnc,
        updateAccountCap,
        syncGmail,
        updateGmailConfig,
        isSyncing,
        activeCollaborator,
        todayStats
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
