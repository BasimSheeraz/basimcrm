'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '@/lib/store';
import { 
  Mail, 
  RefreshCw, 
  Sun, 
  Moon, 
  ChevronDown, 
  Sparkles, 
  Settings, 
  Check,
  Key,
  Shield,
  Lock,
  Send,
  ShieldAlert,
  LogOut
} from 'lucide-react';
import { calculateWarmupDailyCap } from '@/lib/deliverability';

interface NavbarProps {
  onOpenCompose: () => void;
  onOpenSettings: () => void;
  onOpenChangePassword?: () => void;
  onOpenRecoveryCodes?: () => void;
  onOpenTeam?: () => void;
  onOpenDnc?: () => void;
}

export function Navbar({ 
  onOpenCompose, 
  onOpenSettings,
  onOpenChangePassword,
  onOpenRecoveryCodes,
  onOpenTeam,
  onOpenDnc
}: NavbarProps) {
  const { 
    users, 
    currentUser, 
    logout,
    gmailAccounts,
    syncGmail, 
    isSyncing,
    threads
  } = useApp();

  const [mounted, setMounted] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAdmin = currentUser.role.includes('admin') || currentUser.systemRole === 'admin' || currentUser.name === 'Basim';
  const unreadCount = threads.filter(t => t.unread && !t.archived).length;

  const defaultAccount = {
    id: '',
    ownerUserId: currentUser.id,
    email: currentUser.email || 'user@ourteam.io',
    status: 'active' as const,
    dailyCap: 5,
    sentToday: 0,
    warmupStartedAt: new Date().toISOString(),
    warmupOverride: false,
  };
  const myAccount = gmailAccounts.find(a => a.ownerUserId === currentUser.id) || gmailAccounts[0] || defaultAccount;
  const warmup = calculateWarmupDailyCap(myAccount.warmupStartedAt, myAccount.dailyCap, myAccount.warmupOverride);

  useEffect(() => {
    setMounted(true);
    const isDark = document.documentElement.classList.contains('dark') || 
                   (!document.documentElement.classList.contains('light') && 
                    window.matchMedia('(prefers-color-scheme: dark)').matches);
    setIsDarkMode(isDark);

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update browser tab title with unread count
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = unreadCount > 0 ? `(${unreadCount}) Basim CRM` : 'Basim CRM - Combined Inbox & Personal Mailboxes';
    }
  }, [unreadCount]);

  const toggleTheme = () => {
    if (isDarkMode) {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      setIsDarkMode(false);
    } else {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
      setIsDarkMode(true);
    }
  };

  return (
    <header className="h-12 min-h-[48px] border-b border-white/[0.08] dark:border-white/[0.08] bg-white/[0.04] dark:bg-black/20 backdrop-blur-2xl px-4 flex items-center justify-between shrink-0 select-none z-30">
      {/* Left: Brand Wordmark (Flush left, no window dots) */}
      <div className="flex items-center space-x-2.5">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-[#0A84FF] to-[#5E5CE6] flex items-center justify-center text-white shadow-sm">
          <Mail className="w-3.5 h-3.5" strokeWidth={1.75} />
        </div>
        <span className="text-[13.5px] font-semibold tracking-tight text-white/95 dark:text-white/95 flex items-center gap-1.5">
          Basim
          <span className="text-[9.5px] font-medium tracking-wide uppercase px-1.5 py-0.2 rounded-full bg-white/10 dark:bg-white/10 text-white/70 border border-white/10">
            CRM
          </span>
        </span>
      </div>

      {/* Right Controls: Sent Today Counter + Mailbox Status + Sync + Teammates + User Avatar */}
      <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
        {/* Sent Today Counter */}
        <div 
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-[11px] text-white/70 font-mono"
          title="Daily outreach sends reset at midnight Pakistan Time (PKT)"
        >
          <Send className="w-3 h-3 text-[#0A84FF]" />
          <span>Sent today: <strong className="text-white">{myAccount.sentToday}/{warmup.allowedCap}</strong> PKT</span>
        </div>

        {/* Connected Personal Mailbox Pill */}
        <button
          onClick={onOpenSettings}
          className="flex items-center space-x-1.5 px-2 py-1 rounded-full hover:bg-white/[0.08] transition-colors cursor-pointer group shrink-0"
          title={`Connected Mailbox: ${myAccount.email} (${myAccount.status})`}
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            myAccount.status === 'active' ? 'bg-[#30D158]' : myAccount.status === 'paused' ? 'bg-[#FF9F0A]' : 'bg-[#FF453A]'
          }`} />
          <span className="text-[11px] text-white/60 group-hover:text-white hidden lg:inline max-w-[130px] truncate font-mono">
            {myAccount.email.split('@')[0]}
          </span>
        </button>

        {/* Sync Icon Button */}
        <button
          onClick={() => syncGmail()}
          disabled={isSyncing}
          className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-50 cursor-pointer"
          title="Sync all 3 personal Gmail mailboxes"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-[#0A84FF]' : ''}`} />
        </button>

        {/* 3 Teammate Avatars with Online Dot */}
        <div className="hidden sm:flex items-center -space-x-1.5 pl-1 pr-1">
          {users.map(u => (
            <div 
              key={u.id}
              className="relative group cursor-default"
              title={`${u.name} (Online)`}
            >
              <div className={`w-6 h-6 rounded-full ${u.color} text-white flex items-center justify-center text-[10px] font-bold ring-2 ring-[#12131C] shadow-sm`}>
                {u.initials}
              </div>
              <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-[#30D158] ring-1 ring-[#12131C]" />
            </div>
          ))}
        </div>

        {/* User Avatar Menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center space-x-1.5 p-1 pl-1.5 rounded-full hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <div className={`w-6 h-6 rounded-full ${currentUser.color} text-white flex items-center justify-center text-[10.5px] font-bold shadow-sm ring-1 ring-white/20`}>
              {currentUser.initials}
            </div>
            <span className="text-xs font-semibold text-white/90 hidden sm:inline">
              {currentUser.name}
            </span>
            <ChevronDown className="w-3 h-3 text-white/40" />
          </button>

          {/* User Menu Dropdown */}
          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-black/85 backdrop-blur-3xl border border-white/15 p-2 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 space-y-2">
              {/* Active Profile Info */}
              <div className="px-3 py-2 border-b border-white/[0.08]">
                <div className="text-xs font-bold text-white/95">{currentUser.name}</div>
                <div className="text-[11px] text-white/50 truncate font-mono">{myAccount.email}</div>
                <div className="text-[10px] text-[#0A84FF] font-medium mt-0.5">
                  {currentUser.role}
                </div>
              </div>

              {/* Account & Security Actions */}
              <div className="space-y-0.5">
                {/* Do Not Contact (DNC) */}
                {onOpenDnc && (
                  <button
                    onClick={() => {
                      onOpenDnc();
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs text-white/75 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 text-[#FF453A]" />
                    <span>Do Not Contact List</span>
                  </button>
                )}

                {/* Change Password */}
                {onOpenChangePassword && (
                  <button
                    onClick={() => {
                      onOpenChangePassword();
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs text-white/75 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Lock className="w-3.5 h-3.5 text-white/60" />
                    <span>Change Password</span>
                  </button>
                )}

                {/* 2FA Recovery Codes */}
                {onOpenRecoveryCodes && (
                  <button
                    onClick={() => {
                      onOpenRecoveryCodes();
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs text-white/75 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Key className="w-3.5 h-3.5 text-white/60" />
                    <span>2FA Recovery Codes</span>
                  </button>
                )}

                {/* Admin Team Controls */}
                {isAdmin && onOpenTeam && (
                  <button
                    onClick={() => {
                      onOpenTeam();
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs text-purple-300 hover:text-white hover:bg-purple-500/20 transition-colors"
                  >
                    <Shield className="w-3.5 h-3.5 text-purple-400" />
                    <span>Team Management</span>
                  </button>
                )}

                {/* Theme Switcher */}
                <button
                  onClick={toggleTheme}
                  suppressHydrationWarning
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-xs text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    {isDarkMode ? <Sun className="w-3.5 h-3.5 text-amber-300" /> : <Moon className="w-3.5 h-3.5 text-slate-300" />}
                    <span>{isDarkMode ? 'Light Appearance' : 'Dark Appearance'}</span>
                  </div>
                </button>

                {/* Settings link */}
                <button
                  onClick={() => {
                    onOpenSettings();
                    setUserMenuOpen(false);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Settings & Mailboxes</span>
                </button>

                {/* Sign Out */}
                <button
                  onClick={async () => {
                    setUserMenuOpen(false);
                    await logout();
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer pt-1 mt-1 border-t border-white/[0.08]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
