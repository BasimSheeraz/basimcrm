'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeEmail } from '@/lib/prospect-normalization';
import { sendGmailMessageViaApi } from '@/lib/gmail';
import { 
  detectDomainTypo, 
  isRoleAddress, 
  findUnresolvedVariables, 
  calculateSpamRisk, 
  calculateTextSimilarity 
} from '@/lib/deliverability';

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
  const isReply = !!params.isReply;

  // 2b. Domain Typo & Role Address Protection
  const typoSuggestion = detectDomainTypo(cleanRecipientEmail);
  if (typoSuggestion) {
    return {
      success: false,
      error: `Recipient address domain looks like a typo ("${recipientDomain}"). Did you mean ${cleanRecipientEmail.split('@')[0]}@${typoSuggestion}?`,
    };
  }

  if (!isReply && isRoleAddress(cleanRecipientEmail) && !params.adminOverride) {
    return {
      success: false,
      error: `Role-based address (${cleanRecipientEmail}) detected. Cold outreach to role inboxes triggers spam filters. Admin override required.`,
    };
  }

  // 2c. Unresolved Template Variables (Hard Block)
  const unresolvedVars = [
    ...findUnresolvedVariables(params.subject),
    ...findUnresolvedVariables(params.body)
  ];
  if (unresolvedVars.length > 0) {
    return {
      success: false,
      error: `Cannot send: message contains unresolved template variables (${unresolvedVars.join(', ')}). Please personalize all fields.`,
    };
  }

  // 2d. Content Spam Risk Analysis (Block at High Risk)
  const spamRisk = calculateSpamRisk({
    subject: params.subject,
    body: params.body,
    hasAttachments: false,
    isFirstEmail: !isReply,
  });

  if (spamRisk.level === 'high' && !params.adminOverride) {
    return {
      success: false,
      error: `High spam risk (${spamRisk.score}/100): ${spamRisk.reasons.join('; ')}. Please adjust content before sending.`,
    };
  }

  // 2e. Pacing & Burst Prevention (Max 3 sends in 10 minutes per mailbox)
  const tenMinsAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recentSends } = await adminClient
    .from('audit_log')
    .select('id')
    .eq('action', 'email.sent_outreach')
    .gte('created_at', tenMinsAgoIso)
    .contains('metadata', { accountId: account.id });

  if (recentSends && recentSends.length >= 3 && !params.adminOverride) {
    return {
      success: false,
      error: 'Burst limit reached: maximum 3 outreach emails per 10 minutes from this mailbox. Please wait a few minutes to protect your Gmail reputation.',
    };
  }

  // 2f. Frequency Guard (Never email same person twice within 3 days unless replying)
  if (!isReply) {
    const threeDaysAgoIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentContactEmail } = await adminClient
      .from('messages')
      .select('id, sent_at')
      .eq('to_email', cleanRecipientEmail)
      .eq('direction', 'outbound')
      .gte('sent_at', threeDaysAgoIso)
      .limit(1)
      .maybeSingle();

    if (recentContactEmail && !params.adminOverride) {
      return {
        success: false,
        error: `Frequency protection: ${cleanRecipientEmail} was already emailed within the last 3 days. Space follow-ups by at least 72 hours.`,
      };
    }
  }

  // 2g. Template Body Similarity Check (>85% similar to team outreach in past 14 days)
  if (!isReply) {
    const fourteenDaysAgoIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: pastMessages } = await adminClient
      .from('messages')
      .select('body_text')
      .eq('direction', 'outbound')
      .gte('sent_at', fourteenDaysAgoIso)
      .limit(20);

    if (pastMessages && pastMessages.length > 0) {
      const isTooSimilar = pastMessages.some(m => {
        if (!m.body_text) return false;
        const sim = calculateTextSimilarity(params.body, m.body_text);
        return sim > 0.85;
      });

      if (isTooSimilar && !params.adminOverride) {
        return {
          success: false,
          error: 'Content similarity warning: This body is over 85% similar to an email sent recently. Free Gmail accounts require personalized outreach to avoid spam filters. Please customize.',
        };
      }
    }
  }

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
      // Maximum 3 follow-ups limit per contact thread
      const { count: outboundCount } = await adminClient
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', activeThreadId)
        .eq('direction', 'outbound');

      if (outboundCount && outboundCount >= 4 && !params.adminOverride) {
        return {
          success: false,
          error: 'Maximum 3 follow-ups limit reached for this thread. Stopping further automated outreach to avoid spam flags.',
        };
      }

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
    const { data: createdContact, error: contactErr } = await adminClient
      .from('contacts')
      .insert({
        name: (params.toName || cleanRecipientEmail.split('@')[0]).trim(),
        email: cleanRecipientEmail,
        company: (params.company || '').trim(),
        status: 'contacted',
        first_contacted_at: nowIso,
        last_contacted_at: nowIso,
        last_contacted_by_user_id: currentMember.id,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id')
      .single();

    if (contactErr) {
      console.error('Error inserting contact in sendOutreachOrReplyAction:', contactErr.message);
    }
    if (createdContact?.id) {
      linkedContactId = createdContact.id;
    }
  } else {
    await adminClient
      .from('contacts')
      .update({
        last_contacted_at: nowIso,
        last_contacted_by_user_id: currentMember.id,
        status: 'contacted',
        updated_at: nowIso,
      })
      .eq('id', linkedContactId);
  }

  // Create or update Thread
  if (!activeThreadId) {
    const { data: existingTh } = await adminClient
      .from('threads')
      .select('id')
      .eq('gmail_thread_id', sendResult.gmailThreadId)
      .maybeSingle();

    if (existingTh?.id) {
      activeThreadId = existingTh.id;
      await adminClient
        .from('threads')
        .update({
          snippet: params.body.slice(0, 140),
          last_message_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', activeThreadId);
    } else {
      const { data: createdThread, error: threadErr } = await adminClient
        .from('threads')
        .insert({
          gmail_thread_id: sendResult.gmailThreadId,
          subject: params.subject,
          snippet: params.body.slice(0, 140),
          status: 'open',
          assigned_to_user_id: currentMember.id,
          last_message_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('id')
        .single();

      if (threadErr) {
        console.error('Error inserting thread in sendOutreachOrReplyAction:', threadErr.message);
      }
      if (createdThread?.id) {
        activeThreadId = createdThread.id;
      }
    }
  } else {
    await adminClient
      .from('threads')
      .update({
        snippet: params.body.slice(0, 140),
        last_message_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', activeThreadId);
  }

  // Link thread to contact via thread_contacts (critical for search_crm & inbox)
  if (activeThreadId && linkedContactId) {
    const { error: tcErr } = await adminClient
      .from('thread_contacts')
      .upsert(
        { thread_id: activeThreadId, contact_id: linkedContactId },
        { onConflict: 'thread_id,contact_id' }
      );
    if (tcErr) {
      console.error('Error linking thread_contacts:', tcErr.message);
    }
  }

  // Mark thread as read for current user
  if (activeThreadId) {
    await adminClient
      .from('thread_user_state')
      .upsert(
        { thread_id: activeThreadId, user_id: currentMember.id, is_read: true, is_starred: false },
        { onConflict: 'thread_id,user_id' }
      );
  }

  // Insert Sent Message
  if (activeThreadId) {
    const { error: msgErr } = await adminClient.from('messages').insert({
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
      label_ids: ['SENT'],
      sent_at: nowIso,
      sent_by_user_id: currentMember.id,
    });

    if (msgErr) {
      console.error('Error inserting message in sendOutreachOrReplyAction:', msgErr.message);
    }
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
