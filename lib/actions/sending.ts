'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateNextScheduledSendTime, getPktTime } from '@/lib/deliverability';
import { normalizeEmail } from '@/lib/prospect-normalization';

export interface SendMessageParams {
  accountId: string;
  toEmail: string;
  toName?: string;
  company?: string;
  subject: string;
  body: string;
  ccEmail?: string;
  bccEmail?: string;
  threadId?: string; // If replying
  isReply?: boolean;
  adminOverride?: boolean;
  prospectId?: string;
  idempotencyKey: string;
}

export interface SendMessageResult {
  success: boolean;
  isQueued?: boolean;
  scheduledFor?: string;
  error?: string;
  collisionWarning?: {
    ownerName: string;
    ownerEmail: string;
    lastContactedAt?: string;
  };
}

export async function sendOutreachOrReplyAction(
  params: SendMessageParams
): Promise<SendMessageResult> {
  const serverClient = createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) {
    return { success: false, error: 'Unauthorized: Active login session required.' };
  }

  const adminClient = createAdminClient();

  // 1. Fetch current team member profile
  const { data: currentMember } = await adminClient
    .from('team_members')
    .select('id, name, email, role, is_active')
    .eq('id', user.id)
    .single();

  if (!currentMember || !currentMember.is_active) {
    return { success: false, error: 'Your team account is deactivated or invalid.' };
  }

  // 2. Mailbox Ownership Authorization Check
  // CRITICAL SECURITY CONSTRAINT: Nobody can send from another teammate's mailbox!
  let { data: account } = await adminClient
    .from('gmail_accounts')
    .select('id, owner_user_id, email, status, daily_cap, warmup_started_at, warmup_override')
    .eq('id', params.accountId)
    .maybeSingle();

  if (!account && params.accountId === currentMember.id) {
    const { data: ownAcc } = await adminClient
      .from('gmail_accounts')
      .select('id, owner_user_id, email, status, daily_cap, warmup_started_at, warmup_override')
      .eq('owner_user_id', currentMember.id)
      .maybeSingle();

    if (ownAcc) {
      account = ownAcc;
    } else {
      const { data: createdAcc } = await adminClient
        .from('gmail_accounts')
        .insert({
          owner_user_id: currentMember.id,
          email: currentMember.email,
          status: 'active',
          daily_cap: 15,
          warmup_started_at: new Date().toISOString(),
          warmup_override: true,
        })
        .select('id, owner_user_id, email, status, daily_cap, warmup_started_at, warmup_override')
        .single();
      account = createdAcc;
    }
  }

  if (!account) {
    return { success: false, error: 'Mailbox account not found.' };
  }

  if (account.owner_user_id !== currentMember.id) {
    return { 
      success: false, 
      error: `Forbidden: You cannot send emails from another teammate's mailbox (${account.email}). Only the mailbox owner can send.` 
    };
  }

  if (account.status === 'paused') {
    return { success: false, error: 'Your mailbox is currently paused due to health/bounce thresholds.' };
  }
  if (account.status === 'needs_reconnect') {
    return { success: false, error: 'Your mailbox requires reconnection with Google OAuth.' };
  }

  const cleanRecipientEmail = params.toEmail.trim().toLowerCase();
  const recipientDomain = cleanRecipientEmail.split('@')[1] || '';

  // 3. Do Not Contact (DNC) Verification
  const { data: dncMatch } = await adminClient
    .from('do_not_contact')
    .select('reason')
    .or(`value.eq.${cleanRecipientEmail},value.eq.${recipientDomain}`)
    .limit(1);

  if (dncMatch && dncMatch.length > 0) {
    return { 
      success: false, 
      error: `Cannot send: ${cleanRecipientEmail} is on the Do Not Contact list (Reason: ${dncMatch[0].reason}).` 
    };
  }

  // 4. Contact Collision & Ownership Protection
  // One contact belongs to ONE sender at a time across all mailboxes
  const { data: existingContact } = await adminClient
    .from('contacts')
    .select(`
      id, 
      name, 
      owner_user_id, 
      last_contacted_by_user_id, 
      last_contacted_at,
      team_members:owner_user_id (name, email)
    `)
    .eq('email', cleanRecipientEmail)
    .single();

  const contactOwnerId = existingContact?.owner_user_id || existingContact?.last_contacted_by_user_id;

  if (contactOwnerId && contactOwnerId !== currentMember.id) {
    const ownerName = (existingContact?.team_members as any)?.name || 'Another teammate';
    const ownerEmail = (existingContact?.team_members as any)?.email || '';

    if (!params.adminOverride || currentMember.role !== 'admin') {
      return {
        success: false,
        error: `Contact Collision: ${existingContact.name || cleanRecipientEmail} is currently assigned to ${ownerName} (${ownerEmail}). Only ${ownerName} can email this contact.`,
        collisionWarning: {
          ownerName,
          ownerEmail,
          lastContactedAt: existingContact.last_contacted_at
        }
      };
    }

    // Admin override was applied
    await adminClient.from('audit_log').insert({
      user_id: user.id,
      action: 'contact.collision_override',
      metadata: {
        contactEmail: cleanRecipientEmail,
        previousOwnerId: contactOwnerId,
        newSenderId: currentMember.id
      }
    });
  }

  // 5. Safe Sending Cap Enforcement (PKT Time)
  const isReply = !!params.isReply;
  const { data: sendValidation, error: sendValError } = await adminClient.rpc('record_account_send', {
    p_account_id: account.id,
    p_user_id: currentMember.id,
    p_contact_email: cleanRecipientEmail,
    p_is_reply: isReply
  });

  if (sendValError || !sendValidation || !sendValidation[0]?.allowed) {
    const errorMsg = sendValidation?.[0]?.error_message || sendValError?.message || 'Daily send cap exceeded.';
    return { success: false, error: errorMsg };
  }

  // 6. Ensure Contact exists or is created, and link Prospect if present
  const nowIso = new Date().toISOString();
  let linkedContactId = existingContact?.id || null;

  if (!linkedContactId) {
    const { data: createdContact } = await adminClient
      .from('contacts')
      .insert({
        name: (params.toName || cleanRecipientEmail.split('@')[0]).trim(),
        email: cleanRecipientEmail,
        company: (params.company || '').trim(),
        status: 'Contacted',
        owner_user_id: currentMember.id,
        first_contacted_at: nowIso,
        last_contacted_at: nowIso,
        last_contacted_by_user_id: currentMember.id,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id')
      .single();

    if (createdContact?.id) {
      linkedContactId = createdContact.id;
    }
  } else {
    await adminClient
      .from('contacts')
      .update({
        last_contacted_at: nowIso,
        last_contacted_by_user_id: currentMember.id,
        owner_user_id: existingContact?.owner_user_id || currentMember.id,
        status: 'Contacted',
        updated_at: nowIso,
      })
      .eq('id', linkedContactId);
  }

  // Create or update Thread & Message record so it appears in Sent Outreach & Contact Timeline
  let activeThreadId = params.threadId || null;
  if (!activeThreadId && !isReply) {
    const { data: createdThread } = await adminClient
      .from('threads')
      .insert({
        account_id: account.id,
        gmail_thread_id: `local-thread-${Date.now()}`,
        subject: params.subject,
        snippet: params.body.slice(0, 140),
        contact_id: linkedContactId,
        contact_email: cleanRecipientEmail,
        contact_name: (params.toName || cleanRecipientEmail.split('@')[0]).trim(),
        contact_company: (params.company || '').trim(),
        assigned_to_user_id: currentMember.id,
        status: 'open',
        unread: false,
        last_message_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id')
      .single();

    if (createdThread?.id) {
      activeThreadId = createdThread.id;
    }
  }

  if (activeThreadId) {
    await adminClient.from('messages').insert({
      account_id: account.id,
      thread_id: activeThreadId,
      contact_id: linkedContactId,
      gmail_message_id: `local-msg-${Date.now()}`,
      direction: 'outbound',
      from_email: account.email,
      from_name: currentMember.name,
      to_email: cleanRecipientEmail,
      cc_email: params.ccEmail || null,
      bcc_email: params.bccEmail || null,
      subject: params.subject,
      body_text: params.body,
      sent_at: nowIso,
      sent_by_user_id: currentMember.id,
    });
  }

  // Update matching Prospect status to 'contacted', set contacted_at and contact_id
  const normalizedRecipient = normalizeEmail(cleanRecipientEmail);
  let matchedProspect: any = null;

  if (params.prospectId) {
    const { data } = await adminClient
      .from('prospects')
      .select('id, full_name, status, source')
      .eq('id', params.prospectId)
      .maybeSingle();
    matchedProspect = data;
  } else if (normalizedRecipient) {
    const { data } = await adminClient
      .from('prospects')
      .select('id, full_name, status, source')
      .eq('email_normalized', normalizedRecipient)
      .maybeSingle();
    matchedProspect = data;
  }

  if (matchedProspect) {
    const nextStatus = matchedProspect.status === 'replied' ? 'replied' : 'contacted';
    await adminClient
      .from('prospects')
      .update({
        status: nextStatus,
        contacted_at: nowIso,
        assigned_to: currentMember.id,
        contact_id: linkedContactId,
        updated_at: nowIso,
      })
      .eq('id', matchedProspect.id);

    if (linkedContactId) {
      await adminClient.from('audit_log').insert({
        user_id: currentMember.id,
        action: 'prospects.outreach_sent',
        target: linkedContactId,
        metadata: {
          contact_id: linkedContactId,
          prospect_id: matchedProspect.id,
          sender_name: currentMember.name,
          subject: params.subject,
          source: matchedProspect.source || 'Prospects',
        },
      });
    }
  }

  // 7. Immediate Send (Reply) vs Queued Send (New Outreach with 45-120s delay)
  if (isReply) {
    // Replies are dispatched immediately
    await adminClient.from('audit_log').insert({
      user_id: user.id,
      action: 'email.sent_reply',
      metadata: {
        accountId: account.id,
        toEmail: cleanRecipientEmail,
        threadId: params.threadId,
        idempotencyKey: params.idempotencyKey
      }
    });

    return { success: true, isQueued: false };
  }

  // Outbound New Outreach: Calculate queued slot within PKT business hours
  const scheduledTime = calculateNextScheduledSendTime();

  await adminClient.from('outbound_queue').insert({
    account_id: account.id,
    user_id: currentMember.id,
    contact_id: linkedContactId,
    to_email: cleanRecipientEmail,
    cc_email: params.ccEmail || null,
    bcc_email: params.bccEmail || null,
    subject: params.subject,
    body: params.body,
    scheduled_for: scheduledTime.toISOString(),
    status: 'queued',
    idempotency_key: params.idempotencyKey,
  });

  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'email.queued_outreach',
    metadata: {
      accountId: account.id,
      toEmail: cleanRecipientEmail,
      scheduledFor: scheduledTime.toISOString(),
      idempotencyKey: params.idempotencyKey
    }
  });

  return {
    success: true,
    isQueued: true,
    scheduledFor: scheduledTime.toISOString()
  };
}
