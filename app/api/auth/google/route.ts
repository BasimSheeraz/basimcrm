import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient as createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function GET(req: NextRequest) {
  // 1. Ensure user is logged in
  const serverClient = createServerClient();
  const { data: { user }, error: authError } = await serverClient.auth.getUser();

  const origin = req.nextUrl.origin;

  if (authError || !user) {
    return NextResponse.redirect(`${origin}/login?error=auth_required`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || clientId.includes('placeholder')) {
    return NextResponse.redirect(
      `${origin}/?view=settings&error=missing_google_credentials`
    );
  }

  // 2. Determine redirect URI
  const redirectUri = `${origin}/api/auth/callback`;

  // 3. Generate PKCE code_verifier and code_challenge
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = base64UrlEncode(hash);

  // 4. Generate random state with user id
  const statePayload = {
    userId: user.id,
    nonce: crypto.randomBytes(16).toString('hex'),
    createdAt: Date.now(),
  };
  const state = base64UrlEncode(Buffer.from(JSON.stringify(statePayload)));

  // 5. Build Google OAuth URL
  const scopes = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // 6. Set secure cookies and redirect
  const response = NextResponse.redirect(authUrl.toString());

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 10 * 60, // 10 minutes
  };

  response.cookies.set('gmail_oauth_state', state, cookieOptions);
  response.cookies.set('gmail_oauth_verifier', codeVerifier, cookieOptions);

  return response;
}
