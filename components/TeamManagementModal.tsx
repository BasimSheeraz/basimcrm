'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { 
  Users, 
  UserPlus, 
  Shield, 
  ShieldAlert, 
  Key, 
  RefreshCw, 
  X, 
  CheckCircle2, 
  AlertCircle,
  UserX,
  UserCheck,
  Clock,
  LogIn
} from 'lucide-react';
import { 
  addTeammateAction, 
  setTeammateActiveStatusAction, 
  changeTeammateRoleAction, 
  triggerPasswordResetAction,
  adminReset2FAAction,
  getAuthActivityLogsAction
} from '@/lib/actions/team';
import { formatLastSeen } from '@/lib/presence';
import { AuthActivityLog } from '@/types';

interface TeamManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TeamManagementModal({ isOpen, onClose }: TeamManagementModalProps) {
  const { users, currentUser } = useApp();
  const isAdmin = currentUser.role.includes('admin') || currentUser.systemRole === 'admin' || currentUser.name === 'Basim';

  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Recent auth activity logs
  const [activityLogs, setActivityLogs] = useState<AuthActivityLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  useEffect(() => {
    if (isOpen && isAdmin) {
      setIsLoadingLogs(true);
      getAuthActivityLogsAction()
        .then(logs => setActivityLogs(logs as AuthActivityLog[]))
        .catch(err => console.warn('Failed to load auth logs:', err))
        .finally(() => setIsLoadingLogs(false));
    }
  }, [isOpen, isAdmin]);

  if (!isOpen) return null;

  const handleAddTeammate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFeedback(null);

    const res = await addTeammateAction({
      name: name.trim(),
      email: email.trim(),
      role,
      initialPassword: password
    });

    setLoading(false);
    if (res.success) {
      setFeedback({ type: 'success', message: `Teammate ${name} added successfully with ${role} privileges!` });
      setName('');
      setEmail('');
      setPassword('');
      setShowAddForm(false);
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to add teammate' });
    }
  };

  const handleToggleActive = async (userId: string, currentActive: boolean) => {
    setLoading(true);
    setFeedback(null);
    const res = await setTeammateActiveStatusAction(userId, !currentActive);
    setLoading(false);
    if (res.success) {
      setFeedback({ type: 'success', message: `Status updated successfully!` });
    } else {
      setFeedback({ type: 'error', message: res.error || 'Action failed' });
    }
  };

  const handleChangeRole = async (userId: string, newRole: 'admin' | 'member') => {
    setLoading(true);
    setFeedback(null);
    const res = await changeTeammateRoleAction(userId, newRole);
    setLoading(false);
    if (res.success) {
      setFeedback({ type: 'success', message: `Role changed to ${newRole}!` });
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to change role' });
    }
  };

  const handleResetPassword = async (userId: string, targetEmail: string) => {
    setLoading(true);
    setFeedback(null);
    const res = await triggerPasswordResetAction(userId, targetEmail);
    setLoading(false);
    if (res.success) {
      setFeedback({ type: 'success', message: `Password reset email dispatched to ${targetEmail}!` });
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to send reset' });
    }
  };

  const handleReset2FA = async (userId: string, teammateName: string) => {
    if (!confirm(`Are you sure you want to reset 2FA for ${teammateName}? They will be required to re-enroll upon their next login.`)) {
      return;
    }
    setLoading(true);
    setFeedback(null);
    const res = await adminReset2FAAction(userId);
    setLoading(false);
    if (res.success) {
      setFeedback({ type: 'success', message: `2FA reset for ${teammateName}. Backup codes revoked.` });
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to reset 2FA' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-2xl rounded-2xl bg-black/80 border border-white/15 backdrop-blur-3xl shadow-apple-window p-6 text-white overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#0A84FF]/20 border border-[#0A84FF]/30 flex items-center justify-center text-[#0A84FF]">
              <Shield className="w-4 h-4" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white/95 tracking-tight">Team Management & Access Controls</h2>
              <p className="text-xs text-white/50">Admin-only directory for Basim, Ali Shah, and Moiz Ali</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div className={`mt-4 p-3 rounded-xl text-xs flex items-center gap-2 shrink-0 ${
            feedback.type === 'success' 
              ? 'bg-[#30D158]/15 border border-[#30D158]/30 text-[#30D158]' 
              : 'bg-red-500/15 border border-red-500/30 text-red-400'
          }`}>
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{feedback.message}</span>
          </div>
        )}

        {!isAdmin ? (
          <div className="py-8 text-center text-white/60">
            <ShieldAlert className="w-10 h-10 mx-auto text-[#FF9F0A] mb-2" />
            <p className="text-sm font-medium text-white/90">Administrator Access Required</p>
            <p className="text-xs text-white/50 mt-1">Only team administrators can view or modify team membership.</p>
          </div>
        ) : (
          <div className="mt-5 space-y-6 overflow-y-auto pr-1 flex-1">
            {/* Top Bar Action */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/40">Active Members ({users.length})</span>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl apple-primary-btn text-xs font-semibold shadow-sm"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{showAddForm ? 'Cancel' : 'Add Teammate'}</span>
              </button>
            </div>

            {/* Add Teammate Form */}
            {showAddForm && (
              <form onSubmit={handleAddTeammate} className="p-4 rounded-xl bg-white/[0.04] border border-white/10 space-y-3">
                <h3 className="text-xs font-semibold text-white/90">Add New Teammate</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-white/50 block mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Basim Khan"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-white/50 block mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="name@ourteam.io"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-white/50 block mb-1">Initial Password (min 12 chars)</label>
                    <input
                      type="password"
                      required
                      minLength={12}
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-white/50 block mb-1">System Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
                      className="w-full text-xs px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-[#0A84FF]"
                    >
                      <option value="member" className="bg-slate-900 text-white">Member</option>
                      <option value="admin" className="bg-slate-900 text-white">Admin (Full Access)</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-1.5 rounded-lg apple-primary-btn text-xs font-semibold disabled:opacity-50"
                  >
                    {loading ? 'Creating...' : 'Create Teammate'}
                  </button>
                </div>
              </form>
            )}

            {/* Teammates List */}
            <div className="space-y-2">
              {users.map(u => {
                const isSelf = u.id === currentUser.id;
                const isUserAdmin = u.role.includes('admin') || u.name === 'Basim';

                return (
                  <div 
                    key={u.id}
                    className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.05] transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-9 h-9 rounded-full ${u.color || 'bg-[#0A84FF]'} text-white flex items-center justify-center font-bold text-xs ring-1 ring-white/20`}>
                        {u.initials}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-semibold text-white/95">{u.name}</span>
                          {isSelf && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#0A84FF]/20 text-[#0A84FF] font-medium border border-[#0A84FF]/30">
                              You
                            </span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                            isUserAdmin ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-white/10 text-white/60'
                          }`}>
                            {isUserAdmin ? 'Admin' : 'Member'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[11px] text-white/40">{u.email}</p>
                          <span className="text-white/20">•</span>
                          <span className="text-[10.5px] text-white/50 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-white/30" />
                            Last login: <strong className="text-white/70 font-normal">{u.lastSeenAt ? formatLastSeen(u.lastSeenAt) : 'Never'}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-1.5 self-end sm:self-center">
                      <button
                        onClick={() => handleResetPassword(u.id, u.email)}
                        className="px-2 py-1 rounded-lg text-[11px] bg-white/[0.06] hover:bg-white/[0.12] text-white/80 transition-colors cursor-pointer"
                        title="Send password reset link"
                      >
                        Reset PW
                      </button>

                      <button
                        onClick={() => handleReset2FA(u.id, u.name)}
                        className="px-2 py-1 rounded-lg text-[11px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/20 transition-colors cursor-pointer"
                        title="Reset 2FA and revoke recovery codes"
                      >
                        Reset 2FA
                      </button>

                      {!isSelf && (
                        <>
                          <button
                            onClick={() => handleChangeRole(u.id, isUserAdmin ? 'member' : 'admin')}
                            className="px-2 py-1 rounded-lg text-[11px] bg-white/[0.06] hover:bg-white/[0.12] text-white/80 transition-colors cursor-pointer"
                            title="Toggle role between admin and member"
                          >
                            {isUserAdmin ? 'Make Member' : 'Make Admin'}
                          </button>

                          <button
                            onClick={() => handleToggleActive(u.id, u.isActive !== false)}
                            className={`px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer ${
                              u.isActive !== false
                                ? 'bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/20'
                                : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/20'
                            }`}
                            title="Immediately revoke or restore access"
                          >
                            {u.isActive !== false ? 'Deactivate' : 'Activate'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recent Login & Auth Activity Section */}
            <div className="pt-4 border-t border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Clock className="w-3.5 h-3.5 text-[#0A84FF]" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
                    Recent Login Activity
                  </span>
                </div>
                <span className="text-[10.5px] text-white/40 font-mono">
                  {activityLogs.length} events logged
                </span>
              </div>

              {isLoadingLogs ? (
                <div className="py-4 text-center text-xs text-white/40 animate-pulse">
                  Loading recent activity...
                </div>
              ) : activityLogs.length === 0 ? (
                <div className="py-4 text-center text-xs text-white/40">
                  No recent authentication events found.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {activityLogs.map(log => {
                    const isSuccess = log.action === 'auth.login_success';
                    const isFail = log.action === 'auth.login_failed';
                    const isLogout = log.action === 'auth.logout';

                    return (
                      <div 
                        key={log.id}
                        className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center space-x-2.5 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${
                            isSuccess ? 'bg-[#30D158]' : isFail ? 'bg-[#FF453A]' : 'bg-white/40'
                          }`} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-white/90 truncate">
                                {log.email}
                              </span>
                              <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-medium ${
                                isSuccess ? 'bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30' :
                                isFail ? 'bg-[#FF453A]/15 text-[#FF453A] border border-[#FF453A]/30' :
                                'bg-white/10 text-white/60'
                              }`}>
                                {isSuccess ? 'Sign In' : isFail ? 'Failed Attempt' : 'Sign Out'}
                              </span>
                            </div>
                            <div className="text-[10px] text-white/40 truncate mt-0.5">
                              {log.failureReason ? (
                                <span className="text-red-400">{log.failureReason}</span>
                              ) : (
                                log.userAgent || 'Web browser'
                              )}
                            </div>
                          </div>
                        </div>

                        <span className="text-[10.5px] text-white/40 shrink-0 font-mono">
                          {formatLastSeen(log.createdAt)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
