'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export interface SearchResultThread {
  id: string;
  subject: string;
  snippet: string;
  lastMessageAt: string;
  status: string;
  assignedToUserId: string;
  contactId: string;
  contactName: string;
  contactCompany: string;
  contactEmail: string;
  unread: boolean;
  starred: boolean;
}

/**
 * Real Postgres full-text search with pagination (30 items per page).
 */
export async function searchCrmThreadsAction(
  query: string,
  page: number = 0,
  pageSize: number = 30
): Promise<{ threads: SearchResultThread[]; hasMore: boolean }> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  const adminClient = createAdminClient();
  const offset = page * pageSize;

  // Use the search_crm RPC
  const { data, error } = await adminClient.rpc('search_crm', {
    p_query: query.trim() || null,
    p_limit: pageSize + 1, // +1 to check for hasMore
    p_offset: offset
  });

  if (error || !data) {
    console.warn('Search RPC error, returning empty list:', error);
    return { threads: [], hasMore: false };
  }

  const hasMore = data.length > pageSize;
  const items = data.slice(0, pageSize);

  // Fetch per-user read/starred state if user is logged in
  let userStates: Record<string, { is_read: boolean; is_starred: boolean }> = {};
  if (user && items.length > 0) {
    const threadIds = items.map((t: any) => t.thread_id);
    const { data: states } = await adminClient
      .from('thread_user_state')
      .select('thread_id, is_read, is_starred')
      .eq('user_id', user.id)
      .in('thread_id', threadIds);

    if (states) {
      for (const s of states) {
        userStates[s.thread_id] = s;
      }
    }
  }

  const threads: SearchResultThread[] = items.map((row: any) => {
    const state = userStates[row.thread_id];
    return {
      id: row.thread_id,
      subject: row.subject || '(No Subject)',
      snippet: row.snippet || '',
      lastMessageAt: row.last_message_at,
      status: row.status,
      assignedToUserId: row.assigned_to_user_id,
      contactId: row.contact_id,
      contactName: row.contact_name || 'Unknown',
      contactCompany: row.contact_company || 'Unknown',
      contactEmail: row.contact_email || '',
      unread: state ? !state.is_read : false,
      starred: state ? state.is_starred : false
    };
  });

  return { threads, hasMore };
}

/**
 * Loads full message bodies for a thread on-demand (lazy loading).
 * Only called when a user actually selects and opens the thread.
 */
export async function loadThreadMessagesLazyAction(threadId: string) {
  const adminClient = createAdminClient();
  const { data: messages, error } = await adminClient
    .from('messages')
    .select(`
      id,
      thread_id,
      contact_id,
      direction,
      from_email,
      from_name,
      to_email,
      cc_email,
      bcc_email,
      subject,
      body_text,
      body_html,
      sent_at,
      sent_by_user_id,
      attachments (
        id,
        filename,
        mime_type,
        size,
        gmail_attachment_id
      )
    `)
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: true });

  if (error || !messages) {
    return { success: false, error: error?.message || 'Failed to load messages', messages: [] };
  }

  return { success: true, messages };
}

export async function toggleThreadStarAction(threadId: string): Promise<{ success: boolean; starred: boolean }> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, starred: false };

  const adminClient = createAdminClient();
  const { data: current } = await adminClient
    .from('thread_user_state')
    .select('is_starred')
    .eq('user_id', user.id)
    .eq('thread_id', threadId)
    .maybeSingle();

  const nextStarred = !current?.is_starred;
  await adminClient
    .from('thread_user_state')
    .upsert({
      user_id: user.id,
      thread_id: threadId,
      is_starred: nextStarred,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,thread_id' });

  return { success: true, starred: nextStarred };
}

export async function markThreadReadAction(threadId: string, isRead: boolean = true): Promise<{ success: boolean }> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false };

  const adminClient = createAdminClient();
  await adminClient
    .from('thread_user_state')
    .upsert({
      user_id: user.id,
      thread_id: threadId,
      is_read: isRead,
      last_read_at: isRead ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,thread_id' });

  return { success: true };
}

export async function assignThreadAction(threadId: string, assignedToUserId: string): Promise<{ success: boolean }> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false };

  const adminClient = createAdminClient();
  await adminClient
    .from('threads')
    .update({
      assigned_to_user_id: assignedToUserId,
      updated_at: new Date().toISOString()
    })
    .eq('id', threadId);

  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'threads.assign',
    target: threadId,
    metadata: { assigned_to: assignedToUserId }
  });

  return { success: true };
}
