'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { 
  Settings, 
  Key, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  HardDrive, 
  Shield, 
  Volume2, 
  VolumeX, 
  Bell, 
  Plus, 
  Trash2, 
  FileText, 
  Sliders, 
  Filter,
  Mail,
  Flame,
  ShieldAlert,
  Pause,
  Play
} from 'lucide-react';
import { 
  updateGmailSyncSettingsAction, 
  addIgnoreRuleAction, 
  removeIgnoreRuleAction,
  getDatabaseStorageStatsAction 
} from '@/lib/actions/sync';
import { 
  getUserSnippetsAction, 
  saveSnippetAction, 
  deleteSnippetAction,
  getUserSignaturesAction,
  saveSignatureAction 
} from '@/lib/actions/snippets';
import { updateDailyCapAction, setAccountStatusAction } from '@/lib/actions/mailboxes';
import { requestNotificationPermission, playNotificationSound } from '@/lib/audio';
import { calculateWarmupDailyCap } from '@/lib/deliverability';
import { GmailIgnoreRule, Snippet, Signature, GmailAccount } from '@/types';

interface SettingsViewProps {
  onOpenDnc?: () => void;
}

export function SettingsView({ onOpenDnc }: SettingsViewProps) {
  const { 
    gmailConfig, 
    updateGmailConfig, 
    syncGmail, 
    isSyncing,
    currentUser,
    gmailAccounts,
    updateAccountCap,
    soundEnabled,
    setSoundEnabled
  } = useApp();

  const isAdmin = currentUser.role.includes('admin') || currentUser.systemRole === 'admin' || currentUser.name === 'Basim';

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
  const myAccount = gmailAccounts.find(a => a.ownerUserId === currentUser.id) || gmailAccounts[0] || defaultAccount;

  // Sync Settings
  const [backfillDays, setBackfillDays] = useState<30 | 60 | 90>(gmailConfig.backfillDays || 60);
  const [syncLabel, setSyncLabel] = useState<string>(gmailConfig.syncLabel || '');
  const [syncInboxSentOnly, setSyncInboxSentOnly] = useState<boolean>(gmailConfig.syncInboxSentOnly ?? true);
  const [syncSettingsSaved, setSyncSettingsSaved] = useState(false);

  // Storage Stats (500 MB free tier)
  const [storageStats, setStorageStats] = useState({
    totalBytes: 48 * 1024 * 1024,
    maxBytes: 524288000,
    usagePercent: 9.15,
    isWarning: false
  });

  // Ignore Rules
  const [ignoreRules, setIgnoreRules] = useState<GmailIgnoreRule[]>([
    { id: 'rule-1', ruleType: 'domain', value: 'spamoutreach.com', reason: 'Blocked spammer', createdAt: new Date().toISOString() },
    { id: 'rule-2', ruleType: 'email', value: 'newsletter@promo-deals.org', reason: 'Cold blast', createdAt: new Date().toISOString() }
  ]);
  const [newRuleType, setNewRuleType] = useState<'email' | 'domain'>('domain');
  const [newRuleValue, setNewRuleValue] = useState('');

  // Snippets & Signatures
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [newSnippetTitle, setNewSnippetTitle] = useState('');
  const [newSnippetBody, setNewSnippetBody] = useState('');
  const [newSnippetShortcut, setNewSnippetShortcut] = useState('');
  const [showAddSnippet, setShowAddSnippet] = useState(false);

  const [signatureText, setSignatureText] = useState('');
  const [sigSaved, setSigSaved] = useState(false);
  const [notifPermission, setNotifPermission] = useState<string>('default');

  // Account cap edit state (admin)
  const [editingCaps, setEditingCaps] = useState<Record<string, number>>({});
  const [capSaveStatus, setCapSaveStatus] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const success = params.get('success');
      const connected = params.get('connected');
      const error = params.get('error');
      const email = params.get('email');
      if (success === 'gmail_connected' || connected === '1') {
        setOauthStatus({
          type: 'success',
          message: `Successfully connected personal Gmail mailbox${email ? ` (${email})` : ''}!`,
        });
        window.history.replaceState({}, '', window.location.pathname);
      } else if (error) {
        if (error === 'missing_google_credentials') {
          setOauthStatus({
            type: 'error',
            message: 'Google Cloud Credentials Required: Add your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel Project Settings (or .env.local).',
          });
        } else {
          setOauthStatus({
            type: 'error',
            message: `OAuth Error: ${decodeURIComponent(error)}`,
          });
        }
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  useEffect(() => {
    getDatabaseStorageStatsAction().then(setStorageStats).catch(() => {});
    getUserSnippetsAction().then(setSnippets).catch(() => {});
    getUserSignaturesAction().then(sigs => {
      const def = sigs.find(s => s.isDefault);
      if (def) setSignatureText(def.content);
    }).catch(() => {});

    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const handleSaveCap = async (account: GmailAccount) => {
    const newCap = editingCaps[account.id] ?? account.dailyCap;
    updateAccountCap(account.id, newCap, account.warmupOverride);
    await updateDailyCapAction(account.id, newCap, account.warmupOverride);
    setCapSaveStatus(`Updated daily cap for ${account.ownerName} to ${newCap}`);
    setTimeout(() => setCapSaveStatus(null), 3000);
  };

  const handleToggleWarmupOverride = async (account: GmailAccount) => {
    const nextOverride = !account.warmupOverride;
    updateAccountCap(account.id, account.dailyCap, nextOverride);
    await updateDailyCapAction(account.id, account.dailyCap, nextOverride);
    setCapSaveStatus(`${account.ownerName}: Warmup override ${nextOverride ? 'Enabled' : 'Disabled'}`);
    setTimeout(() => setCapSaveStatus(null), 3000);
  };

  const handleTogglePause = async (account: GmailAccount) => {
    const nextStatus = account.status === 'paused' ? 'active' : 'paused';
    await setAccountStatusAction(account.id, nextStatus, nextStatus === 'paused' ? 'Admin paused' : undefined);
    setCapSaveStatus(`${account.ownerName} status changed to ${nextStatus}`);
    setTimeout(() => setCapSaveStatus(null), 3000);
  };

  const handleSaveSyncSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    updateGmailConfig({
      backfillDays,
      syncLabel: syncLabel.trim() || undefined,
      syncInboxSentOnly
    });

    await updateGmailSyncSettingsAction({
      backfillDays,
      syncLabel: syncLabel.trim() || null,
      syncInboxSentOnly
    });

    setSyncSettingsSaved(true);
    setTimeout(() => setSyncSettingsSaved(false), 3000);
  };

  const handleAddIgnoreRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleValue.trim()) return;

    const clean = newRuleValue.trim().toLowerCase().replace(/^@/, '');
    const newRule: GmailIgnoreRule = {
      id: `rule-${Date.now()}`,
      ruleType: newRuleType,
      value: clean,
      reason: 'Manual ignore rule',
      createdAt: new Date().toISOString()
    };

    setIgnoreRules([newRule, ...ignoreRules]);
    setNewRuleValue('');
    await addIgnoreRuleAction({
      ruleType: newRuleType,
      value: clean,
      reason: 'Manual ignore rule'
    });
  };

  const handleRemoveIgnoreRule = async (id: string) => {
    setIgnoreRules(ignoreRules.filter(r => r.id !== id));
    await removeIgnoreRuleAction(id);
  };

  const handleAddSnippet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSnippetTitle.trim() || !newSnippetBody.trim()) return;

    const res = await saveSnippetAction({
      title: newSnippetTitle,
      body: newSnippetBody,
      shortcut: newSnippetShortcut.trim() || undefined
    });

    if (res.success) {
      const newSnip: Snippet = {
        id: `snip-${Date.now()}`,
        userId: currentUser.id,
        title: newSnippetTitle,
        body: newSnippetBody,
        shortcut: newSnippetShortcut.trim() || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      setSnippets([...snippets, newSnip]);
      setNewSnippetTitle('');
      setNewSnippetBody('');
      setNewSnippetShortcut('');
      setShowAddSnippet(false);
    }
  };

  const handleDeleteSnippet = async (id: string) => {
    setSnippets(snippets.filter(s => s.id !== id));
    await deleteSnippetAction(id);
  };

  const handleSaveSignature = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveSignatureAction({
      title: 'Default Signature',
      content: signatureText,
      isDefault: true
    });
    setSigSaved(true);
    setTimeout(() => setSigSaved(false), 2500);
  };

  const handleRequestNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotifPermission(granted ? 'granted' : 'denied');
    if (granted) {
      playNotificationSound();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-8 animate-in fade-in duration-200">
      {/* Top Header */}
      <div>
        <h1 className="text-xl font-bold text-white/95 tracking-tight">Mailbox & System Settings</h1>
        <p className="text-xs text-white/50 mt-0.5">
          Manage personal Gmail mailboxes, safe sending caps, warm-up schedules, and deliverability protection.
        </p>
      </div>

      {oauthStatus && (
        <div className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-2 animate-in fade-in ${
          oauthStatus.type === 'success'
            ? 'bg-[#30D158]/15 border-[#30D158]/30 text-[#30D158]'
            : 'bg-[#FF9F0A]/15 border-[#FF9F0A]/35 text-[#FF9F0A]'
        }`}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{oauthStatus.message}</span>
          </div>
          <button
            onClick={() => setOauthStatus(null)}
            className="text-white/40 hover:text-white text-xs px-2 py-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {capSaveStatus && (
        <div className="p-3 rounded-xl bg-[#30D158]/15 border border-[#30D158]/30 text-[#30D158] text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{capSaveStatus}</span>
        </div>
      )}

      {/* SECTION 1: Personal Mailbox Connection (For Every Member) */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-xl ${currentUser.color} text-white flex items-center justify-center font-bold text-sm shadow-sm ring-1 ring-white/20`}>
              {currentUser.initials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white/95">Your Personal Gmail Mailbox</h2>
                <span className={`text-[10px] font-semibold px-2 py-0.2 rounded-full ${
                  myAccount.status === 'active' 
                    ? 'bg-[#30D158]/20 text-[#30D158] border border-[#30D158]/30' 
                    : myAccount.status === 'paused'
                    ? 'bg-[#FF9F0A]/20 text-[#FF9F0A] border border-[#FF9F0A]/30'
                    : 'bg-[#FF453A]/20 text-[#FF453A] border border-[#FF453A]/30'
                }`}>
                  {myAccount.status}
                </span>
              </div>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                {myAccount.email}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              window.location.href = '/api/auth/google';
            }}
            className="apple-primary-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Connect Personal Gmail</span>
          </button>
        </div>

        <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-white/60 space-y-1">
          <div className="font-semibold text-white/80">Personal Sending Isolation:</div>
          <div>• You only send emails from your own connected Gmail address ({myAccount.email}).</div>
          <div>• Nobody on the team can send emails from your personal mailbox.</div>
          <div>• Daily send cap: {myAccount.sentToday} / {calculateWarmupDailyCap(myAccount.warmupStartedAt, myAccount.dailyCap, myAccount.warmupOverride).allowedCap} PKT.</div>
        </div>
      </div>

      {/* SECTION 2: Admin Multi-Mailbox Overview (Admin Only) */}
      {isAdmin && (
        <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-purple-400" />
                <h2 className="text-sm font-bold text-white/95">Team Mailboxes Status & Warm-up (Admin Only)</h2>
              </div>
              <p className="text-xs text-white/50 mt-0.5">
                Monitor all 3 personal Gmail mailboxes, adjust daily caps, and manage warm-up schedules. Tokens are encrypted and never readable.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {gmailAccounts.map(acc => {
              const warmupInfo = calculateWarmupDailyCap(acc.warmupStartedAt, acc.dailyCap, acc.warmupOverride);
              const currentEditCap = editingCaps[acc.id] ?? acc.dailyCap;

              return (
                <div key={acc.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div className={`w-7 h-7 rounded-lg ${acc.ownerColor || 'bg-blue-600'} text-white flex items-center justify-center font-bold text-xs ring-1 ring-white/20`}>
                        {acc.ownerInitials}
                      </div>
                      <div>
                        <div className="font-semibold text-white/95 text-xs">{acc.ownerName}</div>
                        <div className="text-[10.5px] text-white/40 font-mono truncate max-w-[130px]">{acc.email}</div>
                      </div>
                    </div>

                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      acc.status === 'active' 
                        ? 'bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/25' 
                        : acc.status === 'paused'
                        ? 'bg-[#FF9F0A]/20 text-[#FF9F0A] border border-[#FF9F0A]/30'
                        : 'bg-[#FF453A]/20 text-[#FF453A] border border-[#FF453A]/30'
                    }`}>
                      {acc.status}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-black/20 text-[11px] space-y-1 text-white/60">
                    <div className="flex justify-between">
                      <span>Warm-up:</span>
                      <span className="font-semibold text-white/80">Week {warmupInfo.weekNumber} ({warmupInfo.allowedCap}/day)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Sent Today:</span>
                      <span className="font-mono text-white/80">{acc.sentToday} sends</span>
                    </div>
                  </div>

                  {/* Daily Cap Control */}
                  <div className="space-y-1.5 pt-1 border-t border-white/5">
                    <div className="flex items-center justify-between text-[11px] text-white/60">
                      <span>Daily Cap (1-30):</span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={currentEditCap}
                        onChange={(e) => setEditingCaps({ ...editingCaps, [acc.id]: parseInt(e.target.value) || 5 })}
                        className="w-14 px-2 py-0.5 rounded bg-white/10 border border-white/10 text-white font-mono text-xs text-right focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[11px]">
                      <label className="flex items-center gap-1.5 text-white/60 cursor-pointer text-[10.5px]">
                        <input
                          type="checkbox"
                          checked={acc.warmupOverride}
                          onChange={() => handleToggleWarmupOverride(acc)}
                          className="rounded"
                        />
                        <span>Override Warm-up</span>
                      </label>

                      <button
                        onClick={() => handleSaveCap(acc)}
                        className="px-2.5 py-0.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-[10.5px]"
                      >
                        Save Cap
                      </button>
                    </div>

                    <button
                      onClick={() => handleTogglePause(acc)}
                      className={`w-full mt-1 py-1 rounded-lg text-[10.5px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                        acc.status === 'paused'
                          ? 'bg-[#30D158]/20 hover:bg-[#30D158]/30 text-[#30D158]'
                          : 'bg-[#FF9F0A]/15 hover:bg-[#FF9F0A]/25 text-[#FF9F0A]'
                      }`}
                    >
                      {acc.status === 'paused' ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      <span>{acc.status === 'paused' ? 'Resume Outreach' : 'Pause Outreach'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 3: Storage Gauge (500 MB Postgres Free Tier Guard) */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#30D158] to-[#0A84FF] text-white flex items-center justify-center shadow-sm ring-1 ring-white/20">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white/95">Supabase Database Storage (Free 500 MB Tier)</h2>
              <p className="text-xs text-white/50">
                Guards database capacity. Attachment bytes are streamed on demand and never persisted in Postgres.
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="font-mono font-bold text-white text-sm">
              {(storageStats.totalBytes / (1024 * 1024)).toFixed(1)} MB
            </span>
            <span className="text-white/40 text-xs"> / 500 MB</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-300 ${
              storageStats.usagePercent >= 80 ? 'bg-[#FF453A]' : 'bg-[#30D158]'
            }`}
            style={{ width: `${Math.min(100, storageStats.usagePercent)}%` }}
          />
        </div>
      </div>

      {/* SECTION 4: Sync & Ingestion Settings */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white/95">Selective Sync & Ingestion Rules</h2>
            <p className="text-xs text-white/50">
              Syncs INBOX and SENT only. Skips spam, trash, promotions, social, and drafts automatically.
            </p>
          </div>
          {syncSettingsSaved && (
            <span className="text-xs text-[#30D158] flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved!
            </span>
          )}
        </div>

        <form onSubmit={handleSaveSyncSettings} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5">
                First Connect Backfill Window
              </label>
              <select
                value={backfillDays}
                onChange={(e) => setBackfillDays(parseInt(e.target.value) as 30 | 60 | 90)}
                className="w-full text-xs p-2.5 rounded-xl border border-white/15 bg-white/[0.06] text-white focus:outline-none"
              >
                <option value={30} className="text-slate-900 bg-white">Past 30 Days</option>
                <option value={60} className="text-slate-900 bg-white">Past 60 Days (Default)</option>
                <option value={90} className="text-slate-900 bg-white">Past 90 Days</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5">
                Optional Single Label Filter
              </label>
              <input
                type="text"
                placeholder="Leave blank for entire Inbox & Sent"
                value={syncLabel}
                onChange={(e) => setSyncLabel(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-white/15 bg-white/[0.06] text-white placeholder-white/35 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="apple-primary-btn px-4 py-2 rounded-xl text-xs font-semibold"
            >
              Save Sync Preferences
            </button>
          </div>
        </form>
      </div>

      {/* SECTION 5: Do Not Contact & Ignore Lists */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white/95">Exclusions & Ignore Rules</h2>
            <p className="text-xs text-white/50">
              Block nuisance senders from ingestion or permanently forbid outreach to opt-outs.
            </p>
          </div>
          {onOpenDnc && (
            <button
              onClick={onOpenDnc}
              className="px-3 py-1.5 rounded-xl bg-[#FF453A]/15 hover:bg-[#FF453A]/25 border border-[#FF453A]/30 text-[#FF453A] text-xs font-semibold flex items-center gap-1.5"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Manage Do Not Contact</span>
            </button>
          )}
        </div>

        {/* Add ignore form */}
        <form onSubmit={handleAddIgnoreRule} className="flex gap-2">
          <select
            value={newRuleType}
            onChange={(e) => setNewRuleType(e.target.value as any)}
            className="text-xs px-3 py-2 rounded-xl border border-white/15 bg-white/[0.06] text-white focus:outline-none"
          >
            <option value="domain" className="text-slate-900 bg-white">Domain</option>
            <option value="email" className="text-slate-900 bg-white">Email</option>
          </select>
          <input
            type="text"
            placeholder={newRuleType === 'domain' ? 'spammerdomain.com' : 'badactor@domain.com'}
            value={newRuleValue}
            onChange={(e) => setNewRuleValue(e.target.value)}
            className="flex-1 text-xs px-3 py-2 rounded-xl border border-white/15 bg-white/[0.06] text-white placeholder-white/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newRuleValue.trim()}
            className="apple-primary-btn px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40"
          >
            Ignore Sender
          </button>
        </form>

        <div className="flex flex-wrap gap-2 pt-1">
          {ignoreRules.map(rule => (
            <span key={rule.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white/80">
              <span className="font-mono">{rule.value}</span>
              <button
                type="button"
                onClick={() => handleRemoveIgnoreRule(rule.id)}
                className="text-white/40 hover:text-white"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* SECTION 6: Snippets & Signatures */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white/95">Dynamic Snippets & Email Signature</h2>
            <p className="text-xs text-white/50">
              Dynamic templates support variable replacement: <code className="text-[#0A84FF]">{'{{first_name}}'}</code>, <code className="text-[#0A84FF]">{'{{name}}'}</code>, <code className="text-[#0A84FF]">{'{{company}}'}</code>.
            </p>
          </div>
          <button
            onClick={() => setShowAddSnippet(true)}
            className="apple-primary-btn px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Snippet</span>
          </button>
        </div>

        {/* Add Snippet Form */}
        {showAddSnippet && (
          <form onSubmit={handleAddSnippet} className="p-4 rounded-xl bg-white/[0.04] border border-white/10 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Snippet Title"
                value={newSnippetTitle}
                onChange={(e) => setNewSnippetTitle(e.target.value)}
                className="text-xs px-3 py-2 rounded-xl border border-white/15 bg-white/[0.06] text-white placeholder-white/40 focus:outline-none"
              />
              <input
                type="text"
                placeholder="Shortcut (e.g. /followup)"
                value={newSnippetShortcut}
                onChange={(e) => setNewSnippetShortcut(e.target.value)}
                className="text-xs px-3 py-2 rounded-xl border border-white/15 bg-white/[0.06] text-white placeholder-white/40 focus:outline-none"
              />
            </div>
            <textarea
              rows={3}
              placeholder="Hi {{first_name}}, following up on our discussion regarding {{company}}..."
              value={newSnippetBody}
              onChange={(e) => setNewSnippetBody(e.target.value)}
              className="w-full text-xs p-3 rounded-xl border border-white/15 bg-white/[0.06] text-white placeholder-white/40 focus:outline-none resize-none font-sans"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddSnippet(false)}
                className="px-3 py-1.5 text-xs text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newSnippetTitle.trim() || !newSnippetBody.trim()}
                className="apple-primary-btn px-4 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40"
              >
                Save Template
              </button>
            </div>
          </form>
        )}

        {/* Snippets List */}
        <div className="space-y-2">
          {snippets.map(s => (
            <div key={s.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-start justify-between gap-3 text-xs">
              <div>
                <div className="font-semibold text-white/90 flex items-center gap-2">
                  <span>{s.title}</span>
                  {s.shortcut && <span className="font-mono text-[10px] text-white/40 bg-white/10 px-1.5 py-0.2 rounded">{s.shortcut}</span>}
                </div>
                <div className="text-[11.5px] text-white/60 font-sans mt-0.5 line-clamp-2">{s.body}</div>
              </div>
              <button
                onClick={() => handleDeleteSnippet(s.id)}
                className="text-white/40 hover:text-red-400 p-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Signature */}
        <div className="pt-3 border-t border-white/[0.08] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white/80">Your Email Signature</span>
            {sigSaved && <span className="text-[11px] text-[#30D158]">Saved!</span>}
          </div>
          <textarea
            rows={2}
            value={signatureText}
            onChange={(e) => setSignatureText(e.target.value)}
            placeholder="Best regards,&#10;Basim — Outreach & Business Development"
            className="w-full text-xs p-3 rounded-xl border border-white/15 bg-white/[0.06] text-white placeholder-white/40 focus:outline-none resize-none font-sans"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveSignature}
              className="apple-primary-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold"
            >
              Save Signature
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 7: Alerts & Notifications */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
        <h2 className="text-sm font-bold text-white/95">Alerts & Sound Settings</h2>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="text-xs font-semibold text-white/90">Notification Chime</span>
            <p className="text-[11px] text-white/40">
              Plays a harmonic Web Audio alert tone when new replies arrive.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => playNotificationSound()}
              className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-white/80 transition-colors"
            >
              Test Tone
            </button>
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-xl border transition-colors ${
                soundEnabled 
                  ? 'bg-[#30D158]/20 border-[#30D158]/40 text-[#30D158]' 
                  : 'bg-white/[0.05] border-white/10 text-white/40'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
