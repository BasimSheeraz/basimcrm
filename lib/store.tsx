'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  PipelineStatus,
  TeammateStatus,
  PresencePayload,
  TeammatePresenceInfo
} from '@/types';
import { createClient } from '@/lib/supabase/client';
import { getTeamMembersAction, getCurrentUserAction, logAuthEventAction } from './actions/team';
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
import { formatLastSeen } from './presence';

interface AppContextType {
  users: User[];
  currentUser: User;
  authenticatedUser: User | null;
  isAuthLoading: boolean;
  authError: string | null;
  reloadAuth: () => Promise<void>;
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
  activeView: 'inbox' | 'sent' | 'contacts' | 'prospects' | 'settings' | 'archived' | 'today';
  setActiveView: (view: 'inbox' | 'sent' | 'contacts' | 'prospects' | 'settings' | 'archived' | 'today') => void;
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
  
  // Real Presence & Collaboration
  teammatePresences: TeammatePresenceInfo[];
  activeCollaborator: User | null;
  activeCollaborators: TeammatePresenceInfo[];
  isReplying: boolean;
  setIsReplying: (replying: boolean) => void;
  isComposeOpen: boolean;
  setIsComposeOpen: (open: boolean) => void;
  activeProspectId: string | null;
  setActiveProspectId: (id: string | null) => void;
  activeProspectKey: string | null;
  setActiveProspectKey: (key: string | null) => void;

  // Actions
  sendReply: (threadId: string, body: string) => Promise<{ success: boolean; error?: string }>;
  composeEmail: (
    toEmail: string, 
    toName: string, 
    company: string, 
    subject: string, 
    body: string,
    adminOverride?: boolean,
    prospectId?: string
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
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [gmailConfig, setGmailConfig] = useState<GmailConfig>(DEFAULT_GMAIL_CONFIG);
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccount[]>([]);
  const [doNotContactList, setDoNotContactList] = useState<DoNotContactEntry[]>([]);
  
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'inbox' | 'sent' | 'contacts' | 'prospects' | 'settings' | 'archived' | 'today'>('inbox');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [mineEveryoneFilter, setMineEveryoneFilter] = useState<'mine' | 'everyone'>('everyone');
  const [activeAccountIdFilter, setActiveAccountIdFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoadingThreads, setIsLoadingThreads] = useState<boolean>(true);
  const [hasMoreThreads, setHasMoreThreads] = useState<boolean>(false);
  const [threadPage, setThreadPage] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [dueRemindersCount, setDueRemindersCount] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Presence state
  const [presenceStateMap, setPresenceStateMap] = useState<Record<string, PresencePayload[]>>({});
  const [isIdle, setIsIdle] = useState<boolean>(false);
  const [isReplying, setIsReplying] = useState<boolean>(false);
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);
  const [activeProspectId, setActiveProspectId] = useState<string | null>(null);
  const [activeProspectKey, setActiveProspectKey] = useState<string | null>(null);

  const presenceChannelRef = useRef<any>(null);
  const lastPersistTimeRef = useRef<number>(0);
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
    setIsAuthLoading(true);
    setAuthError(null);

    // Watchdog: Max 3 seconds for loading, then show error state with retry
    const watchdogTimer = setTimeout(() => {
      setIsAuthLoading(prev => {
        if (prev) {
          setAuthError('Connection timed out while loading user profile.');
        }
        return false;
      });
    }, 3000);

    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();

      if (!authData?.user) {
        clearTimeout(watchdogTimer);
        setIsAuthLoading(false);
        router.push('/login');
        return;
      }

      // Read current user
      let currUser = await getCurrentUserAction();
      if (!currUser) {
        // Fallback: Query directly from team_members
        const { data: tm } = await supabase
          .from('team_members')
          .select('*')
          .eq('id', authData.user.id)
          .single();

        if (tm) {
          const initials = tm.name
            .split(' ')
            .map((p: string) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || 'TM';

          currUser = {
            id: tm.id,
            name: tm.name,
            email: tm.email,
            role: tm.role === 'admin' ? 'Lead & Business Development (admin)' : 'Outreach & Partnerships',
            systemRole: tm.role as 'admin' | 'member',
            color: tm.avatar_color ? `bg-[${tm.avatar_color}]` : 'bg-[#0A84FF]',
            initials,
            isActive: tm.is_active !== false,
            createdAt: tm.created_at,
            lastSeenAt: tm.last_seen_at
          };
        }
      }

      if (!currUser) {
        clearTimeout(watchdogTimer);
        setAuthError('Your team account could not be found.');
        setIsAuthLoading(false);
        return;
      }

      setCurrentUser(currUser);
      setAuthenticatedUser(currUser);

      const [teamList, accounts, contactList, dncList, searchRes] = await Promise.all([
        getTeamMembersAction(),
        getGmailAccountsAction(),
        getContactsAction(),
        getDoNotContactListAction(),
        searchCrmThreadsAction('', 0, 30),
      ]);

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

      clearTimeout(watchdogTimer);
      setIsAuthLoading(false);
      setAuthError(null);
    } catch (err: any) {
      console.error('Error loading initial data from Supabase:', err);
      clearTimeout(watchdogTimer);
      setAuthError(err?.message || 'Failed to load team data.');
      setIsAuthLoading(false);
    } finally {
      setIsLoadingThreads(false);
    }
  }, [mapSearchThread, selectedThreadId, router]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Auth State Listener
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setCurrentUser(DEFAULT_USER);
        setAuthenticatedUser(null);
        router.push('/login');
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        loadInitialData();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router, loadInitialData]);

  // Compute Current Activity String
  const currentActivityText = useMemo(() => {
    if (isComposeOpen) {
      return 'Writing new outreach';
    }
    if (isReplying && selectedThreadId) {
      const currentThread = threads.find(t => t.id === selectedThreadId);
      const targetName = currentThread?.contactName || currentThread?.contactEmail || 'contact';
      return `Replying to ${targetName}`;
    }
    if (selectedThreadId) {
      const currentThread = threads.find(t => t.id === selectedThreadId);
      const subject = currentThread?.subject || '(No Subject)';
      return `Viewing: ${subject}`;
    }
    return 'Browsing inbox';
  }, [isComposeOpen, isReplying, selectedThreadId, threads]);

  const latestPresenceRef = useRef({
    isIdle,
    selectedThreadId,
    activeProspectId,
    activeProspectKey,
    currentActivityText
  });
  latestPresenceRef.current = {
    isIdle,
    selectedThreadId,
    activeProspectId,
    activeProspectKey,
    currentActivityText
  };

  const persistLastSeen = useCallback(async () => {
    if (!currentUser || !currentUser.id) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('update_my_last_seen');
      if (error) {
        await supabase
          .from('team_members')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', currentUser.id);
      }
    } catch {}
  }, [currentUser]);

  // Supabase Realtime Presence Channel
  useEffect(() => {
    if (!currentUser || !currentUser.id) return;

    const supabase = createClient();
    const channel = supabase.channel('team-presence', {
      config: {
        presence: { key: currentUser.id }
      }
    });

    presenceChannelRef.current = channel;

    channel.on('presence', { event: 'sync' }, () => {
      const rawState = channel.presenceState() as Record<string, PresencePayload[]>;
      setPresenceStateMap(rawState);
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          const current = latestPresenceRef.current;
          await channel.track({
            user_id: currentUser.id,
            name: currentUser.name,
            email: currentUser.email,
            avatar_color: currentUser.color,
            initials: currentUser.initials,
            status: current.isIdle ? 'idle' : 'online',
            current_thread_id: current.selectedThreadId,
            current_prospect_id: current.activeProspectId,
            current_prospect_key: current.activeProspectKey,
            current_activity: current.currentActivityText,
            last_active_at: new Date().toISOString()
          });
        } catch (e) {
          console.warn('Presence track error:', e);
        }
      }
    });

    return () => {
      try {
        channel.untrack().catch(() => {});
        channel.unsubscribe();
      } catch {}
      presenceChannelRef.current = null;
    };
  }, [currentUser.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update Presence on Activity / Thread / Prospect / Idle change
  useEffect(() => {
    const channel = presenceChannelRef.current;
    if (!channel || !currentUser || !currentUser.id) return;

    channel.track({
      user_id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      avatar_color: currentUser.color,
      initials: currentUser.initials,
      status: isIdle ? 'idle' : 'online',
      current_thread_id: selectedThreadId,
      current_prospect_id: activeProspectId,
      current_prospect_key: activeProspectKey,
      current_activity: currentActivityText,
      last_active_at: new Date().toISOString()
    }).catch(() => {});

    // Update database last_seen_at at most once every 60 seconds
    const now = Date.now();
    if (now - lastPersistTimeRef.current > 60000) {
      lastPersistTimeRef.current = now;
      persistLastSeen();
    }
  }, [isIdle, selectedThreadId, activeProspectId, activeProspectKey, currentActivityText, currentUser, persistLastSeen]);

  // 30-Second Presence Heartbeat
  useEffect(() => {
    const heartbeatTimer = setInterval(() => {
      const channel = presenceChannelRef.current;
      if (!channel || !currentUser || !currentUser.id) return;

      channel.track({
        user_id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        avatar_color: currentUser.color,
        initials: currentUser.initials,
        status: isIdle ? 'idle' : 'online',
        current_thread_id: selectedThreadId,
        current_prospect_id: activeProspectId,
        current_prospect_key: activeProspectKey,
        current_activity: currentActivityText,
        last_active_at: new Date().toISOString()
      }).catch(() => {});

      // Check last_seen persist
      const now = Date.now();
      if (now - lastPersistTimeRef.current > 60000) {
        lastPersistTimeRef.current = now;
        persistLastSeen();
      }
    }, 30000);

    return () => clearInterval(heartbeatTimer);
  }, [currentUser, isIdle, selectedThreadId, activeProspectId, activeProspectKey, currentActivityText, persistLastSeen]);

  // Idle Tracking (5 minutes of inactivity or tab hidden)
  useEffect(() => {
    let idleTimer: NodeJS.Timeout;

    const onUserInteraction = () => {
      if (document.visibilityState === 'hidden') {
        setIsIdle(true);
        return;
      }
      setIsIdle(false);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        setIsIdle(true);
      }, 5 * 60 * 1000);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setIsIdle(true);
      } else {
        onUserInteraction();
      }
    };

    window.addEventListener('mousemove', onUserInteraction, { passive: true });
    window.addEventListener('keydown', onUserInteraction, { passive: true });
    window.addEventListener('mousedown', onUserInteraction, { passive: true });
    window.addEventListener('touchstart', onUserInteraction, { passive: true });
    window.addEventListener('scroll', onUserInteraction, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    onUserInteraction();

    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener('mousemove', onUserInteraction);
      window.removeEventListener('keydown', onUserInteraction);
      window.removeEventListener('mousedown', onUserInteraction);
      window.removeEventListener('touchstart', onUserInteraction);
      window.removeEventListener('scroll', onUserInteraction);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Untrack on tab close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (presenceChannelRef.current) {
        try {
          presenceChannelRef.current.untrack().catch(() => {});
        } catch {}
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Compute merged Teammate Presences (handles multiple tabs, highest activity wins)
  const teammatePresences: TeammatePresenceInfo[] = useMemo(() => {
    return users.map(user => {
      const rawList = presenceStateMap[user.id] || [];
      const gmailAcc = gmailAccounts.find(a => a.ownerUserId === user.id);
      const sentToday = gmailAcc?.sentToday || 0;
      const dailyCap = gmailAcc?.dailyCap || 5;

      if (rawList.length === 0) {
        return {
          ...user,
          status: 'offline' as TeammateStatus,
          currentActivity: user.lastSeenAt ? `Last seen ${formatLastSeen(user.lastSeenAt)}` : 'Offline',
          currentThreadId: null,
          lastActiveAt: user.lastSeenAt || user.createdAt || new Date().toISOString(),
          sentToday,
          dailyCap
        };
      }

      // Merge multiple tabs for the same user
      // 1. Status: online > idle
      const isOnline = rawList.some(p => p.status === 'online');
      const status: TeammateStatus = isOnline ? 'online' : 'idle';

      // 2. Activity: Replying > Writing > Viewing > Browsing
      let bestPayload = rawList[0];
      const activityScore = (act?: string) => {
        if (!act) return 0;
        if (act.startsWith('Replying')) return 4;
        if (act.startsWith('Writing')) return 3;
        if (act.startsWith('Viewing')) return 2;
        return 1;
      };

      for (const p of rawList) {
        if (activityScore(p.current_activity) > activityScore(bestPayload.current_activity)) {
          bestPayload = p;
        }
      }

      return {
        ...user,
        status,
        currentActivity: bestPayload.current_activity || 'Online',
        currentThreadId: bestPayload.current_thread_id || null,
        currentProspectId: bestPayload.current_prospect_id || null,
        currentProspectKey: bestPayload.current_prospect_key || null,
        lastActiveAt: bestPayload.last_active_at || new Date().toISOString(),
        sentToday,
        dailyCap
      };
    });
  }, [users, presenceStateMap, gmailAccounts]);

  // Active Collaborators on selected thread (Collision Guard)
  const activeCollaborators: TeammatePresenceInfo[] = useMemo(() => {
    if (!selectedThreadId) return [];
    return teammatePresences.filter(
      t => t.id !== currentUser.id && t.currentThreadId === selectedThreadId && t.status !== 'offline'
    );
  }, [selectedThreadId, teammatePresences, currentUser.id]);

  const activeCollaborator: User | null = activeCollaborators.length > 0 ? activeCollaborators[0] : null;

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

  // Load more threads (pagination)
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
      if (presenceChannelRef.current) {
        try {
          await presenceChannelRef.current.untrack();
        } catch {}
      }

      await logAuthEventAction({
        action: 'auth.logout',
        userId: currentUser.id || undefined,
        email: currentUser.email || 'user@ourteam.io',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined
      });

      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Sign out error:', err);
    } finally {
      setCurrentUser(DEFAULT_USER);
      setAuthenticatedUser(null);
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
    adminOverride?: boolean,
    prospectId?: string
  ): Promise<{ success: boolean; error?: string; collision?: any }> => {
    const account = currentUserAccount;

    const res = await sendOutreachOrReplyAction({
      accountId: account.id || currentUser.id,
      toEmail,
      toName,
      company,
      subject,
      body,
      isReply: false,
      adminOverride,
      prospectId,
      idempotencyKey: `compose-${Date.now()}`
    });

    if (res.success) {
      const [updatedContacts, updatedAccounts, searchRes] = await Promise.all([
        getContactsAction(),
        getGmailAccountsAction(),
        searchCrmThreadsAction(searchQuery, 0, 30),
      ]);
      setContacts(updatedContacts);
      setGmailAccounts(updatedAccounts);
      setThreads(searchRes.threads.map(mapSearchThread));
    }

    return res;
  };

  const updateContactStatus = async (contactId: string, status: PipelineStatus) => {
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, status } : c));
    await updateContactStatusAction(contactId, status);
  };

  const addInternalNote = async (contactId: string, content: string) => {
    const res = await addContactNoteAction(contactId, content);
    if (res.success) {
      const newNote: InternalNote = {
        id: `note-${Date.now()}`,
        contactId,
        userId: currentUser.id,
        userName: currentUser.name,
        userColor: currentUser.color,
        content: content.trim(),
        createdAt: new Date().toISOString()
      };
      setNotes(prev => [newNote, ...prev]);
    }
  };

  const toggleStar = async (threadId: string) => {
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, starred: !t.starred } : t));
    await toggleThreadStarAction(threadId);
  };

  const assignThread = async (threadId: string, userId: string) => {
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, assignedToUserId: userId } : t));
    await assignThreadAction(threadId, userId);
  };

  const markThreadRead = async (threadId: string) => {
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, unread: false } : t));
    await markThreadReadAction(threadId);
  };

  const markThreadNotInterested = async (threadId: string) => {
    const thread = threads.find(t => t.id === threadId);
    if (thread) {
      const contact = contacts.find(c => c.email.toLowerCase() === thread.contactEmail.toLowerCase());
      if (contact) {
        await updateContactStatus(contact.id, 'Cold');
      }
    }
  };

  const addToDnc = async (value: string, type: 'email' | 'domain', reason: string) => {
    const res = await addToDoNotContactAction({ value, type, reason });
    if (res.success) {
      const dncList = await getDoNotContactListAction();
      setDoNotContactList(dncList);
    }
  };

  const removeFromDnc = async (id: string) => {
    setDoNotContactList(prev => prev.filter(e => e.id !== id));
    await removeFromDoNotContactAction(id);
  };

  const updateAccountCap = async (accountId: string, newCap: number, warmupOverride?: boolean) => {
    setGmailAccounts(prev => prev.map(a => a.id === accountId ? { ...a, dailyCap: newCap, warmupOverride: warmupOverride ?? a.warmupOverride } : a));
    await updateDailyCapAction(accountId, newCap, warmupOverride);
  };

  const syncGmail = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sync', { credentials: 'same-origin' });
      if (res.ok) {
        await loadInitialData();
      }
    } catch (err) {
      console.warn('Sync request failed:', err);
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
        isAuthLoading,
        authError,
        reloadAuth: loadInitialData,
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
        teammatePresences,
        activeCollaborator,
        activeCollaborators,
        isReplying,
        setIsReplying,
        isComposeOpen,
        setIsComposeOpen,
        activeProspectId,
        setActiveProspectId,
        activeProspectKey,
        setActiveProspectKey,
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
