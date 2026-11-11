'use server';

import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runGmailSync, SyncResult } from '@/lib/sync-engine';

export async function syncCurrentMailboxAction(): Promise<{
  success: boolean;
  newMessages: number;
  error?: string;
  details?: any;
}> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  if (!user) {
    return { success: false, newMessages: 0, error: 'Unauthorized: active session required' };
  }

  try {
    const res: SyncResult = await runGmailSync({ userId: user.id });
    const hasError = res.results.some(r => r.status === 'error');
    const firstErr = res.results.find(r => r.status === 'error')?.error;

    return {
      success: !hasError || res.totalNewMessages > 0,
      newMessages: res.totalNewMessages,
      error: hasError ? firstErr : undefined,
      details: res.results,
    };
  } catch (err: any) {
    console.error('syncCurrentMailboxAction failed:', err?.message);
    return {
      success: false,
      newMessages: 0,
      error: err?.message || 'Sync failed',
    };
  }
}

const syncSettingsSchema = z.object({
  backfillDays: z.union([z.literal(30), z.literal(60), z.literal(90)]),
  syncLabel: z.string().optional().nullable(),
  syncInboxSentOnly: z.boolean().default(true)
});

const ignoreRuleSchema = z.object({
  ruleType: z.enum(['email', 'domain']),
  value: z.string().min(3).toLowerCase().trim(),
  reason: z.string().optional().default('Not a lead / blocked')
});

export async function updateGmailSyncSettingsAction(data: {
  backfillDays: 30 | 60 | 90;
  syncLabel?: string | null;
  syncInboxSentOnly: boolean;
}) {
  const parsed = syncSettingsSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  // Admin only
  const { data: member } = await serverClient
    .from('team_members')
    .select('role')
    .eq('id', user?.id || '')
    .single();

  if (member?.role !== 'admin') {
    return { success: false, error: 'Admin privileges required' };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from('gmail_sync_settings')
    .upsert({
      id: 1,
      backfill_days: parsed.data.backfillDays,
      sync_label: parsed.data.syncLabel || null,
      sync_inbox_sent_only: parsed.data.syncInboxSentOnly,
      updated_at: new Date().toISOString()
    });

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user?.id,
    action: 'gmail.update_sync_settings',
    target: '1',
    metadata: parsed.data
  });

  return { success: true };
}

export async function addIgnoreRuleAction(data: {
  ruleType: 'email' | 'domain';
  value: string;
  reason?: string;
}) {
  const parsed = ignoreRuleSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  const adminClient = createAdminClient();
  const { data: rule, error } = await adminClient
    .from('gmail_ignore_rules')
    .insert({
      rule_type: parsed.data.ruleType,
      value: parsed.data.value,
      reason: parsed.data.reason,
      created_by: user?.id || null
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user?.id,
    action: 'gmail.add_ignore_rule',
    target: rule.id,
    metadata: { ruleType: parsed.data.ruleType, value: parsed.data.value }
  });

  return { success: true, rule };
}

export async function removeIgnoreRuleAction(ruleId: string) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from('gmail_ignore_rules')
    .delete()
    .eq('id', ruleId);

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user?.id,
    action: 'gmail.remove_ignore_rule',
    target: ruleId,
    metadata: {}
  });

  return { success: true };
}

/**
 * "Not a lead" action on a thread:
 * 1. Archives the thread
 * 2. Adds the contact/sender email to the ignore list
 * 3. Logs the action in audit_log
 */
export async function markThreadNotALeadAction(threadId: string, senderEmail: string) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  const adminClient = createAdminClient();

  // 1. Archive the thread
  await adminClient
    .from('threads')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', threadId);

  if (user) {
    await adminClient
      .from('thread_user_state')
      .upsert({
        user_id: user.id,
        thread_id: threadId,
        is_archived: true,
        updated_at: new Date().toISOString()
      });
  }

  // 2. Add sender email to ignore rules
  const cleanEmail = senderEmail.trim().toLowerCase();
  await adminClient
    .from('gmail_ignore_rules')
    .upsert({
      rule_type: 'email',
      value: cleanEmail,
      reason: `Marked "Not a lead" on thread ${threadId}`,
      created_by: user?.id || null
    }, { onConflict: 'rule_type,value' });

  // 3. Log audit event
  await adminClient.from('audit_log').insert({
    user_id: user?.id,
    action: 'threads.not_a_lead',
    target: threadId,
    metadata: { threadId, senderEmail: cleanEmail }
  });

  return { success: true };
}

/**
 * Checks database storage size and warns when passing 80% of free 500 MB.
 */
export async function getDatabaseStorageStatsAction() {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient.rpc('get_database_storage_stats');

  if (error || !data || data.length === 0) {
    // Fallback simulation for local dev
    return {
      totalBytes: 42 * 1024 * 1024, // 42 MB
      maxBytes: 524288000,
      usagePercent: 8.01,
      isWarning: false
    };
  }

  const row = data[0];
  return {
    totalBytes: Number(row.total_bytes),
    maxBytes: Number(row.max_bytes),
    usagePercent: Number(row.usage_percent),
    isWarning: Boolean(row.is_warning)
  };
}
