'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { generateRecoveryCodes, hashRecoveryCode } from '@/lib/crypto';
import { createAdminClient } from '@/lib/supabase/admin';

export async function enrollRecoveryCodesAction() {
  const serverClient = createServerClient();
  const { data: { user }, error } = await serverClient.auth.getUser();

  if (error || !user) {
    return { success: false, error: 'Unauthorized: login required' };
  }

  const { rawCodes, hashedCodes } = generateRecoveryCodes();
  const adminClient = createAdminClient();

  // Delete any old unused codes for this user
  await adminClient
    .from('user_2fa_recovery_codes')
    .delete()
    .eq('user_id', user.id);

  // Insert new hashed codes
  const rows = hashedCodes.map(hash => ({
    user_id: user.id,
    code_hash: hash,
    used_at: null
  }));

  const { error: insertError } = await adminClient
    .from('user_2fa_recovery_codes')
    .insert(rows);

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  // Audit log
  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'auth.enroll_recovery_codes',
    target: user.id,
    metadata: { count: rawCodes.length }
  });

  return { success: true, recoveryCodes: rawCodes };
}

export async function verifyRecoveryCodeAction(userId: string, inputCode: string) {
  const adminClient = createAdminClient();
  const hashedInput = hashRecoveryCode(inputCode);

  const { data: matchedCode, error } = await adminClient
    .from('user_2fa_recovery_codes')
    .select('id, used_at')
    .eq('user_id', userId)
    .eq('code_hash', hashedInput)
    .is('used_at', null)
    .single();

  if (error || !matchedCode) {
    return { success: false, error: 'Invalid or already used recovery code' };
  }

  // Mark code as used
  await adminClient
    .from('user_2fa_recovery_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', matchedCode.id);

  await adminClient.from('audit_log').insert({
    user_id: userId,
    action: 'auth.use_recovery_code',
    target: matchedCode.id,
    metadata: { used_at: new Date().toISOString() }
  });

  return { success: true };
}

export async function verifyRecoveryCodeLoginAction(email: string, inputCode: string) {
  const adminClient = createAdminClient();
  const cleanEmail = email.trim().toLowerCase();

  const { data: member, error: memberError } = await adminClient
    .from('team_members')
    .select('id, is_active')
    .eq('email', cleanEmail)
    .single();

  if (memberError || !member || !member.is_active) {
    return { success: false, error: 'User not found or deactivated' };
  }

  return verifyRecoveryCodeAction(member.id, inputCode);
}
