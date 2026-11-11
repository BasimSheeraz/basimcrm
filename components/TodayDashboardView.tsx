'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { 
  Send, 
  MessageSquare, 
  AlertTriangle, 
  Clock, 
  Flame, 
  ShieldCheck, 
  RotateCcw,
  Sparkles,
  ChevronRight
} from 'lucide-react';
import { getPktTime } from '@/lib/deliverability';
import { Prospect } from '@/types';
import { getTodayProspectQueueAction, claimNextProspectAction } from '@/lib/actions/prospects';

interface TodayDashboardViewProps {
  onEmailProspect?: (prospect: Prospect) => void;
}

export function TodayDashboardView({ onEmailProspect }: TodayDashboardViewProps) {
  const { todayStats, currentUser, users, setActiveView } = useApp();
  const { teamTotals, accounts } = todayStats;
  const pkt = getPktTime();

  const [queuesByUser, setQueuesByUser] = useState<Record<string, Prospect[]>>({});
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [isClaimingNext, setIsClaimingNext] = useState(false);

  const loadQueue = async () => {
    setIsLoadingQueue(true);
    try {
      const res = await getTodayProspectQueueAction();
      if (res && res.queuesByUser) {
        setQueuesByUser(res.queuesByUser);
        setUnassignedCount(res.unassignedReadyCount || 0);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingQueue(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const handleNextUp = async () => {
    setIsClaimingNext(true);
    try {
      const res = await claimNextProspectAction();
      if (res.success && res.prospect) {
        if (onEmailProspect) {
          onEmailProspect(res.prospect);
        }
        await loadQueue();
      } else {
        alert(res.error || 'No prospects ready with an email.');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to claim next prospect');
    } finally {
      setIsClaimingNext(false);
    }
  };

  const totalAssignedInQueues = Object.values(queuesByUser).reduce(
    (acc, list) => acc + list.length,
    0
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 animate-in fade-in duration-200">
      {/* Top Banner with PKT Clock & Deliverability Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white/95 tracking-tight">Today's Outreach & Health</h1>
            <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-[#30D158]/20 text-[#30D158] border border-[#30D158]/30">
              Live PKT
            </span>
          </div>
          <p className="text-xs text-white/50">
            Automated warm-up schedules, send caps, and inbox deliverability metrics across all 3 personal Gmail mailboxes.
          </p>
        </div>

        <div className="flex items-center gap-3 bg-black/30 px-3.5 py-2 rounded-xl border border-white/10 text-xs">
          <Clock className="w-4 h-4 text-[#0A84FF]" />
          <div>
            <div className="text-[10px] text-white/40 uppercase tracking-wider font-mono">Pakistan Time (PKT)</div>
            <div className="font-mono text-white/90 font-medium">
              {pkt.hour.toString().padStart(2, '0')}:{pkt.minute.toString().padStart(2, '0')} PKT • {pkt.isBusinessHours ? 'Business Hours' : 'After Hours'}
            </div>
          </div>
        </div>
      </div>

      {/* Team Combined Summary Cards */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3 px-1">
          Combined Team Total
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Total Sent */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>Outreach Sent Today</span>
              <Send className="w-4 h-4 text-[#0A84FF]" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {teamTotals.sentToday}
            </div>
            <div className="text-[11px] text-white/40 flex items-center gap-1">
              <RotateCcw className="w-3 h-3 text-[#30D158]" />
              <span>Resets at midnight PKT</span>
            </div>
          </div>

          {/* Total Replies */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>Inbound Replies</span>
              <MessageSquare className="w-4 h-4 text-[#30D158]" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {teamTotals.repliesToday}
            </div>
            <div className="text-[11px] text-white/40">
              Excludes out-of-office & auto-replies
            </div>
          </div>

          {/* Total Bounces */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>Bounces & Delivery Failures</span>
              <AlertTriangle className="w-4 h-4 text-[#FF453A]" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {teamTotals.bouncesToday}
            </div>
            <div className="text-[11px] text-white/40">
              Auto-marks contacts as bad email
            </div>
          </div>

          {/* Follow-ups Due */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>Follow-ups Due</span>
              <Clock className="w-4 h-4 text-[#FF9F0A]" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {teamTotals.dueReminders}
            </div>
            <div className="text-[11px] text-white/40">
              Auto-cancels if contact replies
            </div>
          </div>
        </div>
      </div>

      {/* Per-Account / Per-Person Detailed Cards */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3 px-1">
          Individual Personal Mailboxes
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {accounts.map(account => {
            const isMe = account.ownerUserId === currentUser.id;
            const capPercent = Math.min(100, Math.round(((account.sentToday || 0) / (account.warmupLimit || 5)) * 100));

            return (
              <div 
                key={account.id}
                className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 ${
                  isMe 
                    ? 'bg-[#0A84FF]/[0.06] border-[#0A84FF]/30 shadow-[0_4px_25px_rgba(10,132,255,0.08)]' 
                    : 'bg-white/[0.03] border-white/10'
                }`}
              >
                <div>
                  {/* Account Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div className={`w-10 h-10 rounded-xl ${account.ownerColor || 'bg-blue-600'} text-white flex items-center justify-center font-bold text-sm shadow-sm ring-1 ring-white/20`}>
                        {account.ownerInitials || 'TM'}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-white/90 text-sm">
                            {account.ownerName}
                          </span>
                          {isMe && (
                            <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-[#0A84FF]/20 text-[#0A84FF] border border-[#0A84FF]/30 font-medium">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-white/50 font-mono">
                          {account.email}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      {account.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/25 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]" />
                          Active
                        </span>
                      ) : account.status === 'paused' ? (
                        <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-[#FF9F0A]/20 text-[#FF9F0A] border border-[#FF9F0A]/30 font-semibold">
                          Paused
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-[#FF453A]/20 text-[#FF453A] border border-[#FF453A]/30 font-semibold">
                          Reconnect
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Warmup Status Bar */}
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2 mb-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/60 flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-[#FF9F0A]" />
                        <span>Warm-up Week {account.warmupWeek || 1}</span>
                      </span>
                      <span className="font-mono text-white/80 font-medium">
                        {account.sentToday} / {account.warmupLimit} sent
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-300 ${
                          capPercent >= 100 ? 'bg-[#FF453A]' : 'bg-[#0A84FF]'
                        }`}
                        style={{ width: `${capPercent}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10.5px] text-white/40">
                      <span>Schedule: max {account.warmupLimit}/day</span>
                      <span>{capPercent}% used</span>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <div className="text-[10px] text-white/40 mb-0.5">Replies</div>
                      <div className="font-semibold text-white/90 text-sm">
                        {account.repliesToday || 0}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <div className="text-[10px] text-white/40 mb-0.5">Bounces</div>
                      <div className={`font-semibold text-sm ${account.bouncesToday ? 'text-[#FF453A]' : 'text-white/90'}`}>
                        {account.bouncesToday || 0}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <div className="text-[10px] text-white/40 mb-0.5">Due Follow-ups</div>
                      <div className={`font-semibold text-sm ${account.dueReminders ? 'text-[#FF9F0A]' : 'text-white/90'}`}>
                        {account.dueReminders || 0}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer action */}
                <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs">
                  <span className="text-[11px] text-white/40">
                    Cap: {account.dailyCap}/day (Hard max 30)
                  </span>
                  <button
                    onClick={() => {
                      setActiveView('inbox');
                    }}
                    className="text-[#0A84FF] hover:underline font-semibold text-[11px]"
                  >
                    View Mailbox →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Prospects To Contact Today Section */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/40">
              Prospects to Contact Today
            </h2>
            <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#0A84FF]/15 text-[#0A84FF] border border-[#0A84FF]/25 font-semibold">
              {totalAssignedInQueues} in queues • {unassignedCount} unassigned
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleNextUp}
              disabled={isClaimingNext}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl apple-primary-btn text-xs font-semibold shadow-sm active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-white" />
              <span>{isClaimingNext ? 'Claiming...' : 'Next Up'}</span>
            </button>
            <button
              onClick={() => setActiveView('prospects')}
              className="flex items-center gap-1 text-xs text-white/60 hover:text-white px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors cursor-pointer"
            >
              <span>View All</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Queues per team member */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {users.map((u) => {
            const isMe = u.id === currentUser.id;
            const userQueue = queuesByUser[u.id] || [];
            return (
              <div
                key={u.id}
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 ${
                  isMe
                    ? 'bg-[#0A84FF]/[0.05] border-[#0A84FF]/30 shadow-[0_4px_25px_rgba(10,132,255,0.06)]'
                    : 'bg-white/[0.03] border-white/10'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-white/[0.06]">
                    <div className="flex items-center space-x-2">
                      <div className={`w-6 h-6 rounded-lg ${u.color || 'bg-blue-600'} text-white flex items-center justify-center font-bold text-[10px]`}>
                        {u.initials || u.name.charAt(0)}
                      </div>
                      <span className="text-xs font-bold text-white/95">{u.name}</span>
                      {isMe && (
                        <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-[#0A84FF]/20 text-[#0A84FF] border border-[#0A84FF]/30 font-medium">
                          You
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-white/75 font-mono">
                      {userQueue.length} ready
                    </span>
                  </div>

                  {userQueue.length === 0 ? (
                    <div className="py-6 text-center text-xs text-white/35">
                      Queue empty. Click "Next Up" to pull an unassigned prospect!
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {userQueue.slice(0, 4).map((p) => (
                        <div
                          key={p.id}
                          className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/15 transition-colors flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-xs text-white/95 truncate">
                              {p.fullName}
                            </div>
                            <div className="text-[11px] text-white/50 truncate">
                              {p.company || p.email || 'No company'}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {p.email && onEmailProspect && (
                              <button
                                onClick={() => onEmailProspect(p)}
                                className="px-2 py-1 rounded-lg apple-primary-btn text-[11px] font-semibold transition-all active:scale-95 cursor-pointer flex items-center gap-1"
                              >
                                <Send className="w-2.5 h-2.5" />
                                <span>Email</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {userQueue.length > 4 && (
                        <div className="text-center text-[10.5px] text-white/40 pt-1">
                          +{userQueue.length - 4} more in queue
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-white/40">
                  <span>Assigned queue</span>
                  <button
                    onClick={() => setActiveView('prospects')}
                    className="text-[#0A84FF] hover:underline font-semibold"
                  >
                    Manage →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Safe Sending Deliverability Rules Guide */}
      <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3 text-xs text-white/60">
        <div className="flex items-center gap-2 text-white/80 font-semibold">
          <ShieldCheck className="w-4 h-4 text-[#30D158]" />
          <span>Deliverability Protection Rules Active</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
          <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
            <span className="font-semibold text-white/80 block">Random Delay Queue</span>
            <span>New outreach sends with 45-120s gaps between 9:00 - 18:00 PKT business hours.</span>
          </div>
          <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
            <span className="font-semibold text-white/80 block">Contact Collision Guard</span>
            <span>One contact belongs to 1 sender. Prevents duplicate team outreach.</span>
          </div>
          <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
            <span className="font-semibold text-white/80 block">Bounce & Opt-Out Shield</span>
            <span>Auto-detects mailer-daemon and opt-out keywords. Adds to Do Not Contact.</span>
          </div>
          <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
            <span className="font-semibold text-white/80 block">No Tracking Pixels</span>
            <span>Plain-text priority, no spyware pixels, max 1 link recommendation.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
