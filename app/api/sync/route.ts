import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { decryptToken } from '@/lib/crypto';
import { isBounceMessage, isAutoReplyMessage, isOptOutMessage } from '@/lib/deliverability';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleMultiMailboxSync(req);
}

export async function POST(req: NextRequest) {
  return handleMultiMailboxSync(req);
}

async function handleMultiMailboxSync(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuthed = cronSecret && authHeader === `Bearer ${cronSecret}`;

  // If not cron authed, check user session
  if (!isCronAuthed) {
    const serverClient = createServerClient();
    const { data: { user }, error } = await serverClient.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized: valid CRON_SECRET or user session required' }, { status: 401 });
    }
  }

  const adminClient = createAdminClient();

  // 1. Fetch all active and paused accounts
  const { data: accounts, error: accError } = await adminClient
    .from('gmail_accounts')
    .select('id, owner_user_id, email, encrypted_refresh_token, status, history_id, sync_locked_until, last_sync_at')
    .neq('status', 'needs_reconnect');

  if (accError || !accounts || accounts.length === 0) {
    return NextResponse.json({ message: 'No active accounts to sync' }, { status: 200 });
  }

  // 2. Fetch Global Sync Settings & Ignore Rules & DNC
  const { data: syncSettings } = await adminClient
    .from('gmail_sync_settings')
    .select('*')
    .eq('id', 1)
    .single();

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
    ...(dncList?.filter(r => r.type === 'email').map(r => r.value.toLowerCase()) || [])
  ]);

  const ignoredDomains = new Set([
    ...(ignoreRules?.filter(r => r.rule_type === 'domain').map(r => r.value.toLowerCase()) || []),
    ...(dncList?.filter(r => r.type === 'domain').map(r => r.value.toLowerCase()) || [])
  ]);

  // Construct 60-day Gmail query
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

  // 3. Loop through each account independently (one failing account never blocks others)
  for (const account of accounts) {
    // Check if account is currently sync-locked
    if (account.sync_locked_until && new Date(account.sync_locked_until).getTime() > Date.now()) {
      results.push({ account: account.email, status: 'skipped_locked' });
      continue;
    }

    // Acquire lock for this account (5 min timeout)
    const lockUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await adminClient
      .from('gmail_accounts')
      .update({ sync_locked_until: lockUntil })
      .eq('id', account.id);

    try {
      // If no token exists (e.g. mock / test mode)
      if (!account.encrypted_refresh_token) {
        // Mock sync completion
        await adminClient
          .from('gmail_accounts')
          .update({ 
            last_sync_at: new Date().toISOString(),
            sync_locked_until: null 
          })
          .eq('id', account.id);

        results.push({ account: account.email, status: 'synced_mock' });
        continue;
      }

      // Decrypt refresh token
      let refreshToken: string;
      try {
        refreshToken = decryptToken(account.encrypted_refresh_token);
      } catch (err: any) {
        // Bad token encryption or secret changed
        await adminClient
          .from('gmail_accounts')
          .update({ 
            status: 'needs_reconnect',
            pause_reason: 'Token decryption failed. Reconnection required.',
            sync_locked_until: null 
          })
          .eq('id', account.id);

        results.push({ account: account.email, status: 'needs_reconnect', error: 'Decryption failed' });
        continue;
      }

      // Check account with Google OAuth
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        // Environment credentials missing; mock success
        await adminClient
          .from('gmail_accounts')
          .update({ 
            last_sync_at: new Date().toISOString(),
            sync_locked_until: null 
          })
          .eq('id', account.id);

        results.push({ account: account.email, status: 'synced_no_oauth_env' });
        continue;
      }

      // Exchange refresh token for access token
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        })
      });

      const tokenData = await tokenRes.json();

      if (tokenData.error === 'invalid_grant') {
        // Token revoked or expired; mark needs_reconnect
        await adminClient
          .from('gmail_accounts')
          .update({ 
            status: 'needs_reconnect',
            pause_reason: 'Google authorization revoked. Reconnect required.',
            sync_locked_until: null 
          })
          .eq('id', account.id);

        await adminClient.from('audit_log').insert({
          action: 'mailbox.invalid_grant',
          metadata: { accountId: account.id, email: account.email }
        });

        results.push({ account: account.email, status: 'needs_reconnect' });
        continue;
      }

      if (!tokenRes.ok || !tokenData.access_token) {
        // Temporary failure; release lock and proceed
        await adminClient
          .from('gmail_accounts')
          .update({ sync_locked_until: null })
          .eq('id', account.id);

        results.push({ account: account.email, status: 'token_error', error: tokenData.error });
        continue;
      }

      const accessToken = tokenData.access_token;

      // Fetch messages from Gmail
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(baseQuery)}&maxResults=50`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (listRes.status === 429) {
        // Rate limit reached: auto-pause outreach
        await adminClient
          .from('gmail_accounts')
          .update({
            status: 'paused',
            pause_reason: 'Gmail API rate limit exceeded (429). Outreach paused.',
            sync_locked_until: null
          })
          .eq('id', account.id);

        results.push({ account: account.email, status: 'paused_rate_limit' });
        continue;
      }

      const listData = await listRes.json();
      const messagesToProcess = listData.messages || [];

      // Process up to 50 messages per batch
      for (const msgRef of messagesToProcess) {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgRef.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!msgRes.ok) continue;
        const msgFull = await msgRes.json();

        const headers = (msgFull.payload?.headers || []).reduce((acc: any, h: any) => {
          acc[h.name.toLowerCase()] = h.value;
          return acc;
        }, {});

        const fromHeader = headers['from'] || '';
        const subjectHeader = headers['subject'] || '';
        const fromEmail = fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader.split(' ')[0] || '';
        const cleanFromEmail = fromEmail.trim().toLowerCase();
        const fromDomain = cleanFromEmail.split('@')[1] || '';

        // Ignore check
        if (ignoredEmails.has(cleanFromEmail) || ignoredDomains.has(fromDomain)) {
          continue;
        }

        // 1. Bounce detection
        if (isBounceMessage(cleanFromEmail, subjectHeader)) {
          await adminClient.rpc('record_account_bounce', {
            p_account_id: account.id,
            p_contact_email: cleanFromEmail
          });
          continue;
        }

        // 2. Auto-reply detection
        const isAutoReply = isAutoReplyMessage(headers, subjectHeader);

        // 3. Opt-out detection
        let snippet = msgFull.snippet || '';
        if (isOptOutMessage(snippet)) {
          await adminClient.from('do_not_contact').upsert({
            type: 'email',
            value: cleanFromEmail,
            reason: 'Auto-detected opt-out phrase in reply',
            source: 'auto_opt_out',
            created_at: new Date().toISOString()
          }, { onConflict: 'value' });
        }
      }

      // Update account sync timestamp & clear lock
      await adminClient
        .from('gmail_accounts')
        .update({ 
          last_sync_at: new Date().toISOString(),
          history_id: listData.historyId || account.history_id,
          sync_locked_until: null 
        })
        .eq('id', account.id);

      results.push({ account: account.email, status: 'synced_success', processed: messagesToProcess.length });
    } catch (err: any) {
      // Clear lock on unexpected exception
      await adminClient
        .from('gmail_accounts')
        .update({ sync_locked_until: null })
        .eq('id', account.id);

      results.push({ account: account.email, status: 'error', error: err.message });
    }
  }

  // 4. Check DB usage (<80% of 500 MB)
  const { data: storageData } = await adminClient.rpc('get_database_storage_stats');
  if (storageData && storageData[0]?.is_warning) {
    await adminClient
      .from('gmail_sync_settings')
      .update({ db_size_warned_at: new Date().toISOString() })
      .eq('id', 1);

    await adminClient.from('audit_log').insert({
      action: 'system.db_size_warning',
      metadata: {
        usage_percent: storageData[0].usage_percent,
        total_bytes: storageData[0].total_bytes
      }
    });
  }

  return NextResponse.json({
    success: true,
    accountsProcessed: results.length,
    results,
    timestamp: new Date().toISOString()
  });
}
