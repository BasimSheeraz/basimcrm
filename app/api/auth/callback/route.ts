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

  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/?view=settings&error=${encodeURIComponent('Google authentication cancelled: ' + errorParam)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${origin}/?view=settings&error=missing_code_or_state`
    );
  }

  // 1. Validate state against cookie
  const savedState = req.cookies.get('gmail_oauth_state')?.value;
  const codeVerifier = req.cookies.get('gmail_oauth_verifier')?.value;

  if (!savedState || savedState !== state) {
    return NextResponse.redirect(
      `${origin}/?view=settings&error=invalid_state`
    );
  }

  if (!codeVerifier) {
    return NextResponse.redirect(
      `${origin}/?view=settings&error=missing_pkce_verifier`
    );
  }

  // 2. Parse state payload and verify user
  let statePayload: { userId: string };
  try {
    const jsonStr = Buffer.from(state, 'base64').toString('utf8');
    statePayload = JSON.parse(jsonStr);
  } catch {
    return NextResponse.redirect(
      `${origin}/?view=settings&error=corrupt_state`
    );
  }

  const serverClient = createServerClient();
  const { data: { user }, error: authError } = await serverClient.auth.getUser();

  if (authError || !user || user.id !== statePayload.userId) {
    return NextResponse.redirect(
      `${origin}/login?error=session_mismatch`
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId.includes('placeholder')) {
    return NextResponse.redirect(
      `${origin}/?view=settings&error=missing_google_credentials`
    );
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
    console.error('Google token exchange error:', errText);
    return NextResponse.redirect(
      `${origin}/?view=settings&error=token_exchange_failed`
    );
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;

  if (!accessToken) {
    return NextResponse.redirect(
      `${origin}/?view=settings&error=no_access_token`
    );
  }

  // 4. Fetch the connected Google account's email address
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userInfoRes.ok) {
    return NextResponse.redirect(
      `${origin}/?view=settings&error=failed_fetching_google_profile`
    );
  }

  const userInfo = await userInfoRes.json();
  const googleEmail = (userInfo.email || '').trim().toLowerCase();

  if (!googleEmail) {
    return NextResponse.redirect(
      `${origin}/?view=settings&error=empty_google_email`
    );
  }

  // 5. Encrypt refresh token (if present)
  const adminClient = createAdminClient();
  const nowIso = new Date().toISOString();

  // If Google did not return a new refresh token (user already consented previously),
  // retain existing encrypted token
  let encryptedRefreshToken: string | null = null;
  if (refreshToken) {
    try {
      encryptedRefreshToken = encryptToken(refreshToken);
    } catch (err: any) {
      console.error('Failed encrypting refresh token:', err);
      return NextResponse.redirect(
        `${origin}/?view=settings&error=encryption_failed`
      );
    }
  }

  // Check if account already exists for this user
  const { data: existingAcc } = await adminClient
    .from('gmail_accounts')
    .select('id, encrypted_refresh_token')
    .eq('owner_user_id', user.id)
    .maybeSingle();

  const finalRefreshToken = encryptedRefreshToken || existingAcc?.encrypted_refresh_token || null;

  if (existingAcc) {
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
      .eq('id', existingAcc.id);
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

  // Update connected_gmail in team_members
  await adminClient
    .from('team_members')
    .update({
      connected_gmail: googleEmail,
      updated_at: nowIso,
    })
    .eq('id', user.id);

  // Log in audit_log
  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'mailbox.connect_gmail_oauth',
    metadata: {
      email: googleEmail,
      hasRefreshToken: !!finalRefreshToken,
    },
  });

  // 6. Clear oauth cookies and redirect with success
  const redirectResponse = NextResponse.redirect(
    `${origin}/?view=settings&success=gmail_connected&email=${encodeURIComponent(googleEmail)}`
  );

  redirectResponse.cookies.set('gmail_oauth_state', '', { path: '/', maxAge: 0 });
  redirectResponse.cookies.set('gmail_oauth_verifier', '', { path: '/', maxAge: 0 });

  return redirectResponse;
}
