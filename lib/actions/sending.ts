'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeEmail } from '@/lib/prospect-normalization';
import { sendGmailMessageViaApi } from '@/lib/gmail';

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
  gmailMessageId?: string;
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
  // Nobody can send from another teammate's mailbox!
  let { data: account } = await adminClient
    .from('gmail_accounts')
    .select('id, owner_user_id, email, status, encrypted_refresh_token, daily_cap, warmup_started_at, warmup_override')
    .eq('id', params.accountId)
    .maybeSingle();

  if (!account) {
    // Fallback: look up by current user ID
    const { data: ownAcc } = await adminClient
      .from('gmail_accounts')
      .select('id, owner_user_id, email, status, encrypted_refresh_token, daily_cap, warmup_started_at, warmup_override')
      .eq('owner_user_id', currentMember.id)
      .maybeSingle();

    if (ownAcc) {
      account = ownAcc;
    }
  }

  if (!account) {
    return { 
      success: false, 
      error: 'No connected Gmail mailbox found. Please connect your Gmail in Settings before sending.' 
    };
  }

  if (account.owner_user_id !== currentMember.id) {
    return { 
      success: false, 
      error: `Forbidden: You cannot send emails from another teammate's mailbox (${account.email}). Only the mailbox owner can send.` 
    };
  }

  if (account.status === 'paused') {
    return { success: false, error: 'Your mailbox is currently paused. Please review Settings.' };
  }

  if (account.status === 'needs_reconnect' || !account.encrypted_refresh_token) {
    return { success: false, error: 'Your mailbox requires reconnection with Google OAuth. Go to Settings to reconnect.' };
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
    .maybeSingle();

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

  // 5. Idempotency Check (Double-click protection)
  if (params.idempotencyKey) {
    const { data: existingSend } = await adminClient
      .from('audit_log')
      .select('id, metadata')
      .eq('action', params.isReply ? 'email.sent_reply' : 'email.sent_outreach')
      .contains('metadata', { idempotencyKey: params.idempotencyKey })
      .maybeSingle();

    if (existingSend) {
      return { 
        success: true, 
        isQueued: false, 
        gmailMessageId: (existingSend.metadata as any)?.gmailMessageId 
      };
    }
  }

  // 6. Safe Sending Cap Enforcement (PKT Time)
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

  // 7. Resolve thread context for replies
  let existingThread: any = null;
  let inReplyToMessageId: string | null = null;
  let activeThreadId = params.threadId || null;

  if (isReply && activeThreadId) {
    const { data: th } = await adminClient
      .from('threads')
      .select('id, gmail_thread_id, subject')
      .eq('id', activeThreadId)
      .maybeSingle();

    existingThread = th;

    if (existingThread) {
      // Find latest message in thread for In-Reply-To and References
      const { data: lastMsg } = await adminClient
        .from('messages')
        .select('gmail_message_id, rfc822_message_id')
        .eq('thread_id', activeThreadId)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      inReplyToMessageId = lastMsg?.rfc822_message_id || lastMsg?.gmail_message_id || null;
    }
  }

  // 8. REAL GMAIL API SEND VIA users.messages.send
  let sendResult: { gmailMessageId: string; gmailThreadId: string };
  try {
    sendResult = await sendGmailMessageViaApi({
      accountId: account.id,
      fromEmail: account.email,
      fromName: currentMember.name,
      toEmail: cleanRecipientEmail,
      ccEmail: params.ccEmail || null,
      bccEmail: params.bccEmail || null,
      subject: params.subject,
      bodyText: params.body,
      gmailThreadId: existingThread?.gmail_thread_id || null,
      inReplyToMessageId: inReplyToMessageId,
      referencesMessageId: inReplyToMessageId,
    });
  } catch (err: any) {
    console.error('Gmail send error in sendOutreachOrReplyAction:', err?.message);
    return {
      success: false,
      error: err?.message || 'Failed to send message via Gmail API. Check your mailbox status.',
    };
  }

  // 9. ONLY AFTER GMAIL CONFIRMS: Update DB tables
  const nowIso = new Date().toISOString();
  let linkedContactId = existingContact?.id || null;

  // Create or update Contact
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

  // Create or update Thread
  if (!activeThreadId) {
    const { data: createdThread } = await adminClient
      .from('threads')
      .insert({
        account_id: account.id,
        gmail_thread_id: sendResult.gmailThreadId,
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
  } else {
    await adminClient
      .from('threads')
      .update({
        gmail_thread_id: sendResult.gmailThreadId,
        snippet: params.body.slice(0, 140),
        last_message_at: nowIso,
        unread: false,
        updated_at: nowIso,
      })
      .eq('id', activeThreadId);
  }

  // Insert Sent Message
  if (activeThreadId) {
    await adminClient.from('messages').insert({
      account_id: account.id,
      thread_id: activeThreadId,
      contact_id: linkedContactId,
      gmail_message_id: sendResult.gmailMessageId,
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

  // 10. Update matching Prospect status to 'contacted'
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

  // 11. Write Audit Log
  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: isReply ? 'email.sent_reply' : 'email.sent_outreach',
    metadata: {
      accountId: account.id,
      fromEmail: account.email,
      toEmail: cleanRecipientEmail,
      gmailMessageId: sendResult.gmailMessageId,
      gmailThreadId: sendResult.gmailThreadId,
      idempotencyKey: params.idempotencyKey,
    },
  });

  return {
    success: true,
    isQueued: false,
    gmailMessageId: sendResult.gmailMessageId,
  };
}
