import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptToken } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const searchParams = req.nextUrl.searchParams;

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const errorParam = searchParams.get('error');

  const errorRedirect = (errorCode: string) => {
    return NextResponse.redirect(`${origin}/settings?error=${encodeURIComponent(errorCode)}`);
  };

  if (errorParam) {
    console.error('Google OAuth callback returned error:', errorParam);
    return errorRedirect(`access_denied: ${errorParam}`);
  }

  if (!code || !state) {
    return errorRedirect('missing_code_or_state');
  }

  // 1. Validate state and PKCE verifier from cookies
  const savedState = req.cookies.get('gmail_oauth_state')?.value;
  const codeVerifier = req.cookies.get('gmail_oauth_verifier')?.value;

  if (!savedState || savedState !== state) {
    console.error('OAuth state mismatch. Expected:', savedState ? 'present' : 'none');
    return errorRedirect('invalid_state');
  }

  if (!codeVerifier) {
    console.error('OAuth PKCE verifier cookie missing.');
    return errorRedirect('missing_pkce_verifier');
  }

  // 2. Parse state payload and verify active session
  let statePayload: { userId: string };
  try {
    const jsonStr = Buffer.from(state, 'base64').toString('utf8');
    statePayload = JSON.parse(jsonStr);
  } catch {
    console.error('OAuth state payload base64 decode failed.');
    return errorRedirect('corrupt_state');
  }

  const serverClient = createServerClient();
  const { data: { user }, error: authError } = await serverClient.auth.getUser();

  if (authError || !user || user.id !== statePayload.userId) {
    console.error('OAuth user session mismatch.');
    return NextResponse.redirect(`${origin}/login?error=session_mismatch`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId.includes('placeholder')) {
    console.error('Missing Google OAuth credentials in environment.');
    return errorRedirect('missing_google_credentials');
  }

  const redirectUri = `${origin}/api/auth/callback`;

  // 3. Exchange authorization code for tokens
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('Google token exchange error (HTTP ' + tokenRes.status + '):', errText);
    return errorRedirect('token_exchange_failed');
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;

  if (!accessToken) {
    console.error('Google token exchange did not return access_token');
    return errorRedirect('no_access_token');
  }

  // 4. Fetch the connected Google account's email address
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userInfoRes.ok) {
    console.error('Failed fetching Google profile (HTTP ' + userInfoRes.status + ')');
    return errorRedirect('failed_fetching_google_profile');
  }

  const userInfo = await userInfoRes.json();
  const googleEmail = (userInfo.email || '').trim().toLowerCase();

  if (!googleEmail) {
    console.error('Google profile contained empty email');
    return errorRedirect('empty_google_email');
  }

  // 5. Encrypt refresh token (AES-256-GCM)
  const adminClient = createAdminClient();
  const nowIso = new Date().toISOString();

  let encryptedRefreshToken: string | null = null;
  if (refreshToken) {
    try {
      encryptedRefreshToken = encryptToken(refreshToken);
    } catch (err: any) {
      console.error('Failed encrypting refresh token:', err?.message);
      return errorRedirect('encryption_failed');
    }
  }

  // 6. Upsert on owner_user_id in gmail_accounts
  // If an existing row belongs to this user, update it.
  // Also clean up any unlinked row with the same email to avoid unique constraint conflict.
  const { data: existingUserAcc } = await adminClient
    .from('gmail_accounts')
    .select('id, encrypted_refresh_token, email')
    .eq('owner_user_id', user.id)
    .maybeSingle();

  // If there is another row with googleEmail that does NOT belong to user.id, delete or reassign it
  const { data: conflictAcc } = await adminClient
    .from('gmail_accounts')
    .select('id, owner_user_id')
    .eq('email', googleEmail)
    .neq('owner_user_id', user.id)
    .maybeSingle();

  if (conflictAcc) {
    await adminClient
      .from('gmail_accounts')
      .delete()
      .eq('id', conflictAcc.id);
  }

  const finalRefreshToken = encryptedRefreshToken || existingUserAcc?.encrypted_refresh_token || null;

  if (existingUserAcc) {
    await adminClient
      .from('gmail_accounts')
      .update({
        email: googleEmail,
        encrypted_refresh_token: finalRefreshToken,
        status: 'active',
        connected_at: nowIso,
        pause_reason: null,
        updated_at: nowIso,
      })
      .eq('id', existingUserAcc.id);
  } else {
    await adminClient.from('gmail_accounts').insert({
      owner_user_id: user.id,
      email: googleEmail,
      encrypted_refresh_token: finalRefreshToken,
      status: 'active',
      connected_at: nowIso,
      daily_cap: 15,
      warmup_started_at: nowIso,
      warmup_override: true,
    });
  }

  // Safely update connected_gmail in team_members if column exists
  try {
    await adminClient
      .from('team_members')
      .update({
        connected_gmail: googleEmail,
        updated_at: nowIso,
      })
      .eq('id', user.id);
  } catch (err) {
    // Non-fatal if column is being added
  }

  // Write audit log
  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'mailbox.connect_gmail_oauth',
    target: googleEmail,
    metadata: {
      email: googleEmail,
      hasRefreshToken: !!finalRefreshToken,
    },
  });

  // 7. Clear oauth cookies and redirect to /settings?connected=1
  const redirectResponse = NextResponse.redirect(
    `${origin}/settings?connected=1&email=${encodeURIComponent(googleEmail)}`
  );

  redirectResponse.cookies.set('gmail_oauth_state', '', { path: '/', maxAge: 0 });
  redirectResponse.cookies.set('gmail_oauth_verifier', '', { path: '/', maxAge: 0 });

  return redirectResponse;
}
