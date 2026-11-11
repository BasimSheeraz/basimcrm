'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { 
  X, 
  Building2, 
  Mail, 
  Phone, 
  Clock, 
  Send, 
  StickyNote, 
  Plus
} from 'lucide-react';
import { PipelineStatus } from '@/types';

interface ContactDetailModalProps {
  onOpenComposeTo: (email: string, name: string, company: string) => void;
}

export function ContactDetailModal({ onOpenComposeTo }: ContactDetailModalProps) {
  const { 
    selectedContactId, 
    setSelectedContactId, 
    contacts, 
    messages, 
    notes, 
    users, 
    currentUser, 
    addInternalNote, 
    updateContactStatus,
    setSelectedThreadId,
    setActiveView
  } = useApp();

  const [activeTab, setActiveTab] = useState<'emails' | 'notes' | 'timeline'>('emails');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);

  React.useEffect(() => {
    if (selectedContactId) {
      import('@/lib/actions/contacts').then(({ getContactTimelineAction }) => {
        getContactTimelineAction(selectedContactId).then(setTimelineEvents).catch(() => {});
      });
    }
  }, [selectedContactId]);

  if (!selectedContactId) return null;

  const contact = contacts.find(c => c.id === selectedContactId);
  if (!contact) return null;

  const contactMessages = messages
    .filter(m => m.contactId === contact.id || m.toEmail.toLowerCase() === contact.email.toLowerCase() || m.fromEmail.toLowerCase() === contact.email.toLowerCase())
    .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

  const contactNotes = notes
    .filter(n => n.contactId === contact.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim()) return;
    addInternalNote(contact.id, newNoteContent);
    setNewNoteContent('');
  };

  const handleViewThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    setSelectedContactId(null);
    setActiveView('inbox');
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-md animate-in fade-in duration-200 select-none"
      onClick={() => setSelectedContactId(null)}
    >
      <div 
        className="w-full max-w-4xl max-h-[90vh] rounded-[28px] bg-white/[0.08] dark:bg-black/50 border border-white/15 backdrop-blur-3xl shadow-apple-window flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className="p-6 border-b border-white/[0.08] flex items-start justify-between bg-white/[0.03] dark:bg-black/20">
          <div className="flex items-start space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#0A84FF] to-[#5E5CE6] text-white flex items-center justify-center font-bold text-2xl shadow-[0_2px_15px_rgba(10,132,255,0.35)] shrink-0 ring-1 ring-white/20">
              {contact.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center space-x-3">
                <h2 className="text-xl font-bold text-white/95 tracking-tight">
                  {contact.name}
                </h2>
                <select
                  value={contact.status}
                  onChange={(e) => updateContactStatus(contact.id, e.target.value as PipelineStatus)}
                  className="text-xs font-semibold px-3 py-1 rounded-full border border-white/15 bg-white/[0.06] hover:bg-white/[0.1] text-white focus:outline-none cursor-pointer"
                >
                  <option value="Lead" className="text-slate-900 bg-white">Stage: Lead</option>
                  <option value="Contacted" className="text-slate-900 bg-white">Stage: Contacted</option>
                  <option value="In Discussion" className="text-slate-900 bg-white">Stage: In Discussion</option>
                  <option value="Meeting" className="text-slate-900 bg-white">Stage: Meeting Scheduled</option>
                  <option value="Client" className="text-slate-900 bg-white">Stage: Active Client</option>
                  <option value="Cold" className="text-slate-900 bg-white">Stage: Cold</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-white/60 mt-1.5">
                <span className="flex items-center gap-1.5 font-medium text-white/80">
                  <Building2 className="w-3.5 h-3.5 text-white/40" />
                  {contact.company}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1.5 font-mono text-white/50 text-[11px]">
                  <Mail className="w-3.5 h-3.5 text-white/40" />
                  {contact.email}
                </span>
                {contact.phone && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-white/40" />
                      {contact.phone}
                    </span>
                  </>
                )}
                {contact.dealSize && (
                  <>
                    <span>•</span>
                    <span className="font-semibold text-[#30D158]">
                      {contact.dealSize}
                    </span>
                  </>
                )}
              </div>

              {/* Tags */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                {contact.tags.map(tag => (
                  <span key={tag} className="px-2.5 py-0.5 rounded-full text-[10.5px] font-medium bg-white/[0.06] border border-white/10 text-white/70">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setSelectedContactId(null);
                onOpenComposeTo(contact.email, contact.name, contact.company);
              }}
              className="flex items-center space-x-2 apple-primary-btn px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Compose Email</span>
            </button>
            <button
              onClick={() => setSelectedContactId(null)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center px-6 border-b border-white/[0.08] bg-white/[0.02]">
          <button
            onClick={() => setActiveTab('emails')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'emails'
                ? 'border-[#0A84FF] text-[#0A84FF]'
                : 'border-transparent text-white/55 hover:text-white'
            }`}
          >
            <Mail className="w-4 h-4" />
            <span>Complete Email Timeline ({contactMessages.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('notes')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'notes'
                ? 'border-[#0A84FF] text-[#0A84FF]'
                : 'border-transparent text-white/55 hover:text-white'
            }`}
          >
            <StickyNote className="w-4 h-4" />
            <span>Private Team Notes ({contactNotes.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'timeline'
                ? 'border-[#0A84FF] text-[#0A84FF]'
                : 'border-transparent text-white/55 hover:text-white'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Activity Timeline</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-transparent">
          {activeTab === 'emails' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-white/50 mb-2">
                <span>History of all interactions sent & received on the shared Gmail:</span>
                <span className="text-[11px] text-white/40">First contacted: {new Date(contact.firstContactedAt).toLocaleDateString()}</span>
              </div>

              {contactMessages.length === 0 ? (
                <div className="p-8 text-center text-white/40 text-xs rounded-2xl bg-white/[0.03] border border-white/10">
                  No emails logged yet for this contact.
                </div>
              ) : (
                contactMessages.map((msg) => {
                  const isOutbound = msg.direction === 'outbound';
                  const author = msg.sentByUserId ? users.find(u => u.id === msg.sentByUserId) : null;

                  return (
                    <div
                      key={msg.id}
                      className={`p-4 rounded-2xl border transition-all ${
                        isOutbound
                          ? 'bg-[#0A84FF]/12 border-[#0A84FF]/25'
                          : 'bg-white/[0.04] border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2.5">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm ring-1 ring-white/20 ${
                            isOutbound ? (author ? author.color : 'bg-[#0A84FF]') : 'bg-slate-700'
                          }`}>
                            {isOutbound ? (author ? author.initials : 'HQ') : contact.name.charAt(0)}
                          </div>
                          <div>
                            <span className="text-xs font-bold text-white/95">
                              {msg.fromName}
                            </span>
                            {isOutbound && author && (
                              <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-[#0A84FF]/20 text-[#0A84FF] border border-[#0A84FF]/30 font-medium">
                                Written by {author.name}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 text-[11px] text-white/40">
                          <span>{new Date(msg.sentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          {msg.threadId && (
                            <button
                              onClick={() => handleViewThread(msg.threadId)}
                              className="text-[#0A84FF] hover:underline font-semibold text-[10.5px]"
                            >
                              Go to Thread →
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="text-xs font-semibold text-white/80 mb-1">
                        Subject: {msg.subject}
                      </div>

                      <p className="text-xs text-white/70 leading-relaxed whitespace-pre-line font-sans">
                        {msg.body}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          ) : activeTab === 'notes' ? (
            <div className="space-y-4">
              {/* Internal Notes composer */}
              <form onSubmit={handleAddNote} className="bg-white/[0.04] p-4 rounded-2xl border border-white/10 shadow-sm">
                <div className="flex items-center justify-between text-xs text-white/55 mb-2">
                  <span className="font-semibold text-white/90 flex items-center gap-1.5">
                    <StickyNote className="w-4 h-4 text-[#FFD60A]" />
                    <span>Leave a private internal note for the 3 of you</span>
                  </span>
                  <span className="text-[10px] text-white/40">Posting as {currentUser.name}</span>
                </div>
                <textarea
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="e.g. Elena asked for $40k pricing tier. Let's discuss before sending agreement..."
                  rows={3}
                  className="w-full text-xs p-3 rounded-xl border border-white/10 bg-white/[0.04] text-white placeholder-white/35 focus:outline-none focus:border-[#0A84FF]/60 resize-none font-sans"
                />
                <div className="flex justify-end mt-2">
                  <button
                    type="submit"
                    disabled={!newNoteContent.trim()}
                    className="flex items-center space-x-1.5 apple-primary-btn px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Internal Note</span>
                  </button>
                </div>
              </form>

              {/* List of Notes */}
              <div className="space-y-2.5">
                {contactNotes.length === 0 ? (
                  <div className="p-8 text-center text-white/40 text-xs rounded-2xl bg-white/[0.03] border border-white/10">
                    No private team notes for this contact yet. Add one above!
                  </div>
                ) : (
                  contactNotes.map(n => (
                    <div key={n.id} className="p-4 rounded-2xl border border-[#FF9F0A]/20 bg-[#FF9F0A]/10">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-2">
                          <div className={`w-5 h-5 rounded-full ${n.userColor} text-white flex items-center justify-center text-[9px] font-bold`}>
                            {n.userName.charAt(0)}
                          </div>
                          <span className="text-xs font-bold text-white/95">
                            {n.userName}
                          </span>
                        </div>
                        <span className="text-[10px] text-white/40">
                          {new Date(n.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-white/85 leading-relaxed whitespace-pre-line font-sans">
                        {n.content}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-white/50 mb-2">
                Unified audit and communication trail for this contact:
              </div>

              {timelineEvents.length === 0 ? (
                <div className="p-8 text-center text-white/40 text-xs rounded-2xl bg-white/[0.03] border border-white/10">
                  No activity history recorded yet.
                </div>
              ) : (
                <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-white/10">
                  {timelineEvents.map((ev) => (
                    <div key={ev.id} className="relative">
                      <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-[#0A84FF] ring-4 ring-black/40" />
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-white/95">{ev.title}</span>
                          <span className="text-[10px] text-white/40">
                            {new Date(ev.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {ev.description && (
                          <p className="text-[11.5px] text-white/60 leading-relaxed font-sans">
                            {ev.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
