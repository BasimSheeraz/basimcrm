import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isExecutableBlocked } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const attachmentId = params.id;

  // 1. Verify authenticated team member session
  const serverClient = createServerClient();
  const { data: { user }, error: authError } = await serverClient.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized: login required' }, { status: 401 });
  }

  const { data: isMember } = await serverClient.rpc('is_team_member');
  if (!isMember) {
    return NextResponse.json({ error: 'Forbidden: active team member access required' }, { status: 403 });
  }

  // 2. Query attachment metadata from database
  const adminClient = createAdminClient();
  const { data: attachment, error: attError } = await adminClient
    .from('attachments')
    .select(`
      id,
      filename,
      mime_type,
      size,
      gmail_attachment_id,
      message_id,
      messages (gmail_message_id)
    `)
    .eq('id', attachmentId)
    .single();

  if (attError || !attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  // 3. Security block: Prevent download/preview of executable file types
  if (isExecutableBlocked(attachment.filename)) {
    return NextResponse.json({
      error: `Security Alert: Executable file types (${attachment.filename}) are blocked from download or preview.`
    }, { status: 403 });
  }

  // 4. In sandbox/dev mode without Gmail token, return sample text/binary stream
  const sampleContent = Buffer.from(`Simulated file contents for ${attachment.filename}\nSize: ${attachment.size} bytes\nBasim CRM Secure Attachment Proxy.`);

  return new NextResponse(sampleContent, {
    status: 200,
    headers: {
      'Content-Type': attachment.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
      'Content-Length': sampleContent.length.toString(),
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
