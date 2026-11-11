'use server';

import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Contact, TimelineEvent, PipelineStatus } from '@/types';

const editContactSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  company: z.string().max(200).optional().default(''),
  status: z.enum(['Lead', 'Contacted', 'In Discussion', 'Meeting', 'Client', 'Cold']),
  tags: z.array(z.string()).default([]),
  phone: z.string().max(50).optional().default(''),
  linkedin: z.string().max(200).optional().default(''),
  dealSize: z.string().max(50).optional().default('')
});

export async function editContactAction(data: {
  id: string;
  name: string;
  company?: string;
  status: PipelineStatus;
  tags?: string[];
  phone?: string;
  linkedin?: string;
  dealSize?: string;
}) {
  const parsed = editContactSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from('contacts')
    .update({
      name: parsed.data.name,
      company: parsed.data.company || null,
      status: parsed.data.status,
      tags: parsed.data.tags,
      updated_at: new Date().toISOString()
    })
    .eq('id', parsed.data.id);

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user?.id,
    action: 'contacts.edit',
    target: parsed.data.id,
    metadata: parsed.data
  });

  return { success: true };
}

export async function mergeContactsAction(sourceContactId: string, targetContactId: string) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  const adminClient = createAdminClient();
  const { error } = await adminClient.rpc('merge_contacts', {
    p_source_id: sourceContactId,
    p_target_id: targetContactId
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function deleteContactAction(contactId: string) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from('contacts')
    .delete()
    .eq('id', contactId);

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user?.id,
    action: 'contacts.delete',
    target: contactId,
    metadata: {}
  });

  return { success: true };
}

export async function getContactTimelineAction(contactId: string): Promise<TimelineEvent[]> {
  const adminClient = createAdminClient();
  const events: TimelineEvent[] = [];

  // 1. Fetch messages
  const { data: messages } = await adminClient
    .from('messages')
    .select('id, direction, from_name, from_email, subject, body_text, sent_at')
    .eq('contact_id', contactId)
    .order('sent_at', { ascending: false });

  if (messages) {
    for (const m of messages) {
      events.push({
        id: `msg-${m.id}`,
        type: m.direction === 'outbound' ? 'email_outbound' : 'email_inbound',
        title: m.direction === 'outbound' ? `Email sent: ${m.subject}` : `Email received: ${m.subject}`,
        description: m.body_text?.slice(0, 140) + '...' || '',
        timestamp: m.sent_at
      });
    }
  }

  // 2. Fetch internal notes
  const { data: notes } = await adminClient
    .from('internal_notes')
    .select('id, note_content, created_at, user_id, team_members (name, avatar_color)')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });

  if (notes) {
    for (const n of notes) {
      events.push({
        id: `note-${n.id}`,
        type: 'note',
        title: 'Internal Note added',
        description: n.note_content,
        timestamp: n.created_at,
        userName: (n.team_members as any)?.name,
        userColor: (n.team_members as any)?.avatar_color
      });
    }
  }

  // 3. Fetch audit logs (stage changes, assignments, merges)
  const { data: logs } = await adminClient
    .from('audit_log')
    .select('*')
    .or(`target.eq.${contactId},metadata->>contact_id.eq.${contactId}`)
    .order('created_at', { ascending: false });

  if (logs) {
    for (const l of logs) {
      let type: TimelineEvent['type'] = 'stage_change';
      let title = l.action;
      let desc = '';

      if (l.action === 'contacts.merge') {
        type = 'stage_change';
        title = 'Contact Merged';
        desc = `Merged from ${l.metadata?.source_email || 'duplicate contact'}`;
      } else if (l.action === 'threads.status') {
        type = 'stage_change';
        title = `Status updated to ${l.metadata?.to || ''}`;
      } else if (l.action === 'threads.assign') {
        type = 'assignment';
        title = 'Thread Owner Reassigned';
      } else if (l.action === 'prospects.outreach_sent') {
        type = 'email_outbound';
        title = 'Outreach Sent from Prospects Queue';
        desc = `Sent by ${l.metadata?.sender_name || 'Teammate'} • Subject: ${l.metadata?.subject || ''}`;
      }

      events.push({
        id: `audit-${l.id}`,
        type,
        title,
        description: desc,
        timestamp: l.created_at
      });
    }
  }

  // Sort descending by timestamp
  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function getContactsAction(): Promise<Contact[]> {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from('contacts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data.map((c: any) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    company: c.company || '',
    status: c.status as PipelineStatus,
    tags: c.tags || [],
    notes: c.notes || '',
    phone: c.phone || '',
    linkedin: c.linkedin || '',
    dealSize: c.deal_size || '',
    firstContactedAt: c.first_contacted_at || c.created_at || new Date().toISOString(),
    lastContactedAt: c.last_contacted_at || c.created_at || new Date().toISOString(),
    lastContactedByUserId: c.last_contacted_by_user_id || c.owner_user_id || '',
    createdAt: c.created_at,
    ownerUserId: c.owner_user_id,
    bounceCount: c.bounce_count || 0,
    isBadEmail: c.is_bad_email || false,
    bounceReason: c.bounce_reason,
    reminderCount: c.reminder_count || 0
  }));
}

export async function updateContactStatusAction(contactId: string, status: PipelineStatus) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from('contacts')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', contactId);

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user?.id,
    action: 'threads.status',
    target: contactId,
    metadata: { to: status }
  });

  return { success: true };
}

export async function addContactNoteAction(contactId: string, content: string) {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from('internal_notes')
    .insert({
      contact_id: contactId,
      user_id: user.id,
      note_content: content.trim(),
      created_at: new Date().toISOString()
    });

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'notes.create',
    target: contactId,
    metadata: { length: content.length }
  });

  return { success: true };
}
