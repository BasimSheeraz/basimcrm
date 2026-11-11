'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { 
  Users, 
  Search, 
  Mail, 
  Clock, 
  ChevronRight, 
  Plus, 
  MessageSquare,
  Download,
  Edit2,
  GitMerge
} from 'lucide-react';
import { PipelineStatus, Contact } from '@/types';
import { EditContactModal } from '@/components/EditContactModal';
import { MergeContactModal } from '@/components/MergeContactModal';

interface ContactsViewProps {
  onOpenComposeTo: (email: string, name: string, company: string) => void;
}

export function ContactsView({ onOpenComposeTo }: ContactsViewProps) {
  const { 
    contacts, 
    users, 
    updateContactStatus, 
    setSelectedContactId, 
    messages 
  } = useApp();

  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [mergingContact, setMergingContact] = useState<Contact | null>(null);

  const filteredContacts = contacts.filter(c => {
    if (selectedStatus !== 'all' && c.status !== selectedStatus) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match = c.name.toLowerCase().includes(q) ||
                    c.email.toLowerCase().includes(q) ||
                    c.company.toLowerCase().includes(q) ||
                    c.tags.some(t => t.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const totalContacts = contacts.length;
  const activeOpportunities = contacts.filter(c => ['In Discussion', 'Meeting', 'Contacted'].includes(c.status)).length;
  const clientCount = contacts.filter(c => c.status === 'Client').length;

  const getStageStyle = (status: PipelineStatus) => {
    switch (status) {
      case 'Lead':
        return { color: '#FF9F0A', bg: 'rgba(255, 159, 10, 0.15)' };
      case 'Contacted':
        return { color: '#0A84FF', bg: 'rgba(10, 132, 255, 0.15)' };
      case 'In Discussion':
        return { color: '#BF5AF2', bg: 'rgba(191, 90, 242, 0.15)' };
      case 'Meeting':
        return { color: '#5E5CE6', bg: 'rgba(94, 92, 230, 0.15)' };
      case 'Client':
        return { color: '#30D158', bg: 'rgba(48, 209, 88, 0.15)' };
      case 'Cold':
      default:
        return { color: '#8E8E93', bg: 'rgba(142, 142, 147, 0.15)' };
    }
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Name', 'Email', 'Company', 'Status', 'Tags', 'First Contacted', 'Last Contacted', 'Phone', 'LinkedIn', 'Deal Size'];
    const rows = filteredContacts.map(c => [
      c.id,
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${c.email}"`,
      `"${(c.company || '').replace(/"/g, '""')}"`,
      c.status,
      `"${(c.tags || []).join(', ')}"`,
      c.firstContactedAt,
      c.lastContactedAt,
      `"${c.phone || ''}"`,
      `"${c.linkedin || ''}"`,
      `"${c.dealSize || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `basim-crm-contacts-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 flex flex-col bg-white/[0.02] dark:bg-black/10 overflow-y-auto select-none">
      {/* Top Banner & CRM Metrics */}
      <div className="p-6 md:p-8 bg-white/[0.03] dark:bg-black/20 border-b border-white/[0.08] backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-white/95 tracking-tight flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#0A84FF]/20 border border-[#0A84FF]/30 flex items-center justify-center text-[#0A84FF] shadow-sm">
                <Users className="w-4.5 h-4.5" strokeWidth={1.75} />
              </div>
              <span>Everyone We Have Mailed</span>
            </h2>
            <p className="text-[13px] text-white/55 mt-1 font-normal">
              Automated contact registry with duplicate merging, stage tracking, and CSV export.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportCSV}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white/80 hover:text-white transition-all active:scale-95 cursor-pointer shadow-sm"
              title="Export filtered contacts to CSV spreadsheet"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={() => onOpenComposeTo('', '', '')}
              className="flex items-center space-x-2 apple-primary-btn px-4 py-2 rounded-xl text-[12.5px] font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" strokeWidth={2} />
              <span>Add / Mail Contact</span>
            </button>
          </div>
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-2xl bg-white/[0.04] dark:bg-white/[0.03] border border-white/10 shadow-sm backdrop-blur-md">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Total People Contacted</div>
            <div className="text-2xl font-bold text-white/95 mt-1.5">{totalContacts}</div>
            <div className="text-[11px] text-[#30D158] mt-1.5 flex items-center gap-1.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]"></span>
              <span>Auto-synced from 1 Shared Gmail</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white/[0.04] dark:bg-white/[0.03] border border-white/10 shadow-sm backdrop-blur-md">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Active Pipeline Opportunities</div>
            <div className="text-2xl font-bold text-[#0A84FF] mt-1.5">{activeOpportunities}</div>
            <div className="text-[11px] text-white/45 mt-1.5">
              In Discussion, Meetings or Contacted
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white/[0.04] dark:bg-white/[0.03] border border-white/10 shadow-sm backdrop-blur-md">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Active Clients Closed</div>
            <div className="text-2xl font-bold text-[#30D158] mt-1.5">{clientCount}</div>
            <div className="text-[11px] text-white/45 mt-1.5">
              Signed partnerships & active retainers
            </div>
          </div>
        </div>
      </div>

      {/* Controls & Filter Bar */}
      <div className="p-4 md:px-8 flex flex-col md:flex-row items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.02] dark:bg-black/15 backdrop-blur-xl sticky top-0 z-10">
        <div className="relative w-full md:w-80">
          <Search className="w-3.5 h-3.5 absolute left-3.5 top-2.5 text-white/40" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="Search by name, company, email, or tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/[0.05] hover:bg-white/[0.08] focus:bg-white/[0.1] text-[13px] rounded-2xl pl-9 pr-3 py-2 text-white/90 placeholder-white/40 border border-white/10 focus:border-[#0A84FF]/60 focus:outline-none transition-all shadow-sm"
          />
        </div>

        <div className="flex items-center space-x-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {['all', 'Lead', 'Contacted', 'In Discussion', 'Meeting', 'Client', 'Cold'].map((stage) => {
            const isSelected = selectedStatus === stage;
            const stageInfo = stage !== 'all' ? getStageStyle(stage as PipelineStatus) : null;

            return (
              <button
                key={stage}
                onClick={() => setSelectedStatus(stage)}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-[#0A84FF] text-white shadow-sm'
                    : 'bg-white/[0.05] hover:bg-white/[0.1] text-white/70 hover:text-white border border-white/10'
                }`}
              >
                {stageInfo && !isSelected && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: stageInfo.color }} />
                )}
                {stage === 'all' ? 'All Contacts' : stage}
              </button>
            );
          })}
        </div>
      </div>

      {/* Contacts List */}
      <div className="p-4 md:p-8 space-y-3">
        {filteredContacts.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center text-white/40">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-40" strokeWidth={1.5} />
            <div className="text-[14px] font-semibold text-white/70">No contacts found</div>
            <p className="text-xs text-white/40 mt-1">Try adjusting your search terms or filter.</p>
          </div>
        ) : (
          filteredContacts.map(contact => {
            const lastContactUser = users.find(u => u.id === contact.lastContactedByUserId);
            const contactMessages = messages.filter(m => m.contactId === contact.id);

            return (
              <div
                key={contact.id}
                onClick={() => setSelectedContactId(contact.id)}
                className="rounded-2xl p-4 md:p-5 bg-white/[0.04] dark:bg-white/[0.03] border border-white/10 hover:border-white/20 hover:bg-white/[0.08] dark:hover:bg-white/[0.06] transition-all duration-200 shadow-sm hover:shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer group"
              >
                {/* Left: Identity & Details */}
                <div className="flex items-start space-x-3.5 min-w-[280px]">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#0A84FF] to-[#5E5CE6] text-white flex items-center justify-center font-bold text-sm shadow-sm ring-1 ring-white/20 shrink-0">
                    {contact.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="text-[14.5px] font-semibold text-white/95 group-hover:text-[#0A84FF] transition-colors">
                        {contact.name}
                      </h4>
                      <span className="text-xs font-medium text-white/55">
                        @ {contact.company}
                      </span>
                    </div>

                    <div className="text-xs text-white/40 mt-0.5 flex items-center gap-2">
                      <span>{contact.email}</span>
                      {contact.dealSize && (
                        <span className="text-[#30D158] font-semibold">
                          • {contact.dealSize}
                        </span>
                      )}
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {contact.tags.map(t => (
                        <span key={t} className="px-2 py-0.5 rounded-full text-[10.5px] bg-white/[0.06] border border-white/10 text-white/60 font-medium">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Middle: Status & Last Activity */}
                <div className="flex items-center space-x-6 text-xs text-white/60">
                  <div onClick={(e) => e.stopPropagation()} className="flex flex-col">
                    <span className="text-[10px] uppercase font-semibold text-white/40 mb-1 tracking-wider">Stage</span>
                    <select
                      value={contact.status}
                      onChange={(e) => updateContactStatus(contact.id, e.target.value as PipelineStatus)}
                      className="text-xs font-semibold px-2.5 py-1 rounded-full border border-white/15 bg-white/[0.06] hover:bg-white/[0.1] text-white focus:outline-none cursor-pointer"
                    >
                      <option value="Lead" className="text-slate-900 bg-white">Lead</option>
                      <option value="Contacted" className="text-slate-900 bg-white">Contacted</option>
                      <option value="In Discussion" className="text-slate-900 bg-white">In Discussion</option>
                      <option value="Meeting" className="text-slate-900 bg-white">Meeting</option>
                      <option value="Client" className="text-slate-900 bg-white">Client</option>
                      <option value="Cold" className="text-slate-900 bg-white">Cold</option>
                    </select>
                  </div>

                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-semibold text-white/40 mb-1 tracking-wider">Last Emailed</span>
                    <div className="flex items-center space-x-1.5 text-xs text-white/85 font-medium">
                      <Clock className="w-3.5 h-3.5 text-white/40" />
                      <span>{new Date(contact.lastContactedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                      {lastContactUser && (
                        <span className="text-[11px] text-white/45">
                          by <strong className="text-white/80">{lastContactUser.name.split(' ')[0]}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="hidden sm:flex flex-col">
                    <span className="text-[10px] uppercase font-semibold text-white/40 mb-1 tracking-wider">Exchanges</span>
                    <div className="flex items-center space-x-1 text-white/70 font-semibold">
                      <MessageSquare className="w-3.5 h-3.5 text-white/40" />
                      <span>{contactMessages.length || 1} emails</span>
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center space-x-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setEditingContact(contact)}
                    className="p-1.5 rounded-xl text-white/50 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] transition-colors"
                    title="Edit contact details"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => setMergingContact(contact)}
                    className="p-1.5 rounded-xl text-white/50 hover:text-[#0A84FF] bg-white/[0.05] hover:bg-white/[0.1] transition-colors"
                    title="Merge duplicate contacts"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => onOpenComposeTo(contact.email, contact.name, contact.company)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white/80 hover:text-white transition-all active:scale-95 cursor-pointer"
                    title="Send a new email to this contact"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Email</span>
                  </button>

                  <button
                    onClick={() => setSelectedContactId(contact.id)}
                    className="flex items-center space-x-1.5 apple-primary-btn px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
                  >
                    <span>Dossier</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Edit Contact Modal */}
      <EditContactModal
        contact={editingContact}
        isOpen={Boolean(editingContact)}
        onClose={() => setEditingContact(null)}
        onSaved={(updated) => {
          updateContactStatus(updated.id, updated.status);
          setEditingContact(null);
        }}
      />

      {/* Merge Contact Modal */}
      <MergeContactModal
        primaryContact={mergingContact}
        allContacts={contacts}
        isOpen={Boolean(mergingContact)}
        onClose={() => setMergingContact(null)}
        onMerged={() => setMergingContact(null)}
      />
    </div>
  );
}
