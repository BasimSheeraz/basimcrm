import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
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
    const serverClient = createServerClient();
    const { data: { user }, error } = await serverClient.auth.getUser();
    if (error || !user) {
      return NextResponse.json(
        { error: 'Unauthorized: valid CRON_SECRET header (Authorization: Bearer <CRON_SECRET>) or active session required' },
        { status: 401 }
      );
    }
    signedInUserId = user.id;
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
    console.error('/api/sync fatal error:', err?.message);
    return NextResponse.json(
      { success: false, error: err?.message || 'Sync failed' },
      { status: 500 }
    );
  }
}
