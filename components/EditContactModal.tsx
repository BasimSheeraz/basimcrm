'use client';

import React, { useState, useEffect } from 'react';
import { Contact, PipelineStatus } from '@/types';
import { X, CheckCircle2, User, Building2, Tag } from 'lucide-react';
import { editContactAction } from '@/lib/actions/contacts';

interface EditContactModalProps {
  contact: Contact | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (updatedContact: Contact) => void;
}

export function EditContactModal({ contact, isOpen, onClose, onSaved }: EditContactModalProps) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState<PipelineStatus>('Lead');
  const [phone, setPhone] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [dealSize, setDealSize] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (contact) {
      setName(contact.name || '');
      setCompany(contact.company || '');
      setStatus(contact.status || 'Lead');
      setPhone(contact.phone || '');
      setLinkedin(contact.linkedin || '');
      setDealSize(contact.dealSize || '');
      setTagsInput(contact.tags ? contact.tags.join(', ') : '');
    }
  }, [contact]);

  if (!isOpen || !contact) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const tagsArray = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const res = await editContactAction({
      id: contact.id,
      name: name.trim(),
      company: company.trim(),
      status,
      phone: phone.trim(),
      linkedin: linkedin.trim(),
      dealSize: dealSize.trim(),
      tags: tagsArray
    });

    setLoading(false);
    if (res.success) {
      onSaved({
        ...contact,
        name: name.trim(),
        company: company.trim(),
        status,
        phone: phone.trim(),
        linkedin: linkedin.trim(),
        dealSize: dealSize.trim(),
        tags: tagsArray
      });
      onClose();
    } else {
      setError(res.error || 'Failed to update contact');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-lg rounded-2xl bg-black/80 border border-white/15 backdrop-blur-3xl shadow-apple-window p-6 text-white overflow-hidden">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#0A84FF]/20 border border-[#0A84FF]/30 flex items-center justify-center text-[#0A84FF]">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white/95 tracking-tight">Edit Contact Details</h2>
              <p className="text-xs text-white/50">{contact.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mt-3 p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/60 block mb-1">Contact Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
              />
            </div>

            <div>
              <label className="text-xs text-white/60 block mb-1">Company</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/60 block mb-1">Pipeline Stage</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as PipelineStatus)}
                className="w-full text-xs px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
              >
                <option value="Lead" className="bg-slate-900 text-white">Lead</option>
                <option value="Contacted" className="bg-slate-900 text-white">Contacted</option>
                <option value="In Discussion" className="bg-slate-900 text-white">In Discussion</option>
                <option value="Meeting" className="bg-slate-900 text-white">Meeting</option>
                <option value="Client" className="bg-slate-900 text-white">Client</option>
                <option value="Cold" className="bg-slate-900 text-white">Cold</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-white/60 block mb-1">Deal Size</label>
              <input
                type="text"
                placeholder="e.g. $25,000 / yr"
                value={dealSize}
                onChange={(e) => setDealSize(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/60 block mb-1">Phone Number</label>
              <input
                type="text"
                placeholder="+1 (555) 000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
              />
            </div>

            <div>
              <label className="text-xs text-white/60 block mb-1">LinkedIn Profile</label>
              <input
                type="text"
                placeholder="linkedin.com/in/username"
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-white/60 block mb-1">Tags (comma separated)</label>
            <input
              type="text"
              placeholder="Enterprise, High Value, Q4"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-xl apple-primary-btn text-xs font-semibold shadow-sm disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
