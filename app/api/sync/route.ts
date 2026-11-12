import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { runGmailSync } from '@/lib/sync-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleSync(req);
}

export async function POST(req: NextRequest) {
  return handleSync(req);
}

async function handleSync(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const xCronSecret = req.headers.get('x-cron-secret') || '';
  const cronSecret = process.env.CRON_SECRET;

  const isCronAuthed = Boolean(
    cronSecret && (
      authHeader === `Bearer ${cronSecret}` || 
      xCronSecret === cronSecret
    )
  );

  let signedInUserId: string | undefined = undefined;

  if (!isCronAuthed) {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseAnonKey) {
        return NextResponse.json(
          { error: 'Server configuration error' },
          { status: 500 }
        );
      }

      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          get(name: string) {
            return req.cookies.get(name)?.value;
          },
          set() {},
          remove() {},
        },
      });

      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        return NextResponse.json(
          { error: 'Unauthorized: valid CRON_SECRET header (Authorization: Bearer <CRON_SECRET>) or active session required' },
          { status: 401 }
        );
      }
      signedInUserId = user.id;
    } catch (err: any) {
      return NextResponse.json(
        { error: 'Unauthorized: valid CRON_SECRET header (Authorization: Bearer <CRON_SECRET>) or active session required' },
        { status: 401 }
      );
    }
  }

  const requestedAccountId = req.nextUrl.searchParams.get('accountId') || undefined;

  try {
    const result = await runGmailSync({
      userId: signedInUserId,
      accountId: requestedAccountId,
    });

    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('/api/sync execution error:', err?.message);
    return NextResponse.json(
      { success: false, error: err?.message || 'Sync execution failed' },
      { status: 500 }
    );
  }
}
