'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { TodayDashboardStats } from '@/types';
import { calculateWarmupDailyCap } from '@/lib/deliverability';

export async function getTodayDashboardStatsAction(): Promise<TodayDashboardStats> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) {
    return {
      teamTotals: { sentToday: 0, repliesToday: 0, bouncesToday: 0, dueReminders: 0 },
      accounts: []
    };
  }

  const adminClient = createAdminClient();

  // Try calling PostgreSQL RPC
  const { data: rpcData, error } = await adminClient.rpc('get_today_dashboard_stats');

  if (!error && rpcData) {
    const raw = rpcData as any;
    const accounts = (raw.accounts || []).map((acc: any) => {
      const warmup = calculateWarmupDailyCap(acc.warmupStartedAt, acc.dailyCap, acc.warmupOverride);
      return {
        ...acc,
        warmupLimit: warmup.allowedCap,
        warmupWeek: warmup.weekNumber,
      };
    });

    return {
      teamTotals: raw.teamTotals || { sentToday: 0, repliesToday: 0, bouncesToday: 0, dueReminders: 0 },
      accounts,
    };
  }

  // Fallback: Query accounts and calculate
  const { data: accounts } = await adminClient
    .from('gmail_accounts')
    .select(`
      id, owner_user_id, email, status, pause_reason, daily_cap, 
      warmup_started_at, warmup_override,
      team_members:owner_user_id (name, initials, color)
    `);

  if (!accounts) {
    return {
      teamTotals: { sentToday: 0, repliesToday: 0, bouncesToday: 0, dueReminders: 0 },
      accounts: []
    };
  }

  const mapped = accounts.map((acc: any) => {
    const warmup = calculateWarmupDailyCap(acc.warmup_started_at, acc.daily_cap, acc.warmup_override);
    return {
      id: acc.id,
      ownerUserId: acc.owner_user_id,
      ownerName: acc.team_members?.name || 'Teammate',
      ownerInitials: acc.team_members?.initials || 'TM',
      ownerColor: acc.team_members?.color || 'bg-blue-600',
      email: acc.email,
      status: acc.status,
      pauseReason: acc.pause_reason,
      sentToday: 0,
      dailyCap: acc.daily_cap,
      warmupLimit: warmup.allowedCap,
      warmupStartedAt: acc.warmup_started_at,
      warmupOverride: acc.warmup_override,
      repliesToday: 0,
      bouncesToday: 0,
      dueReminders: 0,
      warmupWeek: warmup.weekNumber
    };
  });

  return {
    teamTotals: { sentToday: 0, repliesToday: 0, bouncesToday: 0, dueReminders: 0 },
    accounts: mapped
  };
}
