import { createAdminClient } from '@/lib/supabase/admin';
import { decryptToken } from '@/lib/crypto';
import crypto from 'crypto';

export interface GmailClientContext {
  accountId: string;
  ownerUserId: string;
  email: string;
  accessToken: string;
}

// In-memory token cache to prevent spamming Google's token endpoint on rapid requests
// Key: accountId -> { accessToken, expiresAtMs }
const tokenCache = new Map<string, { accessToken: string; expiresAtMs: number }>();

/**
 * Shared helper: fetches the Gmail account from Supabase, decrypts the refresh token,
 * refreshes the access token if needed, and handles invalid_grant by marking needs_reconnect.
 */
export async function getGmailClient(accountId: string): Promise<GmailClientContext> {
  const adminClient = createAdminClient();

  const { data: account, error: accError } = await adminClient
    .from('gmail_accounts')
    .select('id, owner_user_id, email, encrypted_refresh_token, status, pause_reason')
    .eq('id', accountId)
    .single();

  if (accError || !account) {
    throw new Error(`Mailbox account not found: ${accountId}`);
  }

  if (!account.encrypted_refresh_token) {
    throw new Error(`Mailbox ${account.email} has no refresh token. Please connect Gmail in Settings.`);
  }

  // Check in-memory cache (valid if more than 2 minutes remain)
  const cached = tokenCache.get(account.id);
  if (cached && cached.expiresAtMs > Date.now() + 120_000) {
    return {
      accountId: account.id,
      ownerUserId: account.owner_user_id,
      email: account.email,
      accessToken: cached.accessToken,
    };
  }

  // Decrypt refresh token
  let refreshToken: string;
  try {
    refreshToken = decryptToken(account.encrypted_refresh_token);
  } catch (err: any) {
    console.error(`Token decryption failed for account ${account.email}:`, err?.message);
    await adminClient
      .from('gmail_accounts')
      .update({
        status: 'needs_reconnect',
        pause_reason: 'Token decryption failed. Encryption key mismatch or corrupted token. Please reconnect.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    throw new Error(`Encryption key mismatch for ${account.email}. Reconnection required.`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId.includes('placeholder')) {
    throw new Error('Missing Google OAuth credentials in environment (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  }

  // Refresh access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok || tokenData.error) {
    console.error(`Google token refresh failed for ${account.email}:`, tokenData.error, tokenData.error_description);

    if (tokenData.error === 'invalid_grant') {
      // Refresh token revoked by user or expired
      await adminClient
        .from('gmail_accounts')
        .update({
          status: 'needs_reconnect',
          pause_reason: 'Google authorization revoked or expired. Reconnection required.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', account.id);

      await adminClient.from('audit_log').insert({
        user_id: account.owner_user_id,
        action: 'mailbox.invalid_grant',
        target: account.id,
        metadata: { email: account.email, error: tokenData.error },
      });

      throw new Error(`Google authorization expired for ${account.email}. Please reconnect Gmail in Settings.`);
    }

    throw new Error(`Google token refresh error: ${tokenData.error || tokenRes.statusText}`);
  }

  const accessToken = tokenData.access_token;
  const expiresInSec = tokenData.expires_in || 3600;
  tokenCache.set(account.id, {
    accessToken,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  });

  return {
    accountId: account.id,
    ownerUserId: account.owner_user_id,
    email: account.email,
    accessToken,
  };
}

/**
 * Helper to fetch Gmail client for a specific user ID
 */
export async function getGmailClientForUser(userId: string): Promise<GmailClientContext> {
  const adminClient = createAdminClient();
  const { data: account, error } = await adminClient
    .from('gmail_accounts')
    .select('id, email, status')
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (error || !account) {
    throw new Error('No Gmail account linked to this user. Please connect Gmail in Settings.');
  }

  return getGmailClient(account.id);
}

/**
 * Builds a standards-compliant RFC 2822 email message formatted and base64url-encoded.
 */
export function buildRfc2822Raw(params: {
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  ccEmail?: string | null;
  bccEmail?: string | null;
  subject: string;
  bodyText: string;
  inReplyToMessageId?: string | null;
  referencesMessageId?: string | null;
}): string {
  const lines: string[] = [];

  const fromFormatted = params.fromName
    ? `"${params.fromName.replace(/"/g, '')}" <${params.fromEmail}>`
    : params.fromEmail;

  lines.push(`From: ${fromFormatted}`);
  lines.push(`To: ${params.toEmail}`);
  if (params.ccEmail && params.ccEmail.trim()) {
    lines.push(`Cc: ${params.ccEmail.trim()}`);
  }
  if (params.bccEmail && params.bccEmail.trim()) {
    lines.push(`Bcc: ${params.bccEmail.trim()}`);
  }

  lines.push(`Subject: ${params.subject}`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push(`MIME-Version: 1.0`);

  const uniqueId = `<crm-${Date.now()}-${crypto.randomBytes(8).toString('hex')}@basimcrm.internal>`;
  lines.push(`Message-ID: ${uniqueId}`);

  if (params.inReplyToMessageId) {
    const cleanInReplyTo = params.inReplyToMessageId.startsWith('<') && params.inReplyToMessageId.endsWith('>')
      ? params.inReplyToMessageId
      : `<${params.inReplyToMessageId}>`;
    lines.push(`In-Reply-To: ${cleanInReplyTo}`);

    if (params.referencesMessageId) {
      const cleanRef = params.referencesMessageId.startsWith('<') && params.referencesMessageId.endsWith('>')
        ? params.referencesMessageId
        : `<${params.referencesMessageId}>`;
      lines.push(`References: ${cleanRef} ${cleanInReplyTo}`);
    } else {
      lines.push(`References: ${cleanInReplyTo}`);
    }
  }

  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: 8bit`);
  lines.push(''); // RFC 2822 empty line between headers and body
  lines.push(params.bodyText);

  const rawMessage = lines.join('\r\n');

  // base64url encode
  return Buffer.from(rawMessage, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Sends an email directly via the official Gmail API (users.messages.send)
 */
export async function sendGmailMessageViaApi(params: {
  accountId: string;
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  ccEmail?: string | null;
  bccEmail?: string | null;
  subject: string;
  bodyText: string;
  gmailThreadId?: string | null;
  inReplyToMessageId?: string | null;
  referencesMessageId?: string | null;
}): Promise<{
  gmailMessageId: string;
  gmailThreadId: string;
}> {
  const { accessToken } = await getGmailClient(params.accountId);

  const raw = buildRfc2822Raw({
    fromEmail: params.fromEmail,
    fromName: params.fromName,
    toEmail: params.toEmail,
    ccEmail: params.ccEmail,
    bccEmail: params.bccEmail,
    subject: params.subject,
    bodyText: params.bodyText,
    inReplyToMessageId: params.inReplyToMessageId,
    referencesMessageId: params.referencesMessageId,
  });

  const sendPayload: { raw: string; threadId?: string } = { raw };
  if (params.gmailThreadId) {
    sendPayload.threadId = params.gmailThreadId;
  }

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sendPayload),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error('Gmail API users.messages.send error:', res.status, errorBody);

    let parsedMsg = `Gmail send failed (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(errorBody);
      parsedMsg = parsed?.error?.message || parsedMsg;
    } catch {
      // fallback
    }

    throw new Error(parsedMsg);
  }

  const data = await res.json();
  if (!data.id) {
    throw new Error('Gmail API send returned no message ID');
  }

  return {
    gmailMessageId: data.id,
    gmailThreadId: data.threadId || data.id,
  };
}
