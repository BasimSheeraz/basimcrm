'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Draft } from '@/types';

export async function autosaveDraftAction(data: {
  threadId?: string | null;
  toEmail: string;
  ccEmail?: string;
  bccEmail?: string;
  subject: string;
  body: string;
  attachments?: { id: string; name: string; size: number; type: string }[];
}) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  if (!user) return { success: false, error: 'Login required' };

  const adminClient = createAdminClient();
  const { data: savedDraft, error } = await adminClient
    .from('drafts')
    .upsert({
      user_id: user.id,
      thread_id: data.threadId || null,
      to_email: data.toEmail || '',
      cc_email: data.ccEmail || '',
      bcc_email: data.bccEmail || '',
      subject: data.subject || '',
      body: data.body || '',
      attachments: data.attachments || [],
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,coalesce(thread_id, 00000000-0000-0000-0000-000000000000::uuid)'
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, draft: savedDraft };
}

export async function getDraftForThreadAction(threadId?: string | null): Promise<Draft | null> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return null;

  const adminClient = createAdminClient();
  let query = adminClient
    .from('drafts')
    .select('*')
    .eq('user_id', user.id);

  if (threadId) {
    query = query.eq('thread_id', threadId);
  } else {
    query = query.is('thread_id', null);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;

  return {
    id: data.id,
    userId: data.user_id,
    threadId: data.thread_id,
    toEmail: data.to_email,
    ccEmail: data.cc_email,
    bccEmail: data.bcc_email,
    subject: data.subject,
    body: data.body,
    attachments: data.attachments || [],
    updatedAt: data.updated_at
  };
}

export async function deleteDraftAction(threadId?: string | null) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false };

  const adminClient = createAdminClient();
  let query = adminClient
    .from('drafts')
    .delete()
    .eq('user_id', user.id);

  if (threadId) {
    query = query.eq('thread_id', threadId);
  } else {
    query = query.is('thread_id', null);
  }

  await query;
  return { success: true };
}
