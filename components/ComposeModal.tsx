'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { X, Send, AlertTriangle, ShieldAlert, ExternalLink, StickyNote, Sparkles, UserCheck, Globe, Link2 } from 'lucide-react';
import { 
  lintEmailDeliverability, 
  calculateWarmupDailyCap, 
  calculateSpamRisk, 
  detectDomainTypo, 
  isRoleAddress, 
  DEFAULT_OPT_OUT_SENTENCE 
} from '@/lib/deliverability';
import { interpolateSnippetVariables } from '@/lib/template';
import { normalizeEmail } from '@/lib/prospect-normalization';
import { Prospect, GmailAccountStatus } from '@/types';
import { getProspectForContactOrEmailAction } from '@/lib/actions/prospects';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTo?: { email: string; name: string; company: string; prospectId?: string };
}

export function ComposeModal({ isOpen, onClose, initialTo }: ComposeModalProps) {
  const { 
    contacts, 
    currentUser, 
    composeEmail, 
    gmailAccounts, 
    doNotContactList, 
    users,
    setIsComposeOpen,
    teammatePresences,
    setActiveProspectId,
    setActiveProspectKey
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
  const [linkedProspect, setLinkedProspect] = useState<Prospect | null>(null);
  const [includeOptOut, setIncludeOptOut] = useState(true);
  const [optOutSentence, setOptOutSentence] = useState(DEFAULT_OPT_OUT_SENTENCE);

  const userAccount = gmailAccounts.find(a => a.ownerUserId === currentUser.id);
  const hasConnectedGmail = Boolean(userAccount && !userAccount.email.endsWith('@ourteam.io') && userAccount.status !== 'needs_reconnect');

  const defaultAccount = {
    id: '',
    ownerUserId: currentUser.id,
    email: userAccount?.email || currentUser.email || 'user@ourteam.io',
    status: (userAccount?.status || 'active') as GmailAccountStatus,
    dailyCap: 5,
    sentToday: 0,
    warmupStartedAt: new Date().toISOString(),
    warmupOverride: false,
  };
  const senderAccount = userAccount || gmailAccounts[0] || defaultAccount;
  const warmup = calculateWarmupDailyCap(senderAccount.warmupStartedAt, senderAccount.dailyCap, senderAccount.warmupOverride);
  const isCapReached = (senderAccount.sentToday || 0) >= warmup.allowedCap;

  useEffect(() => {
    setIsComposeOpen(isOpen);
    if (!isOpen) {
      setActiveProspectId(null);
      setActiveProspectKey(null);
    }
    return () => {
      setIsComposeOpen(false);
      setActiveProspectId(null);
      setActiveProspectKey(null);
    };
  }, [isOpen, setIsComposeOpen, setActiveProspectId, setActiveProspectKey]);

  useEffect(() => {
    if (isOpen && initialTo && initialTo.email) {
      setToEmail(initialTo.email);
      setToName(initialTo.name);
      setCompany(initialTo.company);
      setErrorMessage(null);
      setAdminOverride(false);
      setIsSubmitting(false);

      const firstName = (initialTo.name || '').trim().split(/\s+/)[0] || 'there';
      const compName = (initialTo.company || '').trim() || 'your team';

      // Pre-fill starter outreach with {{first_name}} and {{company}} resolved when opened from a Prospect
      if (initialTo.prospectId) {
        const resolvedSubject = interpolateSnippetVariables('Quick question for {{company}}', {
          firstName,
          fullName: initialTo.name,
          company: compName,
          email: initialTo.email,
          senderName: currentUser.name,
        });
        const resolvedBody = interpolateSnippetVariables(
          `Hi {{first_name}},\n\nCame across {{company}} and loved what you're building.\n\nWould you be open to a quick chat this week?\n\nBest,\n${currentUser.name}`,
          {
            firstName,
            fullName: initialTo.name,
            company: compName,
            email: initialTo.email,
            senderName: currentUser.name,
          }
        );
        setSubject(resolvedSubject);
        setBody(resolvedBody);
      } else {
        setSubject('');
        setBody('');
      }
    } else if (!isOpen) {
      setToEmail('');
      setToName('');
      setCompany('');
      setSubject('');
      setBody('');
      setLinkedProspect(null);
      setErrorMessage(null);
      setAdminOverride(false);
      setIsSubmitting(false);
    }
  }, [initialTo, isOpen, currentUser.name]);

  // Lookup linked prospect when initialTo.prospectId or toEmail changes
  useEffect(() => {
    if (!isOpen) return;
    const normEmail = normalizeEmail(toEmail);
    setActiveProspectKey(normEmail || null);

    if (!initialTo?.prospectId && !normEmail) {
      setLinkedProspect(null);
      setActiveProspectId(null);
      return;
    }

    const timer = setTimeout(() => {
      getProspectForContactOrEmailAction({
        prospectId: initialTo?.prospectId,
        email: toEmail.trim() || undefined,
      })
        .then((p) => {
          setLinkedProspect(p);
          setActiveProspectId(p?.id || initialTo?.prospectId || null);
        })
        .catch(() => {});
    }, 200);

    return () => clearTimeout(timer);
  }, [isOpen, initialTo?.prospectId, toEmail, setActiveProspectId, setActiveProspectKey]);

  if (!isOpen) return null;

  const cleanRecipientEmail = toEmail.trim().toLowerCase();
  const normalizedRecipientEmail = normalizeEmail(cleanRecipientEmail);
  const recipientDomain = cleanRecipientEmail.split('@')[1] || '';

  // 1. DNC Check
  const isDnc = doNotContactList.some(d => 
    (d.type === 'email' && (d.value.toLowerCase() === cleanRecipientEmail || normalizeEmail(d.value) === normalizedRecipientEmail)) ||
    (d.type === 'domain' && d.value.toLowerCase() === recipientDomain)
  ) || linkedProspect?.status === 'do_not_contact';

  // 2. Collision Check: One contact belongs to ONE sender at a time
  const existingContact = contacts.find(c => c.email.toLowerCase() === cleanRecipientEmail || normalizeEmail(c.email) === normalizedRecipientEmail);
  const isOwnedByOther = Boolean(existingContact?.ownerUserId && existingContact.ownerUserId !== currentUser.id);
  const ownerTeammate = isOwnedByOther ? users.find(u => u.id === existingContact?.ownerUserId) : null;

  // 2b. Live Teammate Presence Check on this prospect / recipient
  const activeProspectIdVal = linkedProspect?.id || initialTo?.prospectId || null;
  const teammatesWorkingOnProspect = (teammatePresences || []).filter(tp => {
    if (tp.id === currentUser.id || tp.status === 'offline') return false;
    if (activeProspectIdVal && tp.currentProspectId === activeProspectIdVal) return true;
    if (normalizedRecipientEmail && tp.currentProspectKey === normalizedRecipientEmail) return true;
    return false;
  });

  // Resolve {{first_name}} and {{company}} variables in subject & body
  const firstName = (toName || linkedProspect?.fullName || '').trim().split(/\s+/)[0] || 'there';
  const resolvedSubject = interpolateSnippetVariables(subject, {
    firstName,
    fullName: toName || linkedProspect?.fullName || '',
    company: company || linkedProspect?.company || '',
    email: toEmail,
    senderName: currentUser.name,
  });
  const resolvedBody = interpolateSnippetVariables(body, {
    firstName,
    fullName: toName || linkedProspect?.fullName || '',
    company: company || linkedProspect?.company || '',
    email: toEmail,
    senderName: currentUser.name,
  });

  // 3. Deliverability Linter & Spam Risk Analysis
  const linterWarnings = lintEmailDeliverability({
    subject: resolvedSubject,
    body: resolvedBody,
    hasAttachments: false,
    isFirstEmail: !existingContact || (existingContact.tags || []).includes('Outreach Batch 1')
  });

  const spamRisk = calculateSpamRisk({
    subject: resolvedSubject,
    body: resolvedBody,
    hasAttachments: false,
    isFirstEmail: !existingContact || (existingContact.tags || []).includes('Outreach Batch 1')
  });

  const domainTypo = detectDomainTypo(cleanRecipientEmail);
  const isRole = isRoleAddress(cleanRecipientEmail);

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

  const insertVariableIntoBody = (variableName: string) => {
    const vars = {
      firstName,
      fullName: toName || linkedProspect?.fullName || '',
      company: company || linkedProspect?.company || '',
      email: toEmail,
      senderName: currentUser.name,
    };
    const resolvedVal = interpolateSnippetVariables(variableName, vars);
    setBody(prev => `${prev}${prev.endsWith(' ') || prev.length === 0 ? '' : ' '}${resolvedVal}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toEmail.trim() || !resolvedSubject.trim() || !resolvedBody.trim() || isSubmitting) return;

    if (isDnc) {
      setErrorMessage(`Cannot send: ${cleanRecipientEmail} is on the Do Not Contact list.`);
      return;
    }

    if (isCapReached) {
      setErrorMessage(`Daily outreach cap reached (${senderAccount.sentToday}/${warmup.allowedCap}). Resets at midnight PKT.`);
      return;
    }

    if (spamRisk.level === 'high' && !adminOverride) {
      setErrorMessage(`High spam risk (${spamRisk.score}/100): ${spamRisk.reasons.join('; ')}. Please edit content to reduce spam score.`);
      return;
    }

    const finalBody = includeOptOut && optOutSentence.trim()
      ? `${resolvedBody.trim()}\n\n---\n${optOutSentence.trim()}`
      : resolvedBody.trim();

    setIsSubmitting(true);
    const result = await composeEmail(
      toEmail,
      toName,
      company,
      resolvedSubject,
      finalBody,
      adminOverride,
      linkedProspect?.id || initialTo?.prospectId
    );

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
        className={`w-full ${linkedProspect ? 'max-w-4xl' : 'max-w-2xl'} max-h-[90vh] rounded-[28px] bg-white/[0.08] dark:bg-black/60 border border-white/15 backdrop-blur-3xl shadow-apple-window flex flex-col overflow-hidden transition-all`}
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
              {linkedProspect && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#5E5CE6]/20 text-[#5E5CE6] border border-[#5E5CE6]/30">
                  Linked Prospect
                </span>
              )}
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

        {/* Body + Side Panel Container */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Form Body */}
          <form onSubmit={handleSubmit} className="p-6 space-y-3.5 overflow-y-auto flex-1">
            {/* Live Presence Notice */}
            {teammatesWorkingOnProspect.length > 0 && (
              <div className="p-3 rounded-xl bg-[#FF9F0A]/15 border border-[#FF9F0A]/35 text-[#FF9F0A] text-xs flex items-center gap-2.5 animate-in fade-in">
                <span className="w-2 h-2 rounded-full bg-[#FF9F0A] animate-pulse shrink-0" />
                <span>
                  <strong>{teammatesWorkingOnProspect.map(t => t.name).join(', ')}</strong> is currently working on this prospect!
                </span>
              </div>
            )}

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

            {/* Typo Suggestion Banner */}
            {domainTypo && (
              <div className="p-2.5 rounded-xl bg-[#FF9F0A]/15 border border-[#FF9F0A]/30 text-white text-xs flex items-center justify-between gap-3 animate-in fade-in">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#FF9F0A] shrink-0" />
                  <span className="text-[11.5px]">
                    Possible typo: Did you mean <strong className="text-white">@{domainTypo}</strong>?
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const local = toEmail.split('@')[0];
                    setToEmail(`${local}@${domainTypo}`);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#FF9F0A]/20 hover:bg-[#FF9F0A]/30 text-[#FF9F0A] font-semibold text-[11px] transition-colors cursor-pointer"
                >
                  Fix Typo
                </button>
              </div>
            )}

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
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  Plain-Text Email Message *
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-white/35 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-[#0A84FF]" />
                    Variables:
                  </span>
                  <button
                    type="button"
                    onClick={() => insertVariableIntoBody('{{first_name}}')}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white/75 font-mono cursor-pointer"
                  >
                    + {"{{first_name}}"} ({firstName})
                  </button>
                  <button
                    type="button"
                    onClick={() => insertVariableIntoBody('{{company}}')}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white/75 font-mono cursor-pointer"
                  >
                    + {"{{company}}"} ({company || 'Company'})
                  </button>
                </div>
              </div>
              <textarea
                required
                rows={6}
                placeholder="Write your email here (variables like {{first_name}} and {{company}} resolve automatically)..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full text-xs p-3 rounded-xl border border-white/12 bg-white/[0.05] text-white placeholder-white/35 focus:outline-none focus:border-[#0A84FF]/60 resize-none font-sans leading-relaxed min-h-[120px]"
              />
              {(subject.includes('{{') || body.includes('{{')) && (
                <div className="mt-1.5 p-2.5 rounded-xl bg-[#0A84FF]/10 border border-[#0A84FF]/20 text-[11px] text-white/80">
                  <span className="font-semibold text-[#0A84FF] block mb-0.5">Resolved Preview:</span>
                  <div className="font-semibold text-white/90">{resolvedSubject}</div>
                  <div className="text-white/65 whitespace-pre-line mt-0.5">{resolvedBody}</div>
                </div>
              )}
            </div>

            {/* Honest Opt-Out Signature Sentence */}
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={includeOptOut}
                    onChange={(e) => setIncludeOptOut(e.target.checked)}
                    className="rounded text-[#0A84FF] focus:ring-0"
                  />
                  <span className="text-xs font-semibold text-white/80">Include one-line opt-out sentence</span>
                </div>
                <span className="text-[10px] text-white/45">Free Gmail protection</span>
              </label>
              {includeOptOut && (
                <input
                  type="text"
                  value={optOutSentence}
                  onChange={(e) => setOptOutSentence(e.target.value)}
                  className="w-full text-[11px] p-2 rounded-lg border border-white/10 bg-white/[0.04] text-white/80 focus:outline-none focus:border-[#0A84FF]/50 font-sans italic"
                />
              )}
            </div>

            {/* Spam Risk Meter */}
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
                    Spam Risk Meter
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    spamRisk.level === 'low'
                      ? 'bg-[#30D158]/20 text-[#30D158] border border-[#30D158]/30'
                      : spamRisk.level === 'medium'
                      ? 'bg-[#FF9F0A]/20 text-[#FF9F0A] border border-[#FF9F0A]/30'
                      : 'bg-[#FF453A]/20 text-[#FF453A] border border-[#FF453A]/30'
                  }`}>
                    {spamRisk.level} ({spamRisk.score}/100)
                  </span>
                </div>
                <span className="text-[10.5px] text-white/40">
                  {spamRisk.level === 'low' ? 'Good inbox placement' : spamRisk.level === 'medium' ? 'Review warnings' : 'Blocked: High risk'}
                </span>
              </div>
              
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div 
                  className={`h-full transition-all duration-300 ${
                    spamRisk.level === 'low' ? 'bg-[#30D158]' : spamRisk.level === 'medium' ? 'bg-[#FF9F0A]' : 'bg-[#FF453A]'
                  }`}
                  style={{ width: `${Math.max(8, spamRisk.score)}%` }}
                />
              </div>

              {spamRisk.reasons.length > 0 && (
                <div className="text-[11px] text-white/60 space-y-0.5 pt-1">
                  {spamRisk.reasons.map((r, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <span className="text-white/40">•</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer & Attribution */}
            <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs text-white/50">
                <span className="text-white/40">From:</span>
                {hasConnectedGmail ? (
                  <span className="font-semibold text-white/95 flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${currentUser.color}`} />
                    {currentUser.name} ({senderAccount.email})
                  </span>
                ) : (
                  <span className="font-medium text-amber-400 flex items-center gap-1.5">
                    No connected Gmail mailbox
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/[0.06] rounded-xl transition-all"
                >
                  Cancel
                </button>
                {!hasConnectedGmail ? (
                  <a
                    href="/api/auth/google"
                    className="flex items-center space-x-1.5 apple-primary-btn px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Connect Gmail to Send</span>
                  </a>
                ) : (
                  <button
                    type="submit"
                    disabled={isSubmitting || isDnc || isCapReached || (isOwnedByOther && !adminOverride) || (spamRisk.level === 'high' && !adminOverride)}
                    className="flex items-center space-x-2 apple-primary-btn px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95 disabled:opacity-40 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>{isSubmitting ? 'Sending via Gmail...' : 'Send Outreach'}</span>
                  </button>
                )}
              </div>
            </div>
          </form>

          {/* Prospect Side Panel (Social Links & Research Notes) */}
          {linkedProspect && (
            <div className="w-full md:w-[270px] shrink-0 border-t md:border-t-0 md:border-l border-white/[0.08] bg-white/[0.02] p-5 overflow-y-auto space-y-4">
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-white/40 mb-1">
                  Prospect Dossier
                </div>
                <div className="text-sm font-bold text-white/95">{linkedProspect.fullName}</div>
                {linkedProspect.company && (
                  <div className="text-xs text-white/60 mt-0.5">{linkedProspect.company}</div>
                )}
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.07] border border-white/10 text-white/75 font-medium">
                    Status: {linkedProspect.status}
                  </span>
                  {linkedProspect.source && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0A84FF]/15 border border-[#0A84FF]/25 text-[#0A84FF] font-medium">
                      {linkedProspect.source}
                    </span>
                  )}
                </div>
              </div>

              {/* Social Profiles */}
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#0A84FF]" />
                  <span>Social Profiles ({linkedProspect.socials.length})</span>
                </div>
                {linkedProspect.socials.length === 0 ? (
                  <div className="text-[11px] text-white/35 italic">No social profiles recorded.</div>
                ) : (
                  <div className="space-y-1.5">
                    {linkedProspect.socials.map(soc => (
                      <a
                        key={soc.id}
                        href={soc.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-xs text-white/85 transition-colors"
                      >
                        <div className="truncate">
                          <span className="text-[10px] uppercase tracking-wider text-white/45 block font-semibold">
                            {soc.platform}
                          </span>
                          <span className="font-mono text-[11px] text-[#0A84FF]">@{soc.handleNormalized}</span>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-white/40 shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Prospect Notes */}
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-white/40 mb-1.5 flex items-center gap-1.5">
                  <StickyNote className="w-3.5 h-3.5 text-[#FFD60A]" />
                  <span>Prospect Research Notes</span>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-white/75 whitespace-pre-line leading-relaxed">
                  {linkedProspect.notes ? linkedProspect.notes : <span className="text-white/35 italic">No research notes added.</span>}
                </div>
              </div>

              {/* Attribution */}
              <div className="pt-2 border-t border-white/[0.06] text-[11px] text-white/45 space-y-1">
                <div className="flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-white/40" />
                  <span>Added by <strong className="text-white/75">{linkedProspect.addedByName || 'Teammate'}</strong></span>
                </div>
                {linkedProspect.assignedToName && (
                  <div>Assigned to: <strong className="text-white/75">{linkedProspect.assignedToName}</strong></div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
