import { createAdminClient } from '@/lib/supabase/admin';
import { getGmailClient } from '@/lib/gmail';
import { isBounceMessage, isAutoReplyMessage, isOptOutMessage } from '@/lib/deliverability';
import { normalizeEmail } from '@/lib/prospect-normalization';
import { sanitizeEmailHtml } from '@/lib/sanitize';

function extractBodyFromPayload(payload: any): { text: string; html: string } {
  let text = '';
  let html = '';

  function walk(part: any) {
    if (!part) return;
    const mimeType = part.mimeType || '';
    if (part.body && part.body.data) {
      try {
        const base64Standard = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(base64Standard, 'base64').toString('utf8');
        if (mimeType === 'text/plain' && !text) {
          text = decoded;
        } else if (mimeType === 'text/html' && !html) {
          html = decoded;
        }
      } catch {
        // ignore decode failure
      }
    }
    if (part.parts && Array.isArray(part.parts)) {
      for (const sub of part.parts) {
        walk(sub);
      }
    }
  }

  walk(payload);

  if (!text && html) {
    text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return { text, html };
}

export interface SyncOptions {
  userId?: string;
  accountId?: string;
}

export interface SyncResult {
  success: boolean;
  totalNewMessages: number;
  accountsSynced: number;
  results: {
    account: string;
    status: string;
    newMessages?: number;
    error?: string;
  }[];
}

export async function runGmailSync(options: SyncOptions = {}): Promise<SyncResult> {
  const adminClient = createAdminClient();

  // 1. Fetch target mailboxes
  let query = adminClient
    .from('gmail_accounts')
    .select('id, owner_user_id, email, encrypted_refresh_token, status, history_id, sync_locked_until, last_sync_at')
    .neq('status', 'needs_reconnect')
    .not('encrypted_refresh_token', 'is', null);

  if (options.accountId) {
    query = query.eq('id', options.accountId);
  } else if (options.userId) {
    query = query.eq('owner_user_id', options.userId);
  }

  const { data: accounts, error: accError } = await query;

  if (accError || !accounts || accounts.length === 0) {
    return {
      success: true,
      totalNewMessages: 0,
      accountsSynced: 0,
      results: [],
    };
  }

  // 2. Fetch Global Sync Settings & Ignore Rules & DNC
  const { data: syncSettings } = await adminClient
    .from('gmail_sync_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  const backfillDays = syncSettings?.backfill_days || 60;
  const syncLabel = syncSettings?.sync_label;

  const { data: ignoreRules } = await adminClient
    .from('gmail_ignore_rules')
    .select('rule_type, value');

  const { data: dncList } = await adminClient
    .from('do_not_contact')
    .select('type, value');

  const ignoredEmails = new Set([
    ...(ignoreRules?.filter(r => r.rule_type === 'email').map(r => r.value.toLowerCase()) || []),
    ...(dncList?.filter(r => r.type === 'email').map(r => r.value.toLowerCase()) || []),
  ]);

  const ignoredDomains = new Set([
    ...(ignoreRules?.filter(r => r.rule_type === 'domain').map(r => r.value.toLowerCase()) || []),
    ...(dncList?.filter(r => r.type === 'domain').map(r => r.value.toLowerCase()) || []),
  ]);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - backfillDays);
  const afterDateStr = cutoffDate.toISOString().split('T')[0].replace(/-/g, '/');

  let baseQuery = `after:${afterDateStr} -in:spam -in:trash -in:drafts -category:promotions -category:social`;
  if (syncLabel) {
    baseQuery += ` label:${syncLabel}`;
  } else {
    baseQuery += ` (in:inbox OR in:sent)`;
  }

  const results: any[] = [];
  let totalNewMessages = 0;

  for (const account of accounts) {
    // Check lock (5-minute timeout)
    if (account.sync_locked_until && new Date(account.sync_locked_until).getTime() > Date.now()) {
      results.push({ account: account.email, status: 'skipped_locked' });
      continue;
    }

    const lockUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await adminClient
      .from('gmail_accounts')
      .update({ sync_locked_until: lockUntil })
      .eq('id', account.id);

    try {
      // Get authorized Gmail client with auto-refreshed token
      const gmail = await getGmailClient(account.id);
      const accessToken = gmail.accessToken;

      let messageIdsToFetch: { id: string; threadId?: string }[] = [];
      let latestHistoryId = account.history_id;

      // Try incremental history sync if history_id exists
      let usedHistory = false;
      if (account.history_id) {
        try {
          const histRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${account.history_id}&historyTypes=messageAdded&maxResults=100`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );

          if (histRes.ok) {
            const histData = await histRes.json();
            usedHistory = true;
            if (histData.historyId) {
              latestHistoryId = histData.historyId;
            }
            if (histData.history && Array.isArray(histData.history)) {
              for (const record of histData.history) {
                if (record.messagesAdded) {
                  for (const mAdded of record.messagesAdded) {
                    if (mAdded.message?.id) {
                      messageIdsToFetch.push({ id: mAdded.message.id, threadId: mAdded.message.threadId });
                    }
                  }
                }
              }
            }
          } else if (histRes.status === 404) {
            // History ID expired (older than ~30 days in Gmail) -> fall back to message list
            console.log(`History ID expired for ${account.email}, falling back to list`);
          }
        } catch (hErr) {
          console.warn('History API fetch error, falling back:', hErr);
        }
      }

      // If history was not used or returned no messages on first sync
      if (!usedHistory) {
        const listRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(baseQuery)}&maxResults=50`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (listRes.ok) {
          const listData = await listRes.json();
          latestHistoryId = listData.historyId || latestHistoryId;
          messageIdsToFetch = (listData.messages || []).map((m: any) => ({ id: m.id, threadId: m.threadId }));
        }
      }

      // Deduplicate message IDs
      const uniqueMsgMap = new Map<string, string | undefined>();
      for (const m of messageIdsToFetch) {
        if (!uniqueMsgMap.has(m.id)) {
          uniqueMsgMap.set(m.id, m.threadId);
        }
      }

      let insertedCount = 0;

      for (const [msgId, fallbackThreadId] of Array.from(uniqueMsgMap.entries())) {
        // Idempotency check: see if message already exists in DB
        const { data: existingMsg } = await adminClient
          .from('messages')
          .select('id')
          .eq('gmail_message_id', msgId)
          .maybeSingle();

        if (existingMsg) {
          continue; // Already synced!
        }

        // Fetch full message details from Gmail
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!msgRes.ok) continue;
        const msgFull = await msgRes.json();

        const headers = (msgFull.payload?.headers || []).reduce((acc: any, h: any) => {
          acc[h.name.toLowerCase()] = h.value;
          return acc;
        }, {});

        const fromHeader = headers['from'] || '';
        const toHeader = headers['to'] || '';
        const ccHeader = headers['cc'] || null;
        const subjectHeader = headers['subject'] || '(No Subject)';
        const dateHeader = headers['date'] || new Date().toISOString();
        const rfc822Id = headers['message-id'] || null;
        const referencesHeader = headers['references'] || null;

        const fromEmail = (fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader.split(' ')[0] || '').trim().toLowerCase();
        const fromName = fromHeader.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || fromEmail.split('@')[0];
        const fromDomain = fromEmail.split('@')[1] || '';

        // Ignore check
        if (ignoredEmails.has(fromEmail) || ignoredDomains.has(fromDomain)) {
          continue;
        }

        const isOutbound = fromEmail === account.email.toLowerCase();
        const direction = isOutbound ? 'outbound' : 'inbound';

        // Extract body
        const { text: bodyText, html: rawHtml } = extractBodyFromPayload(msgFull.payload);
        const sanitizedHtml = sanitizeEmailHtml(rawHtml);
        const snippet = msgFull.snippet || bodyText.slice(0, 140);
        const sentAt = new Date(parseInt(msgFull.internalDate, 10) || Date.parse(dateHeader) || Date.now()).toISOString();

        // Bounce / Auto-reply / Opt-out detection
        const isBounce = isBounceMessage(fromEmail, subjectHeader);
        const isAutoReply = isAutoReplyMessage(headers, subjectHeader);
        const isOptOut = isOptOutMessage(snippet);

        if (isBounce) {
          await adminClient.rpc('record_account_bounce', {
            p_account_id: account.id,
            p_contact_email: fromEmail
          });
        }

        if (isOptOut) {
          await adminClient.from('do_not_contact').upsert({
            type: 'email',
            value: fromEmail,
            reason: 'Auto-detected opt-out phrase in reply',
            source: 'auto_opt_out',
            created_at: new Date().toISOString(),
          }, { onConflict: 'value' });
        }

        // Contact Resolution
        const externalEmail = isOutbound 
          ? (toHeader.match(/<([^>]+)>/)?.[1] || toHeader.split(',')[0].trim().toLowerCase()) 
          : fromEmail;
        const externalName = isOutbound ? externalEmail.split('@')[0] : fromName;

        let contactId: string | null = null;
        if (externalEmail && externalEmail.includes('@')) {
          const { data: existingContact } = await adminClient
            .from('contacts')
            .select('id, owner_user_id')
            .eq('email', externalEmail)
            .maybeSingle();

          if (existingContact) {
            contactId = existingContact.id;
            await adminClient
              .from('contacts')
              .update({
                last_contacted_at: sentAt,
                last_contacted_by_user_id: account.owner_user_id,
                updated_at: new Date().toISOString(),
              })
              .eq('id', contactId);
          } else {
            const { data: newContact } = await adminClient
              .from('contacts')
              .insert({
                name: externalName,
                email: externalEmail,
                owner_user_id: account.owner_user_id,
                status: isOutbound ? 'Contacted' : 'Lead',
                first_contacted_at: sentAt,
                last_contacted_at: sentAt,
                last_contacted_by_user_id: account.owner_user_id,
                created_at: sentAt,
                updated_at: sentAt,
              })
              .select('id')
              .single();
            if (newContact) contactId = newContact.id;
          }
        }

        // Thread Resolution (upsert on account_id, gmail_thread_id)
        const gmailThreadId = msgFull.threadId || fallbackThreadId || msgId;
        let threadId: string;

        const { data: existingThread } = await adminClient
          .from('threads')
          .select('id, snippet, last_message_at')
          .eq('account_id', account.id)
          .eq('gmail_thread_id', gmailThreadId)
          .maybeSingle();

        if (existingThread) {
          threadId = existingThread.id;
          await adminClient
            .from('threads')
            .update({
              snippet,
              last_message_at: sentAt,
              unread: !isOutbound,
              contact_id: contactId || undefined,
              updated_at: new Date().toISOString(),
            })
            .eq('id', threadId);
        } else {
          const { data: newThread } = await adminClient
            .from('threads')
            .insert({
              account_id: account.id,
              gmail_thread_id: gmailThreadId,
              subject: subjectHeader,
              snippet,
              contact_id: contactId,
              contact_email: externalEmail || '',
              contact_name: externalName,
              assigned_to_user_id: account.owner_user_id,
              status: 'open',
              unread: !isOutbound,
              last_message_at: sentAt,
              created_at: sentAt,
              updated_at: sentAt,
            })
            .select('id')
            .single();

          if (!newThread) continue;
          threadId = newThread.id;
        }

        // Insert Message Record
        await adminClient.from('messages').insert({
          account_id: account.id,
          thread_id: threadId,
          contact_id: contactId,
          gmail_message_id: msgId,
          rfc822_message_id: rfc822Id,
          references_header: referencesHeader,
          direction,
          from_email: fromEmail,
          from_name: fromName,
          to_email: toHeader,
          cc_email: ccHeader,
          subject: subjectHeader,
          body_text: bodyText,
          body_html: sanitizedHtml,
          sent_at: sentAt,
          sent_by_user_id: isOutbound ? account.owner_user_id : null,
          is_bounce: isBounce,
          is_auto_reply: isAutoReply,
        });

        insertedCount++;

        // Inbound Reply Matching on Prospects
        if (!isOutbound && !isAutoReply) {
          const normFrom = normalizeEmail(fromEmail);
          if (normFrom) {
            await adminClient
              .from('prospects')
              .update({
                status: 'replied',
                contact_id: contactId || undefined,
                updated_at: new Date().toISOString(),
              })
              .eq('email_normalized', normFrom)
              .in('status', ['new', 'assigned', 'contacted']);
          }
        }
      }

      // Update account sync state
      await adminClient
        .from('gmail_accounts')
        .update({
          history_id: latestHistoryId || account.history_id,
          last_sync_at: new Date().toISOString(),
          sync_locked_until: null,
          status: 'active',
          pause_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', account.id);

      totalNewMessages += insertedCount;
      results.push({ account: account.email, status: 'synced', newMessages: insertedCount });
    } catch (err: any) {
      console.error(`Sync error for ${account.email}:`, err?.message);
      await adminClient
        .from('gmail_accounts')
        .update({ sync_locked_until: null })
        .eq('id', account.id);

      results.push({ account: account.email, status: 'error', error: err?.message });
    }
  }

  return {
    success: true,
    totalNewMessages,
    accountsSynced: results.length,
    results,
  };
}
