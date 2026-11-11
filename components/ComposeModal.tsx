'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { X, Send, AlertTriangle, ShieldAlert, CheckCircle, Flame, Clock } from 'lucide-react';
import { lintEmailDeliverability, calculateWarmupDailyCap, getPktTime } from '@/lib/deliverability';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTo?: { email: string; name: string; company: string };
}

export function ComposeModal({ isOpen, onClose, initialTo }: ComposeModalProps) {
  const { 
    contacts, 
    currentUser, 
    composeEmail, 
    gmailAccounts, 
    doNotContactList, 
    users 
  } = useApp();

  const [toEmail, setToEmail] = useState('');
  const [toName, setToName] = useState('');
  const [company, setCompany] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [suggestions, setSuggestions] = useState<{ email: string; name: string; company: string }[]>([]);
  const [adminOverride, setAdminOverride] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  const senderAccount = gmailAccounts.find(a => a.ownerUserId === currentUser.id) || gmailAccounts[0] || defaultAccount;
  const warmup = calculateWarmupDailyCap(senderAccount.warmupStartedAt, senderAccount.dailyCap, senderAccount.warmupOverride);
  const isCapReached = (senderAccount.sentToday || 0) >= warmup.allowedCap;

  useEffect(() => {
    if (initialTo && initialTo.email) {
      setToEmail(initialTo.email);
      setToName(initialTo.name);
      setCompany(initialTo.company);
    } else {
      setToEmail('');
      setToName('');
      setCompany('');
      setSubject('');
      setBody('');
      setErrorMessage(null);
      setAdminOverride(false);
      setIsSubmitting(false);
    }
  }, [initialTo, isOpen]);

  if (!isOpen) return null;

  const cleanRecipientEmail = toEmail.trim().toLowerCase();
  const recipientDomain = cleanRecipientEmail.split('@')[1] || '';

  // 1. DNC Check
  const isDnc = doNotContactList.some(d => 
    (d.type === 'email' && d.value.toLowerCase() === cleanRecipientEmail) ||
    (d.type === 'domain' && d.value.toLowerCase() === recipientDomain)
  );

  // 2. Collision Check: One contact belongs to ONE sender at a time
  const existingContact = contacts.find(c => c.email.toLowerCase() === cleanRecipientEmail);
  const isOwnedByOther = Boolean(existingContact?.ownerUserId && existingContact.ownerUserId !== currentUser.id);
  const ownerTeammate = isOwnedByOther ? users.find(u => u.id === existingContact?.ownerUserId) : null;

  // 3. Deliverability Linter
  const linterWarnings = lintEmailDeliverability({
    subject,
    body,
    hasAttachments: false,
    isFirstEmail: !existingContact || (existingContact.tags || []).includes('Outreach Batch 1')
  });

  const handleEmailChange = (val: string) => {
    setToEmail(val);
    setErrorMessage(null);
    if (val.trim().length > 1) {
      const matches = contacts.filter(c => 
        c.email.toLowerCase().includes(val.toLowerCase()) || 
        c.name.toLowerCase().includes(val.toLowerCase())
      ).map(c => ({ email: c.email, name: c.name, company: c.company }));
      setSuggestions(matches);
    } else {
      setSuggestions([]);
    }
  };

  const selectContact = (c: { email: string; name: string; company: string }) => {
    setToEmail(c.email);
    setToName(c.name);
    setCompany(c.company);
    setSuggestions([]);
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toEmail.trim() || !subject.trim() || !body.trim() || isSubmitting) return;

    if (isDnc) {
      setErrorMessage(`Cannot send: ${cleanRecipientEmail} is on the Do Not Contact list.`);
      return;
    }

    if (isCapReached) {
      setErrorMessage(`Daily outreach cap reached (${senderAccount.sentToday}/${warmup.allowedCap}). Resets at midnight PKT.`);
      return;
    }

    setIsSubmitting(true);
    const result = await composeEmail(toEmail, toName, company, subject, body, adminOverride);

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to send outreach');
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-md animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl max-h-[90vh] rounded-[28px] bg-white/[0.08] dark:bg-black/60 border border-white/15 backdrop-blur-3xl shadow-apple-window flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 px-6 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.03] dark:bg-black/20">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-white/95 tracking-tight">
                New Outreach Message
              </h3>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#0A84FF]/20 text-[#0A84FF] border border-[#0A84FF]/30">
                Personal Mailbox
              </span>
            </div>
            <p className="text-[11px] text-white/50 mt-0.5">
              Sending as <strong className="text-white/80 font-mono">{senderAccount.email}</strong> • Sent today: <span className="font-semibold text-white/80">{senderAccount.sentToday}/{warmup.allowedCap} PKT</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-3.5 overflow-y-auto flex-1">
          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center gap-2 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* DNC Warning */}
          {isDnc && (
            <div className="p-3 rounded-xl bg-[#FF453A]/20 border border-[#FF453A]/40 text-white text-xs flex items-start gap-2.5 animate-in fade-in">
              <ShieldAlert className="w-4 h-4 text-[#FF453A] shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-[#FF453A]">Do Not Contact Alert:</span>
                <span className="text-white/80 block mt-0.5">
                  This contact or company domain is on the Do Not Contact list. Sends are strictly blocked.
                </span>
              </div>
            </div>
          )}

          {/* Contact Collision Banner */}
          {isOwnedByOther && (
            <div className="p-3 rounded-xl bg-[#FF9F0A]/15 border border-[#FF9F0A]/30 text-white text-xs flex items-start justify-between gap-3 animate-in fade-in">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#FF9F0A] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-[#FF9F0A]">Contact Collision Guard</div>
                  <div className="text-[11px] text-white/70 mt-0.5">
                    {existingContact?.name || cleanRecipientEmail} was already contacted by <strong className="text-white">{ownerTeammate?.name || 'another teammate'}</strong> ({ownerTeammate?.connectedGmail || ownerTeammate?.email}).
                  </div>
                </div>
              </div>
              {currentUser.role === 'admin' && (
                <label className="flex items-center gap-1.5 shrink-0 cursor-pointer text-[11px] bg-white/10 px-2.5 py-1 rounded-lg border border-white/15 hover:bg-white/15">
                  <input
                    type="checkbox"
                    checked={adminOverride}
                    onChange={(e) => setAdminOverride(e.target.checked)}
                    className="rounded"
                  />
                  <span>Admin Override</span>
                </label>
              )}
            </div>
          )}

          {/* Deliverability Warnings */}
          {linterWarnings.length > 0 && (
            <div className="space-y-1.5">
              {linterWarnings.map((warn, i) => (
                <div key={i} className="p-2.5 rounded-xl bg-[#FFD60A]/10 border border-[#FFD60A]/20 text-[11px] text-[#FFD60A] flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{warn.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* To Email & Suggestions */}
          <div className="relative">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-1">
              Recipient Email *
            </label>
            <input
              type="email"
              required
              placeholder="e.g. founder@targetcompany.com"
              value={toEmail}
              onChange={(e) => handleEmailChange(e.target.value)}
              className="w-full text-xs p-2.5 rounded-xl border border-white/12 bg-white/[0.05] text-white placeholder-white/35 focus:outline-none focus:border-[#0A84FF]/60 font-mono"
            />
            {suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-black/85 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-apple-window z-20 max-h-40 overflow-y-auto divide-y divide-white/[0.06]">
                {suggestions.map(s => (
                  <div
                    key={s.email}
                    onClick={() => selectContact(s)}
                    className="p-2.5 text-xs hover:bg-white/10 cursor-pointer flex justify-between items-center transition-colors"
                  >
                    <span className="font-semibold text-white/95">{s.name} ({s.company})</span>
                    <span className="text-white/45 font-mono text-[11px]">{s.email}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Name & Company */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-1">
                Recipient Name
              </label>
              <input
                type="text"
                placeholder="e.g. Sarah Jenkins"
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-white/12 bg-white/[0.05] text-white placeholder-white/35 focus:outline-none focus:border-[#0A84FF]/60 font-sans"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-1">
                Company Name
              </label>
              <input
                type="text"
                placeholder="e.g. GreenPulse Tech"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-white/12 bg-white/[0.05] text-white placeholder-white/35 focus:outline-none focus:border-[#0A84FF]/60 font-sans"
              />
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-1">
              Subject Line *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Quick intro / Partnership inquiry"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full text-xs p-2.5 rounded-xl border border-white/12 bg-white/[0.05] text-white placeholder-white/35 focus:outline-none focus:border-[#0A84FF]/60 font-sans"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-1">
              Plain-Text Email Message *
            </label>
            <textarea
              required
              rows={6}
              placeholder="Write your email here (max 1 link recommended)..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full text-xs p-3 rounded-xl border border-white/12 bg-white/[0.05] text-white placeholder-white/35 focus:outline-none focus:border-[#0A84FF]/60 resize-none font-sans leading-relaxed min-h-[120px]"
            />
          </div>

          {/* Footer & Attribution */}
          <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs text-white/50">
              <span className="text-white/40">From:</span>
              <span className="font-semibold text-white/95 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${currentUser.color}`} />
                {currentUser.name} ({senderAccount.email})
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/[0.06] rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isDnc || isCapReached || (isOwnedByOther && !adminOverride)}
                className="flex items-center space-x-2 apple-primary-btn px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95 disabled:opacity-40 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" strokeWidth={2} />
                <span>{isSubmitting ? 'Sending...' : 'Queue Outreach (45-120s)'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
