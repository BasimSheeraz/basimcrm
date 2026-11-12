const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env.local
const envPath = path.resolve(__dirname, '../.env.local');
const envFile = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
    const idx = trimmed.indexOf('=');
    const k = trimmed.slice(0, idx).trim();
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function repair() {
  console.log('--- Basim CRM Outreach & Contact Repair Script ---');
  let repairedProspects = 0;
  let repairedContacts = 0;
  let repairedThreads = 0;
  let repairedMessages = 0;
  let repairedThreadContacts = 0;

  // 1. Fetch all prospects
  const { data: prospects, error: pErr } = await supabase
    .from('prospects')
    .select('*');

  if (pErr) throw new Error('Error fetching prospects: ' + pErr.message);

  for (const p of prospects || []) {
    const normEmail = (p.email_normalized || p.email || '').toLowerCase().trim();
    if (!normEmail) continue;

    // Check if matching contact exists
    let { data: contact } = await supabase
      .from('contacts')
      .select('id, email, status')
      .eq('email', normEmail)
      .maybeSingle();

    if (!contact && p.status === 'contacted') {
      const nowIso = p.contacted_at || new Date().toISOString();
      const { data: created, error: cErr } = await supabase
        .from('contacts')
        .insert({
          name: p.full_name || normEmail.split('@')[0],
          email: normEmail,
          company: p.company || '',
          status: 'contacted',
          first_contacted_at: nowIso,
          last_contacted_at: nowIso,
          last_contacted_by_user_id: p.assigned_to || null,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('id, email')
        .single();

      if (cErr) {
        console.error(`Error creating contact for ${normEmail}:`, cErr.message);
      } else if (created) {
        contact = created;
        repairedContacts++;
      }
    }

    // Link prospect.contact_id if missing
    if (contact && p.contact_id !== contact.id) {
      const { error: upErr } = await supabase
        .from('prospects')
        .update({ contact_id: contact.id })
        .eq('id', p.id);

      if (!upErr) repairedProspects++;
    }
  }

  // 2. Fetch all outreach audit logs to repair any missing threads/messages
  const { data: sentLogs, error: lErr } = await supabase
    .from('audit_log')
    .select('*')
    .eq('action', 'email.sent_outreach');

  if (lErr) throw new Error('Error fetching audit logs: ' + lErr.message);

  for (const log of sentLogs || []) {
    const meta = log.metadata || {};
    const toEmail = (meta.toEmail || '').toLowerCase().trim();
    const fromEmail = (meta.fromEmail || '').toLowerCase().trim();
    const gmailThreadId = meta.gmailThreadId;
    const gmailMessageId = meta.gmailMessageId;
    const sentAt = log.created_at;

    if (!toEmail || !gmailThreadId || !gmailMessageId) continue;

    // Find contact
    let { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('email', toEmail)
      .maybeSingle();

    if (!contact) {
      const { data: created } = await supabase
        .from('contacts')
        .insert({
          name: toEmail.split('@')[0],
          email: toEmail,
          status: 'contacted',
          first_contacted_at: sentAt,
          last_contacted_at: sentAt,
          last_contacted_by_user_id: log.user_id,
          created_at: sentAt,
          updated_at: sentAt,
        })
        .select('id')
        .single();

      if (created) {
        contact = created;
        repairedContacts++;
      }
    }

    // Find or create thread
    let threadId = null;
    const { data: existingThread } = await supabase
      .from('threads')
      .select('id')
      .eq('gmail_thread_id', gmailThreadId)
      .maybeSingle();

    if (existingThread) {
      threadId = existingThread.id;
    } else {
      const { data: createdThread, error: tErr } = await supabase
        .from('threads')
        .insert({
          gmail_thread_id: gmailThreadId,
          subject: 'Quick question for you',
          snippet: 'Testing outbound message from Basim CRM',
          status: 'open',
          assigned_to_user_id: log.user_id,
          last_message_at: sentAt,
          created_at: sentAt,
          updated_at: sentAt,
        })
        .select('id')
        .single();

      if (createdThread) {
        threadId = createdThread.id;
        repairedThreads++;
      }
    }

    // Link thread_contacts
    if (threadId && contact) {
      const { data: existingTc } = await supabase
        .from('thread_contacts')
        .select('thread_id')
        .eq('thread_id', threadId)
        .eq('contact_id', contact.id)
        .maybeSingle();

      if (!existingTc) {
        const { error: tcErr } = await supabase
          .from('thread_contacts')
          .insert({ thread_id: threadId, contact_id: contact.id });
        if (!tcErr) repairedThreadContacts++;
      }
    }

    // Ensure thread_user_state exists
    if (threadId && log.user_id) {
      await supabase
        .from('thread_user_state')
        .upsert(
          { thread_id: threadId, user_id: log.user_id, is_read: true, is_starred: false },
          { onConflict: 'thread_id,user_id' }
        );
    }

    // Ensure message exists
    if (threadId) {
      const { data: existingMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('gmail_message_id', gmailMessageId)
        .maybeSingle();

      if (!existingMsg) {
        const { error: mErr } = await supabase
          .from('messages')
          .insert({
            thread_id: threadId,
            contact_id: contact?.id || null,
            gmail_message_id: gmailMessageId,
            direction: 'outbound',
            from_email: fromEmail,
            from_name: 'Basim Team',
            to_email: toEmail,
            subject: 'Quick question for you',
            body_text: 'Outreach test email from Basim CRM',
            label_ids: ['SENT'],
            sent_at: sentAt,
            sent_by_user_id: log.user_id,
            created_at: sentAt,
          });

        if (!mErr) repairedMessages++;
      }
    }
  }

  console.log('Repair Complete!');
  console.log({
    repairedProspects,
    repairedContacts,
    repairedThreads,
    repairedMessages,
    repairedThreadContacts,
  });
}

repair().catch(console.error);
