'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { DoNotContactEntry } from '@/types';

export async function getDoNotContactListAction(): Promise<DoNotContactEntry[]> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return [];

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from('do_not_contact')
    .select(`
      id,
      type,
      value,
      reason,
      source,
      created_by_user_id,
      created_at,
      team_members:created_by_user_id (name)
    `)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data.map((item: any) => ({
    id: item.id,
    type: item.type as 'email' | 'domain',
    value: item.value,
    reason: item.reason,
    source: item.source,
    createdByUserId: item.created_by_user_id,
    createdByName: item.team_members?.name || 'System / Auto',
    createdAt: item.created_at
  }));
}

export async function addToDoNotContactAction(params: {
  type: 'email' | 'domain';
  value: string;
  reason: string;
  source?: 'auto_opt_out' | 'manual' | 'not_interested_action';
}): Promise<{ success: boolean; error?: string }> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();
  const { data: member } = await adminClient
    .from('team_members')
    .select('id')
    .eq('id', user.id)
    .single();

  const cleanValue = params.value.trim().toLowerCase().replace(/^@/, '');
  if (!cleanValue) return { success: false, error: 'Invalid value' };

  const { error } = await adminClient
    .from('do_not_contact')
    .upsert({
      type: params.type,
      value: cleanValue,
      reason: params.reason || 'User requested exclusion',
      source: params.source || 'manual',
      created_by_user_id: member?.id || null,
      created_at: new Date().toISOString()
    }, { onConflict: 'value' });

  if (error) return { success: false, error: error.message };

  // Log in audit trail
  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'dnc.add',
    metadata: { type: params.type, value: cleanValue, reason: params.reason }
  });

  return { success: true };
}

export async function removeFromDoNotContactAction(id: string): Promise<{ success: boolean; error?: string }> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();
  const { data: member } = await adminClient
    .from('team_members')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!member || member.role !== 'admin') {
    return { success: false, error: 'Only administrators can remove entries from Do Not Contact list.' };
  }

  const { error } = await adminClient
    .from('do_not_contact')
    .delete()
    .eq('id', id);

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'dnc.remove',
    metadata: { id }
  });

  return { success: true };
}

/**
 * "Not interested / Do not contact" action on a thread:
 * 1. Adds contact email to DNC list
 * 2. Archives the thread
 * 3. Cancels any pending reminders for this thread
 * 4. Updates contact status to Cold
 */
export async function markThreadNotInterestedAction(
  threadId: string, 
  contactEmail: string
): Promise<{ success: boolean; error?: string }> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();
  const cleanEmail = contactEmail.trim().toLowerCase();

  // 1. Add to DNC
  await adminClient.from('do_not_contact').upsert({
    type: 'email',
    value: cleanEmail,
    reason: 'Marked not interested from thread action',
    source: 'not_interested_action',
    created_at: new Date().toISOString()
  }, { onConflict: 'value' });

  // 2. Archive thread
  await adminClient
    .from('threads')
    .update({ archived: true, status: 'archived' })
    .eq('id', threadId);

  // 3. Cancel reminders
  await adminClient
    .from('reminders')
    .update({ status: 'auto_cancelled' })
    .eq('thread_id', threadId)
    .eq('status', 'pending');

  // 4. Update contact status to Cold
  await adminClient
    .from('contacts')
    .update({ status: 'Cold' })
    .eq('email', cleanEmail);

  // 5. Audit log
  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'thread.not_interested_dnc',
    metadata: { threadId, contactEmail: cleanEmail }
  });

  return { success: true };
}
