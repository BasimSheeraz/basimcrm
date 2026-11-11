'use server';

import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const addTeammateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address').toLowerCase(),
  role: z.enum(['admin', 'member']),
  initialPassword: z.string().min(12, 'Password must be at least 12 characters'),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0A84FF')
});

const changePasswordSchema = z.object({
  newPassword: z.string().min(12, 'New password must be at least 12 characters')
});

/**
 * Verifies that the caller is an authenticated team admin.
 */
async function verifyAdminCaller() {
  const serverClient = createServerClient();
  const { data: { user }, error: authError } = await serverClient.auth.getUser();

  if (authError || !user) {
    throw new Error('Unauthorized: login required');
  }

  // Check admin role
  const { data: member, error: memberError } = await serverClient
    .from('team_members')
    .select('id, role, is_active')
    .eq('id', user.id)
    .single();

  if (memberError || !member || !member.is_active || member.role !== 'admin') {
    throw new Error('Forbidden: administrator privileges required');
  }

  return user;
}

export async function addTeammateAction(formData: {
  name: string;
  email: string;
  role: 'admin' | 'member';
  initialPassword: string;
  avatarColor?: string;
}) {
  const parsed = addTeammateSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const admin = await verifyAdminCaller();
  const adminClient = createAdminClient();

  // 1. Create auth user in Supabase
  const { data: newAuthUser, error: createAuthError } = await adminClient.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.initialPassword,
    email_confirm: true,
    user_metadata: { name: parsed.data.name }
  });

  if (createAuthError || !newAuthUser.user) {
    return { success: false, error: createAuthError?.message || 'Failed to create user in Auth' };
  }

  // 2. Insert into team_members table
  const { error: insertMemberError } = await adminClient
    .from('team_members')
    .insert({
      id: newAuthUser.user.id,
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      avatar_color: parsed.data.avatarColor || '#0A84FF',
      is_active: true
    });

  if (insertMemberError) {
    // Rollback auth user
    await adminClient.auth.admin.deleteUser(newAuthUser.user.id);
    return { success: false, error: insertMemberError.message };
  }

  // 3. Log audit event
  await adminClient.from('audit_log').insert({
    user_id: admin.id,
    action: 'team.add_member',
    target: newAuthUser.user.id,
    metadata: {
      email: parsed.data.email,
      name: parsed.data.name,
      role: parsed.data.role
    }
  });

  return { success: true, userId: newAuthUser.user.id };
}

export async function setTeammateActiveStatusAction(targetUserId: string, isActive: boolean) {
  const admin = await verifyAdminCaller();
  if (admin.id === targetUserId && !isActive) {
    return { success: false, error: 'You cannot deactivate your own admin account.' };
  }

  const adminClient = createAdminClient();

  // Ensure last admin is not deactivated
  if (!isActive) {
    const { count } = await adminClient
      .from('team_members')
      .select('id', { count: 'exact' })
      .eq('role', 'admin')
      .eq('is_active', true)
      .neq('id', targetUserId);

    if (count === 0) {
      return { success: false, error: 'Cannot deactivate the last active administrator.' };
    }
  }

  // Update status
  const { error } = await adminClient
    .from('team_members')
    .update({ is_active: isActive })
    .eq('id', targetUserId);

  if (error) return { success: false, error: error.message };

  // If deactivating, immediately revoke Supabase auth session
  if (!isActive) {
    await adminClient.auth.admin.signOut(targetUserId);
  }

  // Log audit
  await adminClient.from('audit_log').insert({
    user_id: admin.id,
    action: isActive ? 'team.activate_member' : 'team.deactivate_member',
    target: targetUserId,
    metadata: { targetUserId, isActive }
  });

  return { success: true };
}

export async function changeTeammateRoleAction(targetUserId: string, newRole: 'admin' | 'member') {
  const admin = await verifyAdminCaller();
  const adminClient = createAdminClient();

  if (admin.id === targetUserId && newRole !== 'admin') {
    return { success: false, error: 'You cannot remove your own admin privileges.' };
  }

  // Check if demoting the last admin
  if (newRole === 'member') {
    const { count } = await adminClient
      .from('team_members')
      .select('id', { count: 'exact' })
      .eq('role', 'admin')
      .eq('is_active', true)
      .neq('id', targetUserId);

    if (count === 0) {
      return { success: false, error: 'Cannot demote the last remaining active administrator.' };
    }
  }

  const { error } = await adminClient
    .from('team_members')
    .update({ role: newRole })
    .eq('id', targetUserId);

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: admin.id,
    action: 'team.change_role',
    target: targetUserId,
    metadata: { targetUserId, newRole }
  });

  return { success: true };
}

export async function triggerPasswordResetAction(targetUserId: string, email: string) {
  const admin = await verifyAdminCaller();
  const adminClient = createAdminClient();

  const { error } = await adminClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/login?reset=true`
  });

  if (error) return { success: false, error: error.message };

  await adminClient.from('audit_log').insert({
    user_id: admin.id,
    action: 'team.reset_password_request',
    target: targetUserId,
    metadata: { targetUserId, email }
  });

  return { success: true };
}

export async function adminReset2FAAction(targetUserId: string) {
  const admin = await verifyAdminCaller();
  const adminClient = createAdminClient();

  const { error } = await adminClient.rpc('admin_reset_user_2fa', {
    p_target_user_id: targetUserId
  });

  if (error) return { success: false, error: error.message };

  return { success: true };
}

export async function changeUserPasswordAction(newPassword: string) {
  const serverClient = createServerClient();
  const { data: { user }, error: authError } = await serverClient.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Login required' };
  }

  const parsed = changePasswordSchema.safeParse({ newPassword });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { error } = await serverClient.auth.updateUser({
    password: parsed.data.newPassword
  });

  if (error) return { success: false, error: error.message };

  const adminClient = createAdminClient();
  await adminClient.from('audit_log').insert({
    user_id: user.id,
    action: 'user.change_password',
    target: user.id,
    metadata: {}
  });

  return { success: true };
}

export async function getTeamMembersAction() {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from('team_members')
    .select('*')
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  return data.map((m: any) => {
    const initials = m.name
      .split(' ')
      .map((part: string) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    return {
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role === 'admin' ? 'Lead & Business Development (admin)' : 'Outreach & Partnerships',
      systemRole: m.role as 'admin' | 'member',
      color: m.avatar_color ? `bg-[${m.avatar_color}]` : 'bg-[#0A84FF]',
      initials: initials || 'TM',
      isActive: m.is_active !== false,
      createdAt: m.created_at,
      lastSeenAt: m.last_seen_at || m.updated_at || m.created_at
    };
  });
}

export async function getCurrentUserAction() {
  const serverClient = createServerClient();
  const { data: { user }, error } = await serverClient.auth.getUser();
  if (error || !user) return null;

  const adminClient = createAdminClient();
  const { data: member } = await adminClient
    .from('team_members')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!member) return null;

  const initials = member.name
    .split(' ')
    .map((part: string) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role === 'admin' ? 'Lead & Business Development (admin)' : 'Outreach & Partnerships',
    systemRole: member.role as 'admin' | 'member',
    color: member.avatar_color ? `bg-[${member.avatar_color}]` : 'bg-[#0A84FF]',
    initials: initials || 'TM',
    isActive: member.is_active !== false,
    createdAt: member.created_at,
    lastSeenAt: member.last_seen_at || member.updated_at || member.created_at
  };
}

export async function logAuthEventAction(params: {
  action: 'auth.login_success' | 'auth.logout' | 'auth.login_failed';
  userId?: string;
  email: string;
  userAgent?: string;
  failureReason?: string;
}) {
  try {
    const adminClient = createAdminClient();
    const cleanUa = params.userAgent ? params.userAgent.slice(0, 200) : 'Unknown device';
    await adminClient.from('audit_log').insert({
      user_id: params.userId || null,
      action: params.action,
      target: params.email.toLowerCase(),
      metadata: {
        email: params.email.toLowerCase(),
        userAgent: cleanUa,
        failureReason: params.failureReason ? params.failureReason.slice(0, 200) : undefined,
        timestamp: new Date().toISOString()
      }
    });
    return { success: true };
  } catch (err: any) {
    console.warn('Failed to log auth event:', err?.message);
    return { success: false };
  }
}

export async function getAuthActivityLogsAction() {
  await verifyAdminCaller();
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from('audit_log')
    .select('id, user_id, action, target, metadata, created_at')
    .in('action', ['auth.login_success', 'auth.logout', 'auth.login_failed'])
    .order('created_at', { ascending: false })
    .limit(30);

  if (error || !data) return [];
  return data.map((d: any) => ({
    id: d.id,
    userId: d.user_id,
    action: d.action as 'auth.login_success' | 'auth.logout' | 'auth.login_failed',
    email: d.target || (d.metadata && d.metadata.email) || '',
    createdAt: d.created_at,
    userAgent: d.metadata?.userAgent || 'Browser on Desktop',
    failureReason: d.metadata?.failureReason
  }));
}
