'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Snippet, Signature } from '@/types';

export async function getUserSnippetsAction(): Promise<Snippet[]> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return [];

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from('snippets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (!data) return [];
  return data.map((s: any) => ({
    id: s.id,
    userId: s.user_id,
    title: s.title,
    body: s.body,
    shortcut: s.shortcut,
    createdAt: s.created_at,
    updatedAt: s.updated_at
  }));
}

export async function saveSnippetAction(data: {
  id?: string;
  title: string;
  body: string;
  shortcut?: string;
}) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: 'Login required' };

  const adminClient = createAdminClient();
  const payload = {
    user_id: user.id,
    title: data.title.trim(),
    body: data.body.trim(),
    shortcut: data.shortcut?.trim() || null,
    updated_at: new Date().toISOString()
  };

  if (data.id) {
    const { error } = await adminClient
      .from('snippets')
      .update(payload)
      .eq('id', data.id)
      .eq('user_id', user.id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await adminClient
      .from('snippets')
      .insert(payload);
    if (error) return { success: false, error: error.message };
  }

  return { success: true };
}

export async function deleteSnippetAction(snippetId: string) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false };

  const adminClient = createAdminClient();
  await adminClient
    .from('snippets')
    .delete()
    .eq('id', snippetId)
    .eq('user_id', user.id);

  return { success: true };
}

export async function getUserSignaturesAction(): Promise<Signature[]> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return [];

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from('signatures')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (!data) return [];
  return data.map((s: any) => ({
    id: s.id,
    userId: s.user_id,
    title: s.title,
    content: s.content,
    isDefault: s.is_default,
    createdAt: s.created_at,
    updatedAt: s.updated_at
  }));
}

export async function saveSignatureAction(data: {
  id?: string;
  title: string;
  content: string;
  isDefault: boolean;
}) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: 'Login required' };

  const adminClient = createAdminClient();

  if (data.isDefault) {
    // Clear default on other signatures for this user
    await adminClient
      .from('signatures')
      .update({ is_default: false })
      .eq('user_id', user.id);
  }

  const payload = {
    user_id: user.id,
    title: data.title.trim(),
    content: data.content.trim(),
    is_default: data.isDefault,
    updated_at: new Date().toISOString()
  };

  if (data.id) {
    const { error } = await adminClient
      .from('signatures')
      .update(payload)
      .eq('id', data.id)
      .eq('user_id', user.id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await adminClient
      .from('signatures')
      .insert(payload);
    if (error) return { success: false, error: error.message };
  }

  return { success: true };
}
