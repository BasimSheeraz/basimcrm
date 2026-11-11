'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/store';
import { X, ShieldAlert, Plus, Trash2, Search, CheckCircle } from 'lucide-react';

interface DoNotContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DoNotContactModal({ isOpen, onClose }: DoNotContactModalProps) {
  const { doNotContactList, addToDnc, removeFromDnc, currentUser } = useApp();
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState<'email' | 'domain'>('email');
  const [newReason, setNewReason] = useState('');
  const [search, setSearch] = useState('');
  const [addedNotice, setAddedNotice] = useState(false);

  if (!isOpen) return null;

  const isAdmin = currentUser.role === 'admin' || currentUser.systemRole === 'admin';

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newValue.trim()) return;

    addToDnc(newValue.trim(), newType, newReason.trim() || 'Manual exclusion');
    setNewValue('');
    setNewReason('');
    setAddedNotice(true);
    setTimeout(() => setAddedNotice(false), 2000);
  };

  const filtered = doNotContactList.filter(item => 
    item.value.toLowerCase().includes(search.toLowerCase()) ||
    item.reason.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-md animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl max-h-[85vh] rounded-[28px] bg-white/[0.08] dark:bg-black/60 border border-white/15 backdrop-blur-3xl shadow-apple-window flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.03]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#FF453A] to-[#FF9F0A] text-white flex items-center justify-center shadow-sm ring-1 ring-white/20">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Do Not Contact (DNC) List</h2>
              <p className="text-xs text-white/50">
                Blocked emails and domains that can never be sent outreach by any team mailbox.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Add form */}
          <form onSubmit={handleAdd} className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white/80">Add Email or Domain to Exclusion List</span>
              {addedNotice && (
                <span className="text-[11px] text-[#30D158] flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> Added to DNC!
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as any)}
                className="text-xs px-3 py-2 rounded-xl border border-white/15 bg-white/[0.06] text-white focus:outline-none"
              >
                <option value="email" className="text-slate-900 bg-white">Specific Email</option>
                <option value="domain" className="text-slate-900 bg-white">Entire Domain (@...)</option>
              </select>

              <input
                type="text"
                placeholder={newType === 'email' ? 'e.g. competitor@agency.com' : 'e.g. competitor.com'}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="sm:col-span-2 text-xs px-3 py-2 rounded-xl border border-white/15 bg-white/[0.06] text-white placeholder-white/40 focus:outline-none"
              />
            </div>

            <div className="flex gap-2.5">
              <input
                type="text"
                placeholder="Reason (e.g. Explicit opt-out request / Competitor)"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                className="flex-1 text-xs px-3 py-2 rounded-xl border border-white/15 bg-white/[0.06] text-white placeholder-white/40 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newValue.trim()}
                className="apple-primary-btn px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </form>

          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search exclusions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white/[0.03] border border-white/10 text-white placeholder-white/40 focus:outline-none"
            />
          </div>

          {/* Table */}
          <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/[0.02]">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-white/50 border-b border-white/10 text-[11px] uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Value</th>
                  <th className="py-2.5 px-4">Reason / Source</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/80">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-white/40 text-xs">
                      No excluded contacts matching your search.
                    </td>
                  </tr>
                ) : (
                  filtered.map(item => (
                    <tr key={item.id} className="hover:bg-white/[0.03] transition-colors">
                      <td className="py-3 px-4">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          item.type === 'domain' 
                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' 
                            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        }`}>
                          {item.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-white/95">
                        {item.type === 'domain' ? `@${item.value}` : item.value}
                      </td>
                      <td className="py-3 px-4 text-white/60">
                        <div className="text-[11.5px]">{item.reason}</div>
                        <div className="text-[10px] text-white/35">
                          Source: {item.source} • Added by {item.createdByName || 'System'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isAdmin && (
                          <button
                            onClick={() => removeFromDnc(item.id)}
                            className="p-1.5 rounded-lg text-white/40 hover:text-[#FF453A] hover:bg-[#FF453A]/10 transition-colors"
                            title="Remove exclusion"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/[0.08] flex items-center justify-between bg-white/[0.02] text-xs text-white/50">
          <span>{doNotContactList.length} total active exclusions enforced on every send action.</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-white text-xs font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
