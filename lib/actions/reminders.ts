'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Reminder } from '@/types';

export async function createReminderAction(data: {
  threadId: string;
  contactId?: string;
  dueAt: string;
  note?: string;
}) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: 'Login required' };

  const adminClient = createAdminClient();
  const { data: reminder, error } = await adminClient
    .from('reminders')
    .insert({
      thread_id: data.threadId,
      contact_id: data.contactId || null,
      user_id: user.id,
      due_at: data.dueAt,
      note: data.note || 'Follow-up if no reply received',
      status: 'pending'
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'reminders.create',
    target: reminder.id,
    metadata: { dueAt: data.dueAt, threadId: data.threadId }
  });

  return { success: true, reminder };
}

export async function updateReminderStatusAction(reminderId: string, status: 'completed' | 'dismissed') {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: 'Login required' };

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from('reminders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', reminderId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function getDueRemindersAction(): Promise<{ reminders: Reminder[]; count: number }> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { reminders: [], count: 0 };

  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await adminClient
    .from('reminders')
    .select(`
      id,
      thread_id,
      contact_id,
      user_id,
      due_at,
      note,
      status,
      created_at,
      threads (subject),
      contacts (name)
    `)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .lte('due_at', now)
    .order('due_at', { ascending: true });

  if (error || !data) return { reminders: [], count: 0 };

  const reminders: Reminder[] = data.map((r: any) => ({
    id: r.id,
    threadId: r.thread_id,
    contactId: r.contact_id,
    userId: r.user_id,
    dueAt: r.due_at,
    note: r.note,
    status: r.status,
    createdAt: r.created_at,
    threadSubject: r.threads?.subject || 'Email Conversation',
    contactName: r.contacts?.name || 'Contact'
  }));

  return { reminders, count: reminders.length };
}
