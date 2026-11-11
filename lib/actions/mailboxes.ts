'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GmailAccount, GmailAccountStatus } from '@/types';
import { calculateWarmupDailyCap } from '@/lib/deliverability';

export async function getGmailAccountsAction(): Promise<GmailAccount[]> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return [];

  const adminClient = createAdminClient();

  // Fetch current user's team member profile
  const { data: member } = await adminClient
    .from('team_members')
    .select('id, role, name')
    .eq('id', user.id)
    .single();

  if (!member) return [];

  const { data: accounts, error } = await adminClient
    .from('gmail_accounts')
    .select(`
      id,
      owner_user_id,
      email,
      status,
      connected_at,
      history_id,
      last_sync_at,
      daily_cap,
      warmup_started_at,
      warmup_override,
      pause_reason,
      team_members:owner_user_id (name, initials, color)
    `)
    .order('created_at', { ascending: true });

  if (error || !accounts) return [];

  return accounts.map((acc: any) => {
    const warmup = calculateWarmupDailyCap(acc.warmup_started_at, acc.daily_cap, acc.warmup_override);
    return {
      id: acc.id,
      ownerUserId: acc.owner_user_id,
      email: acc.email,
      status: acc.status as GmailAccountStatus,
      connectedAt: acc.connected_at,
      historyId: acc.history_id,
      lastSyncAt: acc.last_sync_at,
      dailyCap: acc.daily_cap,
      sentToday: 0,
      warmupStartedAt: acc.warmup_started_at,
      warmupOverride: acc.warmup_override,
      pauseReason: acc.pause_reason,
      ownerName: acc.team_members?.name || 'Teammate',
      ownerInitials: acc.team_members?.initials || 'TM',
      ownerColor: acc.team_members?.color || 'bg-blue-600',
      warmupLimit: warmup.allowedCap,
      warmupWeek: warmup.weekNumber,
    };
  });
}

export async function updateDailyCapAction(
  accountId: string, 
  newCap: number,
  warmupOverride: boolean = false
): Promise<{ success: boolean; error?: string }> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();
  const { data: member } = await adminClient
    .from('team_members')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!member || member.role !== 'admin') {
    return { success: false, error: 'Only administrators can modify send caps.' };
  }

  const cappedValue = Math.min(30, Math.max(1, newCap));

  const { error } = await adminClient
    .from('gmail_accounts')
    .update({ 
      daily_cap: cappedValue,
      warmup_override: warmupOverride,
      updated_at: new Date().toISOString()
    })
    .eq('id', accountId);

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'mailbox.update_cap',
    metadata: { accountId, newCap: cappedValue, warmupOverride }
  });

  return { success: true };
}

export async function setAccountStatusAction(
  accountId: string, 
  status: GmailAccountStatus,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();
  const { data: member } = await adminClient
    .from('team_members')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!member) return { success: false, error: 'Unauthorized' };

  // Only admin or account owner can change status
  const { data: acc } = await adminClient
    .from('gmail_accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .single();

  if (!acc) return { success: false, error: 'Account not found' };

  if (member.role !== 'admin' && acc.owner_user_id !== member.id) {
    return { success: false, error: 'You can only manage your own mailbox.' };
  }

  const { error } = await adminClient
    .from('gmail_accounts')
    .update({ 
      status, 
      pause_reason: reason || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', accountId);

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: `mailbox.${status}`,
    metadata: { accountId, status, reason }
  });

  return { success: true };
}
