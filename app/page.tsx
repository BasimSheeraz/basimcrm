'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { Navbar } from '@/components/Navbar';
import { Sidebar } from '@/components/Sidebar';
import { InboxView } from '@/components/InboxView';
import { ContactsView } from '@/components/ContactsView';
import { ProspectsView } from '@/components/ProspectsView';
import { SettingsView } from '@/components/SettingsView';
import { TodayDashboardView } from '@/components/TodayDashboardView';
import { DoNotContactModal } from '@/components/DoNotContactModal';
import { ComposeModal } from '@/components/ComposeModal';
import { ContactDetailModal } from '@/components/ContactDetailModal';
import { TeamManagementModal } from '@/components/TeamManagementModal';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { TwoFactorRecoveryModal } from '@/components/TwoFactorRecoveryModal';
import { Inbox, Send, Users, Settings, Plus, Flame, UserPlus } from 'lucide-react';
import { Prospect } from '@/types';

export default function Home() {
  const { 
    activeView, 
    setActiveView, 
    setStatusFilter, 
    threads, 
    contacts 
  } = useApp();

  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeInitialTo, setComposeInitialTo] = useState<{
    email: string;
    name: string;
    company: string;
    prospectId?: string;
  } | undefined>(undefined);
  const [isTeamOpen, setIsTeamOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isRecoveryCodesOpen, setIsRecoveryCodesOpen] = useState(false);
  const [isDncOpen, setIsDncOpen] = useState(false);

  const unreadCount = threads.filter(t => t.unread && !t.archived).length;

  const handleOpenCompose = () => {
    setComposeInitialTo(undefined);
    setIsComposeOpen(true);
  };

  const handleOpenComposeTo = (email: string, name: string, company: string, prospectId?: string) => {
    setComposeInitialTo({ email, name, company, prospectId });
    setIsComposeOpen(true);
  };

  const handleEmailProspect = (prospect: Prospect) => {
    if (!prospect.email) return;
    setComposeInitialTo({
      email: prospect.email,
      name: prospect.fullName,
      company: prospect.company || '',
      prospectId: prospect.id,
    });
    setIsComposeOpen(true);
  };

  const handleOpenSettings = () => {
    setActiveView('settings');
  };

  return (
    <div className="p-0 sm:p-3 md:p-4 h-screen w-full overflow-hidden flex flex-col relative z-10 box-border">
      {/* Floating Glassmorphic Window */}
      <div className="glass-window rounded-none sm:rounded-[24px] md:rounded-[28px] overflow-hidden flex flex-col flex-1 relative">
        {/* Top Slim Translucent Toolbar */}
        <Navbar 
          onOpenCompose={handleOpenCompose} 
          onOpenSettings={handleOpenSettings}
          onOpenTeam={() => setIsTeamOpen(true)}
          onOpenChangePassword={() => setIsChangePasswordOpen(true)}
          onOpenRecoveryCodes={() => setIsRecoveryCodesOpen(true)}
          onOpenDnc={() => setIsDncOpen(true)}
        />

        {/* 3-Pane Body: Sidebar + Main Content View */}
        <div className="flex flex-1 overflow-hidden relative">
          <Sidebar 
            onOpenCompose={handleOpenCompose}
            onOpenTeam={() => setIsTeamOpen(true)}
            onOpenDnc={() => setIsDncOpen(true)}
          />

          <main className="flex-1 flex overflow-hidden relative">
            {activeView === 'today' ? (
              <TodayDashboardView onEmailProspect={handleEmailProspect} />
            ) : activeView === 'prospects' ? (
              <ProspectsView onEmailProspect={handleEmailProspect} />
            ) : activeView === 'contacts' ? (
              <ContactsView onOpenComposeTo={handleOpenComposeTo} />
            ) : activeView === 'settings' ? (
              <SettingsView onOpenDnc={() => setIsDncOpen(true)} />
            ) : (
              <InboxView />
            )}
          </main>
        </div>

        {/* Mobile iOS Bottom Tab Bar */}
        <nav className="md:hidden flex items-center justify-around py-2 px-3 border-t border-white/[0.08] bg-white/[0.04] dark:bg-black/40 backdrop-blur-2xl shrink-0 select-none">
          <button
            onClick={() => { setActiveView('inbox'); setStatusFilter('all'); }}
            className={`flex flex-col items-center space-y-0.5 relative py-1 px-2.5 rounded-xl transition-all ${
              activeView === 'inbox' ? 'text-[#0A84FF]' : 'text-white/50 hover:text-white'
            }`}
          >
            <div className="relative">
              <Inbox className="w-5 h-5" strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#0A84FF]" />
              )}
            </div>
            <span className="text-[10px] font-medium">Inbox</span>
          </button>

          <button
            onClick={() => setActiveView('today')}
            className={`flex flex-col items-center space-y-0.5 py-1 px-2.5 rounded-xl transition-all ${
              activeView === 'today' ? 'text-[#FF9F0A]' : 'text-white/50 hover:text-white'
            }`}
          >
            <Flame className="w-5 h-5" strokeWidth={1.75} />
            <span className="text-[10px] font-medium">Today</span>
          </button>

          {/* Quick Floating Compose on Mobile */}
          <button
            onClick={handleOpenCompose}
            className="w-10 h-10 rounded-full apple-primary-btn flex items-center justify-center -mt-3 shadow-lg active:scale-95 transition-transform"
            title="Compose new outreach email"
          >
            <Plus className="w-5 h-5 text-white" strokeWidth={2.2} />
          </button>

          <button
            onClick={() => { setActiveView('prospects'); setStatusFilter('all'); }}
            className={`flex flex-col items-center space-y-0.5 py-1 px-2.5 rounded-xl transition-all ${
              activeView === 'prospects' ? 'text-[#0A84FF]' : 'text-white/50 hover:text-white'
            }`}
          >
            <UserPlus className="w-5 h-5" strokeWidth={1.75} />
            <span className="text-[10px] font-medium">Prospects</span>
          </button>

          <button
            onClick={() => { setActiveView('contacts'); setStatusFilter('all'); }}
            className={`flex flex-col items-center space-y-0.5 py-1 px-2.5 rounded-xl transition-all ${
              activeView === 'contacts' ? 'text-[#0A84FF]' : 'text-white/50 hover:text-white'
            }`}
          >
            <Users className="w-5 h-5" strokeWidth={1.75} />
            <span className="text-[10px] font-medium">People</span>
          </button>

          <button
            onClick={() => setActiveView('settings')}
            className={`flex flex-col items-center space-y-0.5 py-1 px-2.5 rounded-xl transition-all ${
              activeView === 'settings' ? 'text-[#0A84FF]' : 'text-white/50 hover:text-white'
            }`}
          >
            <Settings className="w-5 h-5" strokeWidth={1.75} />
            <span className="text-[10px] font-medium">Settings</span>
          </button>
        </nav>
      </div>

      {/* Compose Email Modal */}
      <ComposeModal 
        isOpen={isComposeOpen} 
        onClose={() => setIsComposeOpen(false)} 
        initialTo={composeInitialTo} 
      />

      {/* Contact Dossier / History Modal */}
      <ContactDetailModal onOpenComposeTo={handleOpenComposeTo} />

      {/* Do Not Contact Modal */}
      <DoNotContactModal
        isOpen={isDncOpen}
        onClose={() => setIsDncOpen(false)}
      />

      {/* Team Management Modal (Admin Only) */}
      <TeamManagementModal
        isOpen={isTeamOpen}
        onClose={() => setIsTeamOpen(false)}
      />

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />

      {/* 2FA Recovery Codes Modal */}
      <TwoFactorRecoveryModal
        isOpen={isRecoveryCodesOpen}
        onClose={() => setIsRecoveryCodesOpen(false)}
      />
    </div>
  );
}
