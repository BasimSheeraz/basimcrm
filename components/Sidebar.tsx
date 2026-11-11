'use client';

import React from 'react';
import { useApp } from '@/lib/store';
import { 
  Inbox, 
  Send, 
  Users, 
  Settings, 
  Plus, 
  Archive, 
  Clock, 
  Shield,
  Flame,
  ShieldAlert
} from 'lucide-react';

interface SidebarProps {
  onOpenCompose?: () => void;
  onOpenTeam?: () => void;
  onOpenDnc?: () => void;
}

export function Sidebar({ onOpenCompose, onOpenTeam, onOpenDnc }: SidebarProps) {
  const { 
    activeView, 
    setActiveView, 
    threads, 
    statusFilter,
    setStatusFilter,
    dueRemindersCount,
    currentUser
  } = useApp();

  const unreadCount = threads.filter(t => t.unread && !t.archived).length;
  const isAdmin = currentUser.role.includes('admin') || currentUser.systemRole === 'admin' || currentUser.name === 'Basim';

  return (
    <aside className="hidden md:flex w-[220px] min-w-[220px] border-r border-white/[0.08] dark:border-white/[0.08] bg-white/[0.03] dark:bg-black/25 backdrop-blur-2xl flex-col shrink-0 select-none overflow-hidden justify-between">
      <div className="p-3.5 space-y-4 overflow-y-auto flex-1">
        {/* Large Rounded "New Outreach" Primary Button */}
        {onOpenCompose && (
          <button
            onClick={onOpenCompose}
            className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-2xl apple-primary-btn text-[13px] font-semibold active:scale-[0.98] transition-all cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" strokeWidth={2.2} />
            <span>New Outreach</span>
          </button>
        )}

        {/* Navigation Items */}
        <div className="space-y-1">
          {/* Shared Inbox */}
          <button
            onClick={() => { setActiveView('inbox'); setStatusFilter('all'); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-medium transition-all ${
              activeView === 'inbox' && statusFilter !== 'followups-due'
                ? 'bg-white/15 dark:bg-white/15 text-white shadow-sm border border-white/20'
                : 'text-white/70 hover:text-white hover:bg-white/[0.07] border border-transparent'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Inbox className="w-4 h-4 text-white/80" strokeWidth={1.75} />
              <span>Combined Inbox</span>
            </div>
            {unreadCount > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                activeView === 'inbox' && statusFilter !== 'followups-due'
                  ? 'bg-[#0A84FF] text-white shadow-sm'
                  : 'bg-white/10 text-white/90 border border-white/10'
              }`}>
                {unreadCount}
              </span>
            )}
          </button>

          {/* Today Dashboard */}
          <button
            onClick={() => setActiveView('today')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-medium transition-all ${
              activeView === 'today'
                ? 'bg-white/15 dark:bg-white/15 text-white shadow-sm border border-white/20'
                : 'text-white/70 hover:text-white hover:bg-white/[0.07] border border-transparent'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Flame className="w-4 h-4 text-[#FF9F0A]" strokeWidth={1.75} />
              <span>Today's Outreach</span>
            </div>
          </button>

          {/* Follow-ups Due Filter */}
          <button
            onClick={() => { setActiveView('inbox'); setStatusFilter('followups-due'); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-medium transition-all ${
              activeView === 'inbox' && statusFilter === 'followups-due'
                ? 'bg-white/15 dark:bg-white/15 text-white shadow-sm border border-white/20'
                : 'text-white/70 hover:text-white hover:bg-white/[0.07] border border-transparent'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Clock className="w-4 h-4 text-[#FF9F0A]" strokeWidth={1.75} />
              <span>Follow-ups Due</span>
            </div>
            {dueRemindersCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FF9F0A] text-slate-900 shadow-sm">
                {dueRemindersCount}
              </span>
            )}
          </button>

          {/* Sent Outreach */}
          <button
            onClick={() => { setActiveView('sent'); setStatusFilter('all'); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-medium transition-all ${
              activeView === 'sent'
                ? 'bg-white/15 dark:bg-white/15 text-white shadow-sm border border-white/20'
                : 'text-white/70 hover:text-white hover:bg-white/[0.07] border border-transparent'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Send className="w-4 h-4 text-white/80" strokeWidth={1.75} />
              <span>Sent Outreach</span>
            </div>
          </button>

          {/* Contacts */}
          <button
            onClick={() => { setActiveView('contacts'); setStatusFilter('all'); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-medium transition-all ${
              activeView === 'contacts'
                ? 'bg-white/15 dark:bg-white/15 text-white shadow-sm border border-white/20'
                : 'text-white/70 hover:text-white hover:bg-white/[0.07] border border-transparent'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Users className="w-4 h-4 text-white/80" strokeWidth={1.75} />
              <span>Contacts</span>
            </div>
          </button>

          {/* Do Not Contact (DNC) */}
          {onOpenDnc && (
            <button
              onClick={onOpenDnc}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/[0.07] border border-transparent transition-all"
            >
              <div className="flex items-center space-x-2.5">
                <ShieldAlert className="w-4 h-4 text-[#FF453A]" strokeWidth={1.75} />
                <span>Do Not Contact</span>
              </div>
            </button>
          )}

          {/* Archived View */}
          <button
            onClick={() => { setActiveView('archived'); setStatusFilter('all'); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-medium transition-all ${
              activeView === 'archived'
                ? 'bg-white/15 dark:bg-white/15 text-white shadow-sm border border-white/20'
                : 'text-white/70 hover:text-white hover:bg-white/[0.07] border border-transparent'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Archive className="w-4 h-4 text-white/80" strokeWidth={1.75} />
              <span>Archived</span>
            </div>
          </button>

          {/* Settings */}
          <button
            onClick={() => setActiveView('settings')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-medium transition-all ${
              activeView === 'settings'
                ? 'bg-white/15 dark:bg-white/15 text-white shadow-sm border border-white/20'
                : 'text-white/70 hover:text-white hover:bg-white/[0.07] border border-transparent'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Settings className="w-4 h-4 text-white/80" strokeWidth={1.75} />
              <span>Settings</span>
            </div>
          </button>
        </div>
      </div>

      {/* Admin Team Button at bottom of sidebar */}
      {isAdmin && onOpenTeam && (
        <div className="p-3 border-t border-white/[0.06]">
          <button
            onClick={onOpenTeam}
            className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 transition-all cursor-pointer"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Admin Team Controls</span>
          </button>
        </div>
      )}
    </aside>
  );
}
