'use client';

import React, { useState } from 'react';
import { Contact } from '@/types';
import { GitMerge, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { mergeContactsAction } from '@/lib/actions/contacts';

interface MergeContactModalProps {
  primaryContact: Contact | null;
  allContacts: Contact[];
  isOpen: boolean;
  onClose: () => void;
  onMerged: (sourceId: string, targetId: string) => void;
}

export function MergeContactModal({
  primaryContact,
  allContacts,
  isOpen,
  onClose,
  onMerged
}: MergeContactModalProps) {
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !primaryContact) return null;

  // Other contacts excluding primary
  const availableDuplicates = allContacts.filter(c => c.id !== primaryContact.id);
  const sourceContact = availableDuplicates.find(c => c.id === selectedSourceId);

  const handleMerge = async () => {
    if (!selectedSourceId) return;

    setLoading(true);
    setError(null);

    const res = await mergeContactsAction(selectedSourceId, primaryContact.id);
    setLoading(false);

    if (res.success) {
      onMerged(selectedSourceId, primaryContact.id);
      onClose();
    } else {
      setError(res.error || 'Failed to merge contacts');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-lg rounded-2xl bg-black/80 border border-white/15 backdrop-blur-3xl shadow-apple-window p-6 text-white overflow-hidden">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#0A84FF]/20 border border-[#0A84FF]/30 flex items-center justify-center text-[#0A84FF]">
              <GitMerge className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white/95 tracking-tight">Merge Duplicate Contacts</h2>
              <p className="text-xs text-white/50">Consolidate history and messages into one record</p>
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

        <div className="py-4 space-y-4">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Merging will move all conversations, email messages, notes, and reminders from the duplicate contact into <strong>{primaryContact.name} ({primaryContact.email})</strong>. The duplicate contact will then be safely deleted.
            </span>
          </div>

          <div>
            <label className="text-xs text-white/60 block mb-1.5 font-medium">
              Select Duplicate Contact to Merge:
            </label>
            <select
              value={selectedSourceId}
              onChange={(e) => setSelectedSourceId(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF] cursor-pointer"
            >
              <option value="" className="bg-slate-900 text-white">-- Choose contact to merge from --</option>
              {availableDuplicates.map(c => (
                <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                  {c.name} &bull; {c.email} ({c.company || 'No company'})
                </option>
              ))}
            </select>
          </div>

          {sourceContact && (
            <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs space-y-1.5">
              <div className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">Preview Merge Destination</div>
              <div className="flex justify-between text-white/80">
                <span>Keep:</span>
                <span className="font-semibold text-white">{primaryContact.name} ({primaryContact.email})</span>
              </div>
              <div className="flex justify-between text-white/80">
                <span>Merge & Delete:</span>
                <span className="text-red-400 font-medium">{sourceContact.name} ({sourceContact.email})</span>
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedSourceId || loading}
              onClick={handleMerge}
              className="px-4 py-1.5 rounded-xl apple-primary-btn text-xs font-semibold shadow-sm disabled:opacity-40"
            >
              {loading ? 'Merging...' : 'Confirm & Merge'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
