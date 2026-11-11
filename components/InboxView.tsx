'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '@/lib/store';
import { 
  Search, 
  Star, 
  Send, 
  ShieldAlert, 
  ChevronLeft,
  ArrowUpRight,
  Plus,
  CheckCircle2,
  Inbox,
  Paperclip,
  Clock,
  Archive,
  Ban,
  FileText,
  AlertTriangle,
  Download,
  CornerUpLeft,
  Users,
  ShieldCheck,
  MailCheck
} from 'lucide-react';
import { PipelineStatus, AttachmentMetadata } from '@/types';
import { autosaveDraftAction, getDraftForThreadAction, deleteDraftAction } from '@/lib/actions/drafts';
import { markThreadNotALeadAction } from '@/lib/actions/sync';
import { createReminderAction } from '@/lib/actions/reminders';
import { interpolateSnippetVariables } from '@/lib/template';
import { isExecutableBlocked } from '@/lib/sanitize';
import { lintEmailDeliverability, calculateWarmupDailyCap } from '@/lib/deliverability';

export function InboxView() {
  const { 
    threads, 
    messages, 
    contacts, 
    users, 
    currentUser, 
    gmailAccounts,
    doNotContactList,
    selectedThreadId, 
    setSelectedThreadId, 
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
    sendReply,
    toggleStar,
    assignThread,
    markThreadRead,
    markThreadNotInterested,
    updateContactStatus,
    activeCollaborator,
    setSelectedContactId
  } = useApp();

  const [replyText, setReplyText] = useState('');
  const [showSentSuccess, setShowSentSuccess] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [ccEmail, setCcEmail] = useState('');
  const [bccEmail, setBccEmail] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; size: number }[]>([]);
  const [draftStatus, setDraftStatus] = useState<string>('');
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const composerMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const selectedThread = threads.find(t => t.id === selectedThreadId);

  // Keyboard shortcut listener: "/" focuses search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' && 
        document.activeElement?.tagName !== 'INPUT' && 
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close composer menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (composerMenuRef.current && !composerMenuRef.current.contains(e.target as Node)) {
        setComposerMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Restore draft when opening thread
  useEffect(() => {
    if (selectedThreadId) {
      getDraftForThreadAction(selectedThreadId).then(draft => {
        if (draft) {
          setReplyText(draft.body);
          if (draft.ccEmail) { setCcEmail(draft.ccEmail); setShowCc(true); }
          if (draft.bccEmail) { setBccEmail(draft.bccEmail); setShowBcc(true); }
          setDraftStatus('Restored draft');
          setTimeout(() => setDraftStatus(''), 3000);
        } else {
          setReplyText('');
          setCcEmail('');
          setBccEmail('');
          setShowCc(false);
          setShowBcc(false);
        }
      }).catch(() => {});
    }
  }, [selectedThreadId]);

  // Autosave draft every 3 seconds of typing
  useEffect(() => {
    if (!selectedThreadId || !replyText.trim()) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveDraftAction({
        threadId: selectedThreadId,
        toEmail: selectedThread?.contactEmail || '',
        ccEmail,
        bccEmail,
        subject: selectedThread?.subject || '',
        body: replyText
      }).then(() => {
        setDraftStatus('Draft saved');
        setTimeout(() => setDraftStatus(''), 2000);
      }).catch(() => {});
    }, 3000);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [replyText, ccEmail, bccEmail, selectedThreadId, selectedThread?.contactEmail, selectedThread?.subject]);

  // Combined Inbox Filtering
  const filteredThreads = threads.filter(t => {
    // 1. Account filter
    if (activeAccountIdFilter !== 'all' && t.accountId !== activeAccountIdFilter) {
      return false;
    }

    // 2. Mine vs Everyone filter
    if (mineEveryoneFilter === 'mine') {
      const threadAcc = gmailAccounts.find(a => a.id === t.accountId);
      const isMyAccount = threadAcc?.ownerUserId === currentUser.id;
      const isAssignedToMe = t.assignedToUserId === currentUser.id;
      if (!isMyAccount && !isAssignedToMe) return false;
    }

    // 3. Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchSubject = t.subject.toLowerCase().includes(q);
      const matchSnippet = t.snippet.toLowerCase().includes(q);
      const matchContact = t.contactName.toLowerCase().includes(q) || t.contactEmail.toLowerCase().includes(q);
      if (!matchSubject && !matchSnippet && !matchContact) return false;
    }

    // 4. Quick Filters
    if (statusFilter === 'assigned-to-me') {
      return t.assignedToUserId === currentUser.id;
    }
    if (statusFilter === 'starred') {
      return t.starred;
    }
    if (statusFilter === 'archived') {
      return t.archived;
    }
    if (statusFilter === 'followups-due') {
      return true;
    }
    if (statusFilter !== 'all') {
      const contact = contacts.find(c => c.email.toLowerCase() === t.contactEmail.toLowerCase());
      return contact?.status === statusFilter;
    }

    return true;
  });

  const selectedContact = selectedThread 
    ? contacts.find(c => c.email.toLowerCase() === selectedThread.contactEmail.toLowerCase())
    : null;
  const threadMessages = selectedThread 
    ? messages.filter(m => m.threadId === selectedThread.id)
    : [];

  const defaultAccount = {
    id: '',
    ownerUserId: currentUser.id,
    email: currentUser.email || 'user@ourteam.io',
    ownerName: currentUser.name || 'Teammate',
    status: 'active' as const,
    dailyCap: 5,
    sentToday: 0,
    warmupStartedAt: new Date().toISOString(),
    warmupOverride: false,
  };

  // Account that owns the selected thread
  const threadAccount = gmailAccounts.find(a => a.id === selectedThread?.accountId) || 
    gmailAccounts.find(a => a.ownerUserId === currentUser.id) || 
    gmailAccounts[0] ||
    defaultAccount;

  // Authorization check: only owner can send from this mailbox
  const isMailboxOwner = threadAccount?.ownerUserId === currentUser.id;

  // DNC check for this thread's contact
  const isDnc = Boolean(selectedContact && doNotContactList.some(d => 
    (d.type === 'email' && d.value.toLowerCase() === selectedContact.email.toLowerCase()) ||
    (d.type === 'domain' && d.value.toLowerCase() === (selectedContact.email.split('@')[1] || '').toLowerCase())
  ));

  // Deliverability warnings
  const deliverabilityWarnings = isMailboxOwner && selectedThread ? lintEmailDeliverability({
    subject: selectedThread.subject,
    body: replyText,
    hasAttachments: attachedFiles.length > 0,
    isFirstEmail: false // Replies are never first emails
  }) : [];

  const warmup = calculateWarmupDailyCap(threadAccount.warmupStartedAt, threadAccount.dailyCap, threadAccount.warmupOverride);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedThread || isSubmitting) return;

    if (!isMailboxOwner) {
      setActionError(`Forbidden: Only ${threadAccount.ownerName} can reply on this thread.`);
      return;
    }

    if (isDnc) {
      setActionError(`Cannot send: ${selectedThread.contactEmail} is on the Do Not Contact list.`);
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    const result = await sendReply(selectedThread.id, replyText);
    if (!result.success) {
      setActionError(result.error || 'Failed to send reply');
      setIsSubmitting(false);
      return;
    }

    await deleteDraftAction(selectedThread.id);

    setReplyText('');
    setAttachedFiles([]);
    setIsSubmitting(false);
    setShowSentSuccess(true);
    setTimeout(() => setShowSentSuccess(false), 3000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachmentError(null);
    if (!e.target.files) return;

    const files = Array.from(e.target.files);
    let totalSize = attachedFiles.reduce((acc, f) => acc + f.size, 0);

    for (const file of files) {
      if (isExecutableBlocked(file.name)) {
        setAttachmentError(`Executable file ${file.name} is blocked for security.`);
        return;
      }
      totalSize += file.size;
    }

    if (totalSize > 10 * 1024 * 1024) {
      setAttachmentError('Total attachments exceed maximum allowed size of 10 MB.');
      return;
    }

    setAttachedFiles(prev => [...prev, ...files.map(f => ({ name: f.name, size: f.size }))]);
  };

  const handleCreateReminder = async (days: number) => {
    if (!selectedThread) return;

    // Check maximum 3 automated reminders per contact
    if ((selectedContact?.reminderCount || 0) >= 3) {
      setActionError('Maximum 3 automated follow-up reminders allowed per contact.');
      return;
    }

    const due = new Date();
    due.setDate(due.getDate() + days);

    await createReminderAction({
      threadId: selectedThread.id,
      contactId: selectedContact?.id,
      dueAt: due.toISOString(),
      note: `Follow-up in ${days} days with ${selectedThread.contactName}`
    });

    setComposerMenuOpen(false);
    setShowSentSuccess(true);
    setTimeout(() => setShowSentSuccess(false), 3000);
  };

  const handleNotALead = async () => {
    if (!selectedThread) return;
    if (confirm(`Mark "${selectedThread.contactName}" as Not a Lead? This archives the thread and ignores future emails.`)) {
      await markThreadNotALeadAction(selectedThread.id, selectedThread.contactEmail);
      setSelectedThreadId(null);
    }
  };

  const handleNotInterested = () => {
    if (!selectedThread) return;
    if (confirm(`Mark "${selectedThread.contactName}" as Not Interested / Do Not Contact? This permanently blocks future outreach across all team mailboxes.`)) {
      markThreadNotInterested(selectedThread.id);
      setSelectedThreadId(null);
    }
  };

  const insertSnippet = (template: string) => {
    const interpolated = interpolateSnippetVariables(template, {
      name: selectedThread?.contactName,
      company: selectedThread?.contactCompany,
      email: selectedThread?.contactEmail
    });
    setReplyText(prev => prev ? `${prev}\n\n${interpolated}` : interpolated);
    setComposerMenuOpen(false);
  };

  const lineCount = Math.max(2, Math.min(6, (replyText.match(/\n/g) || []).length + 1));

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Thread List Pane */}
      <div className={`w-full md:w-[370px] lg:w-[390px] border-r border-white/[0.08] dark:border-white/[0.08] bg-white/[0.03] dark:bg-black/15 backdrop-blur-2xl flex flex-col shrink-0 select-none overflow-hidden ${
        selectedThreadId ? 'hidden md:flex' : 'flex'
      }`}>
        {/* Sticky Search & Multi-Mailbox Filter Row */}
        <div className="p-3 border-b border-white/[0.08] bg-white/[0.02] dark:bg-black/10 backdrop-blur-xl sticky top-0 z-10 space-y-2.5">
          {/* Combined Inbox Toggle & Account Filter */}
          <div className="flex items-center justify-between gap-2">
            {/* Mine / Everyone Switch */}
            <div className="flex items-center p-0.5 rounded-xl bg-white/[0.05] border border-white/10 text-xs">
              <button
                onClick={() => setMineEveryoneFilter('everyone')}
                className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                  mineEveryoneFilter === 'everyone'
                    ? 'bg-white/20 text-white font-semibold'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                Everyone
              </button>
              <button
                onClick={() => setMineEveryoneFilter('mine')}
                className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                  mineEveryoneFilter === 'mine'
                    ? 'bg-[#0A84FF] text-white font-semibold shadow-sm'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                Mine
              </button>
            </div>

            {/* Account Selector */}
            <select
              value={activeAccountIdFilter}
              onChange={(e) => setActiveAccountIdFilter(e.target.value)}
              className="text-[11.5px] px-2.5 py-1 rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.1] text-white/80 focus:outline-none cursor-pointer"
            >
              <option value="all" className="text-slate-900 bg-white">All 3 Mailboxes</option>
              {gmailAccounts.map(a => (
                <option key={a.id} value={a.id} className="text-slate-900 bg-white">
                  {a.ownerName} ({a.email.split('@')[0]})
                </option>
              ))}
            </select>
          </div>

          {/* Search bar */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-3.5 text-white/40 pointer-events-none" strokeWidth={1.75} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search emails, contacts, or subjects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/[0.05] hover:bg-white/[0.08] focus:bg-white/[0.1] text-[13px] rounded-2xl pl-9 pr-8 py-1.5 text-white/90 placeholder-white/40 border border-white/10 focus:border-[#0A84FF]/60 focus:outline-none transition-all shadow-sm"
            />
            {!searchQuery && (
              <span className="absolute right-3 px-1.5 py-0.5 rounded-md bg-white/10 text-[10px] font-mono text-white/40 border border-white/10 pointer-events-none">
                /
              </span>
            )}
          </div>

          {/* Filter Row */}
          <div className="flex items-center space-x-1.5 text-xs select-none">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors ${
                statusFilter === 'all'
                  ? 'bg-white/20 text-white font-semibold'
                  : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              All
            </button>

            <button
              onClick={() => setStatusFilter('starred')}
              className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors ${
                statusFilter === 'starred'
                  ? 'bg-white/20 text-white font-semibold'
                  : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              Starred
            </button>

            <div className="ml-auto">
              <select
                value={['Lead', 'Contacted', 'In Discussion', 'Meeting', 'Client', 'Cold'].includes(statusFilter) ? statusFilter : ''}
                onChange={(e) => setStatusFilter(e.target.value ? e.target.value as PipelineStatus : 'all')}
                className="px-2 py-1 rounded-full text-[11px] font-medium bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-white/80 focus:outline-none cursor-pointer"
              >
                <option value="" className="text-slate-900 bg-white">Stage: All</option>
                <option value="Lead" className="text-slate-900 bg-white">Lead</option>
                <option value="Contacted" className="text-slate-900 bg-white">Contacted</option>
                <option value="In Discussion" className="text-slate-900 bg-white">In Discussion</option>
                <option value="Meeting" className="text-slate-900 bg-white">Meeting</option>
                <option value="Client" className="text-slate-900 bg-white">Client</option>
                <option value="Cold" className="text-slate-900 bg-white">Cold</option>
              </select>
            </div>
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {isLoadingThreads && threads.length === 0 ? (
            <div className="p-3 space-y-2">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] animate-pulse space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="w-24 h-3 rounded bg-white/10" />
                    <div className="w-12 h-2.5 rounded bg-white/10" />
                  </div>
                  <div className="w-40 h-3 rounded bg-white/15" />
                  <div className="w-full h-2.5 rounded bg-white/10" />
                </div>
              ))}
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-8 text-center text-white/40 flex flex-col items-center justify-center h-full">
              <div className="w-10 h-10 rounded-2xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-white/40 mb-2">
                <Inbox className="w-5 h-5" strokeWidth={1.75} />
              </div>
              <p className="text-xs font-medium text-white/60">No conversations</p>
              <p className="text-[11px] text-white/40 mt-0.5">Try adjusting your mailbox filter or search query</p>
            </div>
          ) : (
            <>
              {filteredThreads.map(thread => {
                const isSelected = thread.id === selectedThreadId;
                const ownerAcc = gmailAccounts.find(a => a.id === thread.accountId);

                return (
                  <div
                    key={thread.id}
                    onClick={() => {
                      setSelectedThreadId(thread.id);
                      if (thread.unread) markThreadRead(thread.id);
                    }}
                    className={`p-3 rounded-xl cursor-pointer transition-colors duration-150 relative ${
                      isSelected 
                        ? 'bg-white/12 dark:bg-white/10 border border-white/15' 
                        : 'hover:bg-white/[0.05] border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <div className="flex items-center space-x-2 truncate">
                        {thread.unread && (
                          <span className="w-2 h-2 rounded-full bg-[#0A84FF] shrink-0 inline-block" />
                        )}
                        
                        <span className={`text-[13px] truncate ${
                          thread.unread 
                            ? 'font-bold text-white' 
                            : 'font-semibold text-white/90'
                        }`}>
                          {thread.contactName}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Mailbox Owner Avatar Pill */}
                        {ownerAcc && (
                          <span 
                            className={`w-4 h-4 rounded-full ${ownerAcc.ownerColor || 'bg-blue-600'} text-white flex items-center justify-center text-[8.5px] font-bold shrink-0 ring-1 ring-white/20`}
                            title={`Mailbox: ${ownerAcc.ownerName} (${ownerAcc.email})`}
                          >
                            {ownerAcc.ownerInitials || 'TM'}
                          </span>
                        )}

                        <span className="text-[11px] font-medium text-white/40">
                          {new Date(thread.lastMessageAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-white/80 font-medium truncate mb-0.5">
                      {thread.subject}
                    </div>

                    <p className="text-[11.5px] text-white/50 truncate font-sans">
                      {thread.snippet}
                    </p>
                  </div>
                );
              })}

              {hasMoreThreads && (
                <div className="p-3 text-center">
                  <button
                    onClick={() => loadMoreThreads()}
                    disabled={isLoadingThreads}
                    className="px-4 py-1.5 rounded-full text-xs font-medium bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white/80 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isLoadingThreads ? 'Loading more...' : 'Load more conversations'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail Pane */}
      {selectedThread ? (
        <div className="flex-1 flex flex-col bg-white/[0.02] dark:bg-black/25 backdrop-blur-3xl overflow-hidden">
          {/* Header */}
          <div className="p-4 px-6 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.02] dark:bg-black/15">
            <div className="flex items-center space-x-3 min-w-0">
              <button
                onClick={() => setSelectedThreadId(null)}
                className="md:hidden w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white bg-white/[0.05] border border-white/10"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-white/95 truncate tracking-tight">
                    {selectedThread.subject}
                  </h1>

                  {/* Mailbox Owner Tag */}
                  {threadAccount && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-white/70 font-mono">
                      via {threadAccount.ownerName} ({threadAccount.email.split('@')[0]})
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2 text-xs text-white/50 mt-0.5">
                  <button
                    onClick={() => {
                      if (selectedContact) setSelectedContactId(selectedContact.id);
                    }}
                    className="hover:underline font-semibold text-white/80 flex items-center gap-1 group"
                  >
                    <span>{selectedThread.contactName}</span>
                    <ArrowUpRight className="w-3 h-3 text-white/40 group-hover:text-white/80" />
                  </button>
                  <span>•</span>
                  <span>{selectedThread.contactCompany}</span>
                  <span>•</span>
                  <span className="font-mono text-white/40">{selectedThread.contactEmail}</span>
                </div>
              </div>
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center space-x-2 shrink-0">
              {/* Not a Lead */}
              <button
                onClick={handleNotALead}
                className="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold text-white/50 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors"
                title="Archive thread and add sender to ignore list"
              >
                <Ban className="w-3 h-3 text-[#FF9F0A]" />
                <span>Not a Lead</span>
              </button>

              {/* Not Interested / DNC */}
              <button
                onClick={handleNotInterested}
                className="hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold text-white/50 hover:text-[#FF453A] bg-white/[0.04] hover:bg-[#FF453A]/10 border border-white/10 transition-colors"
                title="Permanently block future outreach to this contact"
              >
                <ShieldAlert className="w-3 h-3 text-[#FF453A]" />
                <span>Do Not Contact</span>
              </button>

              {/* Star */}
              <button
                onClick={() => toggleStar(selectedThread.id)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 transition-colors"
              >
                <Star className={`w-4 h-4 ${selectedThread.starred ? 'fill-[#FFD60A] text-[#FFD60A]' : ''}`} />
              </button>

              {/* Stage dropdown */}
              {selectedContact && (
                <select
                  value={selectedContact.status}
                  onChange={(e) => updateContactStatus(selectedContact.id, e.target.value as PipelineStatus)}
                  className="text-xs font-semibold px-2.5 py-1 rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.1] text-white/90 focus:outline-none cursor-pointer"
                >
                  <option value="Lead" className="text-slate-900 bg-white">Stage: Lead</option>
                  <option value="Contacted" className="text-slate-900 bg-white">Stage: Contacted</option>
                  <option value="In Discussion" className="text-slate-900 bg-white">Stage: In Discussion</option>
                  <option value="Meeting" className="text-slate-900 bg-white">Stage: Meeting</option>
                  <option value="Client" className="text-slate-900 bg-white">Stage: Client</option>
                  <option value="Cold" className="text-slate-900 bg-white">Stage: Cold</option>
                </select>
              )}

              {/* Owner / Assignee */}
              <select
                value={selectedThread.assignedToUserId}
                onChange={(e) => assignThread(selectedThread.id, e.target.value)}
                className="text-xs font-semibold px-2.5 py-1 rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.1] text-white/90 focus:outline-none cursor-pointer"
              >
                {users.map(u => (
                  <option key={u.id} value={u.id} className="text-slate-900 bg-white">
                    Owner: {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Messages Reading Column */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            <div className="max-w-3xl mx-auto space-y-4">
              {threadMessages.map(msg => {
                const isOutbound = msg.direction === 'outbound';
                const author = msg.sentByUserId ? users.find(u => u.id === msg.sentByUserId) : null;

                return (
                  <div
                    key={msg.id}
                    className={`rounded-2xl p-5 border transition-all ${
                      isOutbound
                        ? 'bg-[#0A84FF]/[0.08] border-[#0A84FF]/20 shadow-apple-card'
                        : 'bg-white/[0.04] dark:bg-black/30 border-white/10 shadow-apple-card'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm ring-1 ring-white/20 ${
                          isOutbound ? (author ? author.color : 'bg-[#0A84FF]') : 'bg-slate-700'
                        }`}>
                          {isOutbound ? (author ? author.initials : 'HQ') : selectedThread.contactName.charAt(0)}
                        </div>

                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white/95">
                              {msg.fromName}
                            </span>
                            {isOutbound && (
                              <span className="text-[10px] text-white/40 font-mono">
                                ({msg.fromEmail})
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] text-white/40">
                            To: {msg.toEmail}
                          </div>
                        </div>
                      </div>

                      <span className="text-[11px] text-white/40">
                        {new Date(msg.sentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-[13px] text-white/85 leading-relaxed whitespace-pre-line font-sans">
                      {msg.body}
                    </p>

                    {/* Attachments */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-white/[0.08] space-y-1.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                          Attachments ({msg.attachments.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {msg.attachments.map(att => (
                            <a
                              key={att.id}
                              href={`/api/attachments/${att.id}?name=${encodeURIComponent(att.filename)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-2 p-2 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs text-white/90 transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5 text-[#0A84FF]" />
                              <span className="font-medium max-w-[160px] truncate">{att.filename}</span>
                              <span className="text-[10px] text-white/40">({(att.size / 1024 / 1024).toFixed(1)} MB)</span>
                              <Download className="w-3 h-3 text-white/40" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Floating Composer Area */}
          <div className="p-3 sm:p-4 border-t border-white/[0.08] bg-white/[0.02] dark:bg-black/20 shrink-0">
            <div className="max-w-3xl mx-auto space-y-2">
              {/* Collision / Collaborative Guard */}
              {activeCollaborator && (
                <div className="p-2 px-3 rounded-xl bg-[#FF9F0A]/10 border border-[#FF9F0A]/20 flex items-center justify-between text-xs text-[#FF9F0A] animate-in fade-in">
                  <div className="flex items-center space-x-2 min-w-0">
                    <ShieldAlert className="w-3.5 h-3.5 text-[#FF9F0A] shrink-0" strokeWidth={1.75} />
                    <span className="truncate">
                      {activeCollaborator.name} is also viewing this thread.
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-[#FF9F0A]/80 uppercase tracking-wider">
                    Viewing
                  </span>
                </div>
              )}

              {/* Mailbox Ownership Banner if viewer is not the owner */}
              {!isMailboxOwner ? (
                <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 text-xs text-white/80 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full ${threadAccount.ownerColor || 'bg-blue-600'} text-white flex items-center justify-center text-xs font-bold ring-1 ring-white/20`}>
                      {threadAccount.ownerInitials || 'TM'}
                    </div>
                    <div>
                      <div className="font-semibold text-white">
                        {threadAccount.ownerName}'s Personal Mailbox
                      </div>
                      <div className="text-[11px] text-white/50">
                        This thread belongs to <strong className="text-white/80">{threadAccount.email}</strong>. Threads are visible to the team, but only {threadAccount.ownerName} can send replies from this mailbox.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Composer Box for Mailbox Owner */
                <div className="rounded-2xl p-2.5 bg-white/[0.05] dark:bg-black/35 border border-white/12 backdrop-blur-2xl shadow-apple-card space-y-2">
                  {showSentSuccess && (
                    <div className="p-1.5 px-3 bg-[#30D158]/15 border border-[#30D158]/30 text-[#30D158] text-[11.5px] rounded-lg flex items-center gap-1.5 animate-in fade-in">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Sent via {threadAccount.email} and saved to history!</span>
                    </div>
                  )}

                  {actionError && (
                    <div className="p-1.5 px-3 bg-red-500/15 border border-red-500/30 text-red-300 text-[11.5px] rounded-lg flex items-center gap-1.5 animate-in fade-in">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{actionError}</span>
                    </div>
                  )}

                  {/* Deliverability Warnings */}
                  {deliverabilityWarnings.length > 0 && (
                    <div className="space-y-1">
                      {deliverabilityWarnings.map((w, i) => (
                        <div key={i} className="p-1.5 px-3 bg-[#FFD60A]/10 border border-[#FFD60A]/20 text-[#FFD60A] text-[11px] rounded-lg flex items-center gap-1.5">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{w.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <form onSubmit={handleSendReply} className="space-y-2">
                    {/* CC / BCC Fields */}
                    {(showCc || showBcc) && (
                      <div className="space-y-1.5 pb-1 border-b border-white/[0.06]">
                        {showCc && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-white/40 w-10 text-right">Cc:</span>
                            <input
                              type="text"
                              placeholder="colleague@partner.com"
                              value={ccEmail}
                              onChange={(e) => setCcEmail(e.target.value)}
                              className="flex-1 bg-transparent border-none text-white focus:outline-none text-xs"
                            />
                          </div>
                        )}
                        {showBcc && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-white/40 w-10 text-right">Bcc:</span>
                            <input
                              type="text"
                              placeholder="records@crm.io"
                              value={bccEmail}
                              onChange={(e) => setBccEmail(e.target.value)}
                              className="flex-1 bg-transparent border-none text-white focus:outline-none text-xs"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Textarea */}
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={`Reply to ${selectedThread.contactName}...`}
                      rows={lineCount}
                      className="w-full text-[13px] px-3 py-2 rounded-xl border border-white/10 bg-white/[0.04] dark:bg-black/30 text-white placeholder-white/35 focus:outline-none focus:border-[#0A84FF]/60 resize-none font-sans leading-relaxed transition-all"
                    />

                    {/* Bottom Controls */}
                    <div className="flex items-center justify-between pt-0.5 gap-2">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        {/* + Menu Dropdown */}
                        <div className="relative shrink-0" ref={composerMenuRef}>
                          <button
                            type="button"
                            onClick={() => setComposerMenuOpen(!composerMenuOpen)}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 transition-colors"
                            title="Templates & follow-up reminders"
                          >
                            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                          </button>

                          {composerMenuOpen && (
                            <div className="absolute bottom-9 left-0 w-64 rounded-xl bg-black/85 backdrop-blur-3xl border border-white/15 p-2 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100 space-y-1.5">
                              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-white/35 px-2">
                                Follow-up Reminders (Max 3)
                              </div>
                              <div className="grid grid-cols-3 gap-1 px-1">
                                <button
                                  type="button"
                                  onClick={() => handleCreateReminder(1)}
                                  className="px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.12] text-[11px] text-white/80 text-center"
                                >
                                  1 Day
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCreateReminder(3)}
                                  className="px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.12] text-[11px] text-white/80 text-center"
                                >
                                  3 Days
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCreateReminder(7)}
                                  className="px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.12] text-[11px] text-white/80 text-center"
                                >
                                  7 Days
                                </button>
                              </div>

                              <div className="my-1 border-t border-white/[0.08]" />

                              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-white/35 px-2">
                                Dynamic Snippets
                              </div>
                              <button
                                type="button"
                                onClick={() => insertSnippet("Hi {{first_name}},\n\nThanks for following up! Let me know if you would like to hop on a quick 10-minute call.")}
                                className="w-full text-left px-2 py-1 rounded-lg text-xs text-white/80 hover:text-white hover:bg-white/[0.08]"
                              >
                                Follow-Up with Variables
                              </button>
                              <button
                                type="button"
                                onClick={() => insertSnippet("Approved from our end! Sending over the agreement document shortly.")}
                                className="w-full text-left px-2 py-1 rounded-lg text-xs text-white/80 hover:text-white hover:bg-white/[0.08]"
                              >
                                Approve & Close
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Paperclip */}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 transition-colors"
                          title="Attach files (max 10 MB total)"
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          onChange={handleFileChange}
                          className="hidden"
                        />

                        {/* CC / BCC Toggles */}
                        <button
                          type="button"
                          onClick={() => setShowCc(!showCc)}
                          className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium transition-colors ${
                            showCc ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white/70'
                          }`}
                        >
                          Cc
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowBcc(!showBcc)}
                          className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium transition-colors ${
                            showBcc ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white/70'
                          }`}
                        >
                          Bcc
                        </button>

                        {/* Sending As & Cap Indicator */}
                        <span className="text-[10px] text-white/40 font-mono truncate hidden sm:inline">
                          Sending as {threadAccount.email} • Sent: {threadAccount.sentToday}/{warmup.allowedCap} PKT
                        </span>
                      </div>

                      {/* Right: Large Blue Send Button */}
                      <button
                        type="submit"
                        disabled={!replyText.trim() || isSubmitting || isDnc}
                        className="flex items-center space-x-1.5 apple-primary-btn px-3 sm:px-4 py-1.5 rounded-xl text-[12.5px] font-semibold transition-all shadow-sm active:scale-95 disabled:opacity-40 cursor-pointer shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" strokeWidth={2} />
                        <span>{isSubmitting ? 'Sending...' : 'Send'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-white/40">
          <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/40 mb-3">
            <Send className="w-6 h-6" strokeWidth={1.75} />
          </div>
          <h3 className="text-sm font-semibold text-white/70">No conversation selected</h3>
          <p className="text-xs text-white/40 max-w-sm mt-1">
            Pick an email thread from the left or hit New Outreach to start a fresh conversation.
          </p>
        </div>
      )}
    </div>
  );
}
