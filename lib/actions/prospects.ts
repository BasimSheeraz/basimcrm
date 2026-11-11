'use server';

import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  Prospect,
  ProspectSocial,
  ProspectStatus,
  SocialPlatform,
  ProspectDuplicateCheckResult,
  ProspectDuplicateMatch,
  ProspectFuzzyWarning,
} from '@/types';
import {
  cleanRawEmail,
  normalizeEmail,
  normalizeSocialHandle,
  buildSocialProfileUrl,
  calculateStringSimilarity,
  isPublicEmailDomain,
  ParsedProspectRow,
} from '@/lib/prospect-normalization';

const socialPlatformEnum = z.enum([
  'instagram',
  'facebook',
  'linkedin',
  'tiktok',
  'x',
  'youtube',
  'website',
  'other',
]);

const prospectStatusEnum = z.enum([
  'new',
  'assigned',
  'contacted',
  'replied',
  'not_interested',
  'bad_email',
  'do_not_contact',
]);

const socialInputSchema = z.object({
  platform: socialPlatformEnum,
  handle: z.string().trim().min(1, 'Social handle or URL is required').max(500),
});

const prospectWriteSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(200),
  company: z.string().trim().max(200).optional().default(''),
  email: z
    .string()
    .trim()
    .max(320)
    .optional()
    .nullable()
    .refine(
      val => !val || val === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      'Invalid email address format'
    ),
  phone: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(5000).optional().default(''),
  source: z.string().trim().max(120).optional().default(''),
  status: prospectStatusEnum.optional().default('new'),
  assignedTo: z.string().uuid().optional().nullable(),
  socials: z.array(socialInputSchema).max(20).optional().default([]),
  confirmFuzzyDuplicate: z.boolean().optional().default(false),
});

async function verifyTeamMemberCaller() {
  const serverClient = createServerClient();
  const {
    data: { user },
    error: authError,
  } = await serverClient.auth.getUser();

  if (authError || !user) {
    throw new Error('Unauthorized: Active sign-in required.');
  }

  const adminClient = createAdminClient();
  const { data: member, error: memberError } = await adminClient
    .from('team_members')
    .select('id, name, email, role, avatar_color, is_active')
    .eq('id', user.id)
    .single();

  if (memberError || !member || !member.is_active) {
    throw new Error('Forbidden: Active team member access required.');
  }

  return member;
}

function formatShortDate(iso?: string | null): string {
  if (!iso) return 'recently';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'recently';
  }
}

function getInitials(name?: string | null): string {
  if (!name) return 'TM';
  return (
    name
      .split(' ')
      .filter(Boolean)
      .map(p => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'TM'
  );
}

function mapProspectRow(
  row: any,
  teamMap: Map<string, { name: string; color: string; initials: string }>
): Prospect {
  const addedMember = teamMap.get(row.added_by);
  const assignedMember = row.assigned_to ? teamMap.get(row.assigned_to) : undefined;

  const socials: ProspectSocial[] = (row.prospect_socials || []).map((s: any) => ({
    id: s.id,
    prospectId: s.prospect_id,
    platform: s.platform as SocialPlatform,
    handle: s.handle,
    handleNormalized: s.handle_normalized,
    profileUrl: s.profile_url,
    createdAt: s.created_at,
  }));

  return {
    id: row.id,
    fullName: row.full_name,
    company: row.company || '',
    email: row.email || null,
    emailNormalized: row.email_normalized || null,
    phone: row.phone || null,
    notes: row.notes || '',
    source: row.source || '',
    status: row.status as ProspectStatus,
    addedBy: row.added_by,
    addedByName: addedMember?.name || 'Teammate',
    addedByColor: addedMember?.color || 'bg-[#0A84FF]',
    addedByInitials: addedMember?.initials || 'TM',
    assignedTo: row.assigned_to || null,
    assignedToName: assignedMember?.name,
    assignedToColor: assignedMember?.color,
    assignedToInitials: assignedMember?.initials,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contactedAt: row.contacted_at || null,
    contactId: row.contact_id || null,
    socials,
  };
}

async function getTeamMap(adminClient: ReturnType<typeof createAdminClient>) {
  const { data: members } = await adminClient
    .from('team_members')
    .select('id, name, avatar_color');

  const map = new Map<string, { name: string; color: string; initials: string }>();
  for (const m of members || []) {
    map.set(m.id, {
      name: m.name,
      color: m.avatar_color ? `bg-[${m.avatar_color}]` : 'bg-[#0A84FF]',
      initials: getInitials(m.name),
    });
  }
  return map;
}

/**
 * Comprehensive server-side duplicate check across:
 * 1. prospects (email_normalized)
 * 2. prospect_socials (platform + handle_normalized)
 * 3. contacts (normalized email)
 * 4. threads (contact_email)
 * 5. do_not_contact (exact email or domain)
 * 6. Fuzzy similarity on full_name + company or corporate domain
 */
export async function checkProspectDuplicatesAction(params: {
  fullName?: string;
  company?: string;
  email?: string | null;
  socials?: { platform: SocialPlatform; handle: string }[];
  excludeProspectId?: string;
}): Promise<ProspectDuplicateCheckResult> {
  await verifyTeamMemberCaller();
  const adminClient = createAdminClient();
  const teamMap = await getTeamMap(adminClient);

  const blockingMatches: ProspectDuplicateMatch[] = [];
  const fuzzyWarnings: ProspectFuzzyWarning[] = [];

  const rawEmail = cleanRawEmail(params.email);
  const emailNormalized = normalizeEmail(params.email);
  const emailDomain = rawEmail ? rawEmail.split('@')[1] || '' : '';

  const normalizedSocials = (params.socials || [])
    .map(s => ({
      platform: s.platform,
      rawHandle: s.handle.trim(),
      handleNormalized: normalizeSocialHandle(s.platform, s.handle),
    }))
    .filter(s => s.handleNormalized.length > 0);

  // 1. Check Do Not Contact List first
  if (rawEmail) {
    const { data: dncRows } = await adminClient
      .from('do_not_contact')
      .select('id, type, value, reason, created_by_user_id, created_at')
      .or(`value.eq.${rawEmail},value.eq.${emailNormalized},value.eq.${emailDomain}`);

    if (dncRows && dncRows.length > 0) {
      const dnc = dncRows[0];
      const who = dnc.created_by_user_id
        ? teamMap.get(dnc.created_by_user_id)?.name || 'System'
        : 'System';
      blockingMatches.push({
        type: 'do_not_contact',
        blocking: true,
        message: `Blocked: ${dnc.value} is on the Do Not Contact list (added by ${who} on ${formatShortDate(dnc.created_at)}, reason: ${dnc.reason || 'Opted out'})`,
        addedByName: who,
        addedAt: dnc.created_at,
        status: 'do_not_contact',
        matchedValue: dnc.value,
      });
    }
  }

  // 2. Check exact email_normalized in prospects
  if (emailNormalized) {
    let query = adminClient
      .from('prospects')
      .select('id, full_name, company, email, email_normalized, status, added_by, created_at')
      .eq('email_normalized', emailNormalized);

    if (params.excludeProspectId) {
      query = query.neq('id', params.excludeProspectId);
    }

    const { data: emailMatches } = await query;
    if (emailMatches && emailMatches.length > 0) {
      for (const m of emailMatches) {
        const who = teamMap.get(m.added_by)?.name || 'Teammate';
        blockingMatches.push({
          type: 'exact_email',
          blocking: true,
          message: `Already added by ${who} on ${formatShortDate(m.created_at)}, status: ${m.status} (${m.full_name})`,
          existingProspectId: m.id,
          existingProspectName: m.full_name,
          addedByName: who,
          addedAt: m.created_at,
          status: m.status,
          matchedValue: m.email || emailNormalized,
        });
      }
    }

    // 3. Check existing contacts (normalized email comparison)
    const { data: allContacts } = await adminClient
      .from('contacts')
      .select('id, name, company, email, status, owner_user_id, last_contacted_by_user_id, created_at, last_contacted_at');

    for (const c of allContacts || []) {
      const cNorm = normalizeEmail(c.email);
      if (cNorm && cNorm === emailNormalized) {
        // Ignore if this contact is already linked to the prospect being edited
        if (params.excludeProspectId) {
          const { data: selfProspect } = await adminClient
            .from('prospects')
            .select('contact_id')
            .eq('id', params.excludeProspectId)
            .single();
          if (selfProspect?.contact_id === c.id) continue;
        }

        const ownerId = c.owner_user_id || c.last_contacted_by_user_id;
        const who = ownerId ? teamMap.get(ownerId)?.name || 'Teammate' : 'Team';
        const dateStr = formatShortDate(c.last_contacted_at || c.created_at);
        blockingMatches.push({
          type: 'existing_contact',
          blocking: true,
          message: `Already in Contacts / Emailed by ${who} on ${dateStr}, status: ${c.status} (${c.name})`,
          existingContactId: c.id,
          existingProspectName: c.name,
          addedByName: who,
          addedAt: c.last_contacted_at || c.created_at,
          status: c.status,
          matchedValue: c.email,
        });
      }
    }

    // 4. Check existing threads by contact_email
    const { data: threadMatches } = await adminClient
      .from('threads')
      .select('id, subject, contact_email, assigned_to_user_id, last_message_at')
      .ilike('contact_email', rawEmail || emailNormalized)
      .limit(1);

    if (
      threadMatches &&
      threadMatches.length > 0 &&
      !blockingMatches.some(b => b.type === 'existing_contact')
    ) {
      const t = threadMatches[0];
      const who = t.assigned_to_user_id
        ? teamMap.get(t.assigned_to_user_id)?.name || 'Teammate'
        : 'Team';
      blockingMatches.push({
        type: 'existing_thread',
        blocking: true,
        message: `Active email thread already exists with ${t.contact_email} (handled by ${who} on ${formatShortDate(t.last_message_at)})`,
        addedByName: who,
        addedAt: t.last_message_at,
        status: 'contacted',
        matchedValue: t.contact_email,
      });
    }
  }

  // 5. Check exact (platform, handle_normalized) in prospect_socials
  for (const soc of normalizedSocials) {
    const { data: socialMatches } = await adminClient
      .from('prospect_socials')
      .select(`
        id,
        prospect_id,
        platform,
        handle,
        handle_normalized,
        prospects:prospect_id (
          id,
          full_name,
          status,
          added_by,
          created_at
        )
      `)
      .eq('platform', soc.platform)
      .eq('handle_normalized', soc.handleNormalized);

    for (const sm of socialMatches || []) {
      if (params.excludeProspectId && sm.prospect_id === params.excludeProspectId) {
        continue;
      }
      const p = sm.prospects as any;
      const who = p?.added_by ? teamMap.get(p.added_by)?.name || 'Teammate' : 'Teammate';
      const when = formatShortDate(p?.created_at);
      const status = p?.status || 'new';
      blockingMatches.push({
        type: 'exact_social',
        blocking: true,
        message: `${soc.platform.toUpperCase()} @${soc.handleNormalized} already added by ${who} on ${when}, status: ${status} (${p?.full_name || 'Prospect'})`,
        existingProspectId: sm.prospect_id,
        existingProspectName: p?.full_name,
        addedByName: who,
        addedAt: p?.created_at,
        status,
        matchedValue: `@${soc.handleNormalized}`,
      });
    }
  }

  // 6. Fuzzy warning check: similar name + same company, or same non-public email domain + similar name
  const cleanName = (params.fullName || '').trim();
  const cleanCompany = (params.company || '').trim().toLowerCase();
  const hasCorpDomain = emailDomain && !isPublicEmailDomain(emailDomain);

  if (cleanName.length >= 3 && (cleanCompany.length >= 2 || hasCorpDomain)) {
    let fuzzyQuery = adminClient
      .from('prospects')
      .select('id, full_name, company, email, status, added_by, created_at')
      .limit(200);

    if (params.excludeProspectId) {
      fuzzyQuery = fuzzyQuery.neq('id', params.excludeProspectId);
    }

    const { data: candidates } = await fuzzyQuery;
    for (const cand of candidates || []) {
      // Skip if already in blockingMatches
      if (blockingMatches.some(b => b.existingProspectId === cand.id)) continue;

      const nameSim = calculateStringSimilarity(cleanName, cand.full_name);
      const candCompany = (cand.company || '').trim().toLowerCase();
      const companySim =
        cleanCompany && candCompany ? calculateStringSimilarity(cleanCompany, candCompany) : 0;
      const candDomain = cand.email ? cand.email.split('@')[1] || '' : '';
      const sameCorpDomain = hasCorpDomain && candDomain.toLowerCase() === emailDomain.toLowerCase();

      if ((nameSim >= 0.72 && companySim >= 0.75) || (sameCorpDomain && nameSim >= 0.65)) {
        const who = teamMap.get(cand.added_by)?.name || 'Teammate';
        fuzzyWarnings.push({
          existingProspectId: cand.id,
          fullName: cand.full_name,
          company: cand.company || '',
          email: cand.email,
          addedByName: who,
          addedAt: cand.created_at,
          status: cand.status,
          reason: sameCorpDomain
            ? `Similar name at same domain (@${emailDomain})`
            : `Similar name at same company (${cand.company})`,
        });
      }
    }
  }

  return {
    hasExactDuplicate: blockingMatches.length > 0,
    blockingMatches,
    fuzzyWarnings,
  };
}

/**
 * Fetches paginated, filtered, sorted prospects list (50 per page).
 */
export async function getProspectsAction(params?: {
  search?: string;
  status?: string;
  assignedTo?: string;
  platform?: string;
  noEmailYet?: boolean;
  sortBy?: 'created_at_desc' | 'created_at_asc' | 'name_asc' | 'company_asc' | 'status_asc';
  page?: number;
  pageSize?: number;
}): Promise<{
  prospects: Prospect[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}> {
  await verifyTeamMemberCaller();
  const adminClient = createAdminClient();
  const teamMap = await getTeamMap(adminClient);

  const page = Math.max(0, params?.page || 0);
  const pageSize = Math.min(100, Math.max(1, params?.pageSize || 50));

  let query = adminClient
    .from('prospects')
    .select(
      `
      *,
      prospect_socials (
        id,
        prospect_id,
        platform,
        handle,
        handle_normalized,
        profile_url,
        created_at
      )
    `,
      { count: 'exact' }
    );

  // Filter: status
  if (params?.status && params.status !== 'all') {
    query = query.eq('status', params.status);
  }

  // Filter: assignedTo
  if (params?.assignedTo && params.assignedTo !== 'all') {
    if (params.assignedTo === 'unassigned') {
      query = query.is('assigned_to', null);
    } else {
      query = query.eq('assigned_to', params.assignedTo);
    }
  }

  // Filter: "no email yet"
  if (params?.noEmailYet) {
    query = query.is('email', null);
  }

  // Filter: platform
  if (params?.platform && params.platform !== 'all') {
    const { data: matchingSocialRows } = await adminClient
      .from('prospect_socials')
      .select('prospect_id')
      .eq('platform', params.platform);

    const ids = Array.from(new Set((matchingSocialRows || []).map(r => r.prospect_id)));
    if (ids.length === 0) {
      return { prospects: [], totalCount: 0, page, pageSize, hasMore: false };
    }
    query = query.in('id', ids);
  }

  // Search: across full_name, company, email, socials_search_text, notes
  const q = (params?.search || '').trim();
  if (q) {
    const safeLike = q.replace(/[%_]/g, '');
    query = query.or(
      `full_name.ilike.%${safeLike}%,company.ilike.%${safeLike}%,email.ilike.%${safeLike}%,socials_search_text.ilike.%${safeLike}%,notes.ilike.%${safeLike}%`
    );
  }

  // Sort
  const sortBy = params?.sortBy || 'created_at_desc';
  if (sortBy === 'created_at_asc') {
    query = query.order('created_at', { ascending: true });
  } else if (sortBy === 'name_asc') {
    query = query.order('full_name', { ascending: true });
  } else if (sortBy === 'company_asc') {
    query = query.order('company', { ascending: true });
  } else if (sortBy === 'status_asc') {
    query = query.order('status', { ascending: true }).order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const from = page * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error || !data) {
    console.warn('getProspectsAction error:', error?.message);
    return { prospects: [], totalCount: 0, page, pageSize, hasMore: false };
  }

  const totalCount = count ?? data.length;
  const prospects = data.map(row => mapProspectRow(row, teamMap));

  return {
    prospects,
    totalCount,
    page,
    pageSize,
    hasMore: from + prospects.length < totalCount,
  };
}

/**
 * Adds a new prospect with server-side zod validation, normalization, duplicate check, and audit log.
 */
export async function addProspectAction(input: {
  fullName: string;
  company?: string;
  email?: string | null;
  phone?: string | null;
  notes?: string;
  source?: string;
  status?: ProspectStatus;
  assignedTo?: string | null;
  socials?: { platform: SocialPlatform; handle: string }[];
  confirmFuzzyDuplicate?: boolean;
}): Promise<{
  success: boolean;
  prospect?: Prospect;
  error?: string;
  duplicateCheck?: ProspectDuplicateCheckResult;
  requiresFuzzyConfirm?: boolean;
}> {
  const caller = await verifyTeamMemberCaller();

  const parsed = prospectWriteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const d = parsed.data;
  const cleanedEmail = cleanRawEmail(d.email);
  const emailNormalized = normalizeEmail(d.email);

  // Deduplicate socials within the submitted form itself
  const seenSocialKeys = new Set<string>();
  const normalizedSocials: {
    platform: SocialPlatform;
    handle: string;
    handleNormalized: string;
    profileUrl: string;
  }[] = [];

  for (const s of d.socials) {
    const hNorm = normalizeSocialHandle(s.platform, s.handle);
    if (!hNorm) continue;
    const key = `${s.platform}:${hNorm}`;
    if (seenSocialKeys.has(key)) continue;
    seenSocialKeys.add(key);
    normalizedSocials.push({
      platform: s.platform,
      handle: s.handle.trim(),
      handleNormalized: hNorm,
      profileUrl: buildSocialProfileUrl(s.platform, hNorm, s.handle),
    });
  }

  if (!emailNormalized && normalizedSocials.length === 0) {
    return {
      success: false,
      error: 'Please provide at least an email address or one social profile handle/URL.',
    };
  }

  // Run server-side duplicate check
  const dupCheck = await checkProspectDuplicatesAction({
    fullName: d.fullName,
    company: d.company,
    email: cleanedEmail,
    socials: normalizedSocials.map(s => ({ platform: s.platform, handle: s.handle })),
  });

  if (dupCheck.hasExactDuplicate) {
    return {
      success: false,
      error: dupCheck.blockingMatches[0].message,
      duplicateCheck: dupCheck,
    };
  }

  if (dupCheck.fuzzyWarnings.length > 0 && !d.confirmFuzzyDuplicate) {
    return {
      success: false,
      error: `Possible duplicate detected: ${dupCheck.fuzzyWarnings[0].fullName} (${dupCheck.fuzzyWarnings[0].reason}). Please confirm if this is a different person.`,
      duplicateCheck: dupCheck,
      requiresFuzzyConfirm: true,
    };
  }

  const adminClient = createAdminClient();
  const initialStatus: ProspectStatus =
    d.status !== 'new' ? d.status : d.assignedTo ? 'assigned' : 'new';

  const socialsSearchText = normalizedSocials
    .map(s => `${s.platform} ${s.handle} ${s.handleNormalized}`)
    .join(' ');

  const { data: inserted, error: insertError } = await adminClient
    .from('prospects')
    .insert({
      full_name: d.fullName,
      company: d.company || '',
      email: cleanedEmail,
      email_normalized: emailNormalized,
      phone: d.phone?.trim() || null,
      notes: d.notes || '',
      source:
        d.source ||
        (normalizedSocials[0]
          ? normalizedSocials[0].platform.charAt(0).toUpperCase() +
            normalizedSocials[0].platform.slice(1)
          : 'Manual'),
      status: initialStatus,
      added_by: caller.id,
      assigned_to: d.assignedTo || null,
      socials_search_text: socialsSearchText,
    })
    .select('*')
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === '23505') {
      return {
        success: false,
        error: 'Duplicate blocked by database constraint: this email or social profile already exists.',
      };
    }
    return { success: false, error: insertError?.message || 'Failed to save prospect.' };
  }

  // Insert socials
  if (normalizedSocials.length > 0) {
    const { error: socError } = await adminClient.from('prospect_socials').insert(
      normalizedSocials.map(s => ({
        prospect_id: inserted.id,
        platform: s.platform,
        handle: s.handle,
        handle_normalized: s.handleNormalized,
        profile_url: s.profileUrl,
      }))
    );

    if (socError) {
      // Rollback prospect on social unique constraint failure
      await adminClient.from('prospects').delete().eq('id', inserted.id);
      return {
        success: false,
        error:
          socError.code === '23505'
            ? 'Duplicate social handle blocked by database unique constraint.'
            : socError.message,
      };
    }
  }

  // Audit log
  await adminClient.from('audit_log').insert({
    user_id: caller.id,
    action: 'prospects.create',
    target: inserted.id,
    metadata: {
      fullName: d.fullName,
      company: d.company,
      emailNormalized,
      socialsCount: normalizedSocials.length,
      assignedTo: d.assignedTo || null,
    },
  });

  const { data: fullRow } = await adminClient
    .from('prospects')
    .select('*, prospect_socials(*)')
    .eq('id', inserted.id)
    .single();

  const teamMap = await getTeamMap(adminClient);
  return {
    success: true,
    prospect: mapProspectRow(fullRow || inserted, teamMap),
  };
}

/**
 * Updates an existing prospect with duplicate verification and audit logging.
 */
export async function updateProspectAction(
  prospectId: string,
  input: {
    fullName: string;
    company?: string;
    email?: string | null;
    phone?: string | null;
    notes?: string;
    source?: string;
    status?: ProspectStatus;
    assignedTo?: string | null;
    socials?: { platform: SocialPlatform; handle: string }[];
    confirmFuzzyDuplicate?: boolean;
  }
): Promise<{
  success: boolean;
  prospect?: Prospect;
  error?: string;
  duplicateCheck?: ProspectDuplicateCheckResult;
  requiresFuzzyConfirm?: boolean;
}> {
  const caller = await verifyTeamMemberCaller();

  const parsed = prospectWriteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const d = parsed.data;
  const cleanedEmail = cleanRawEmail(d.email);
  const emailNormalized = normalizeEmail(d.email);

  const seenSocialKeys = new Set<string>();
  const normalizedSocials: {
    platform: SocialPlatform;
    handle: string;
    handleNormalized: string;
    profileUrl: string;
  }[] = [];

  for (const s of d.socials) {
    const hNorm = normalizeSocialHandle(s.platform, s.handle);
    if (!hNorm) continue;
    const key = `${s.platform}:${hNorm}`;
    if (seenSocialKeys.has(key)) continue;
    seenSocialKeys.add(key);
    normalizedSocials.push({
      platform: s.platform,
      handle: s.handle.trim(),
      handleNormalized: hNorm,
      profileUrl: buildSocialProfileUrl(s.platform, hNorm, s.handle),
    });
  }

  if (!emailNormalized && normalizedSocials.length === 0) {
    return {
      success: false,
      error: 'Prospect must have at least an email address or one social handle.',
    };
  }

  const dupCheck = await checkProspectDuplicatesAction({
    fullName: d.fullName,
    company: d.company,
    email: cleanedEmail,
    socials: normalizedSocials.map(s => ({ platform: s.platform, handle: s.handle })),
    excludeProspectId: prospectId,
  });

  if (dupCheck.hasExactDuplicate) {
    return {
      success: false,
      error: dupCheck.blockingMatches[0].message,
      duplicateCheck: dupCheck,
    };
  }

  if (dupCheck.fuzzyWarnings.length > 0 && !d.confirmFuzzyDuplicate) {
    return {
      success: false,
      error: `Possible duplicate detected: ${dupCheck.fuzzyWarnings[0].fullName}. Confirm to save anyway.`,
      duplicateCheck: dupCheck,
      requiresFuzzyConfirm: true,
    };
  }

  const adminClient = createAdminClient();
  const socialsSearchText = normalizedSocials
    .map(s => `${s.platform} ${s.handle} ${s.handleNormalized}`)
    .join(' ');

  const { error: updateErr } = await adminClient
    .from('prospects')
    .update({
      full_name: d.fullName,
      company: d.company || '',
      email: cleanedEmail,
      email_normalized: emailNormalized,
      phone: d.phone?.trim() || null,
      notes: d.notes || '',
      source: d.source || '',
      status: d.status,
      assigned_to: d.assignedTo || null,
      socials_search_text: socialsSearchText,
      updated_at: new Date().toISOString(),
    })
    .eq('id', prospectId);

  if (updateErr) {
    return { success: false, error: updateErr.message };
  }

  // Replace socials for this prospect
  await adminClient.from('prospect_socials').delete().eq('prospect_id', prospectId);
  if (normalizedSocials.length > 0) {
    const { error: socErr } = await adminClient.from('prospect_socials').insert(
      normalizedSocials.map(s => ({
        prospect_id: prospectId,
        platform: s.platform,
        handle: s.handle,
        handle_normalized: s.handleNormalized,
        profile_url: s.profileUrl,
      }))
    );
    if (socErr) {
      return { success: false, error: socErr.message };
    }
  }

  await adminClient.from('audit_log').insert({
    user_id: caller.id,
    action: 'prospects.update',
    target: prospectId,
    metadata: {
      fullName: d.fullName,
      emailNormalized,
      status: d.status,
      assignedTo: d.assignedTo || null,
    },
  });

  const { data: updatedRow } = await adminClient
    .from('prospects')
    .select('*, prospect_socials(*)')
    .eq('id', prospectId)
    .single();

  const teamMap = await getTeamMap(adminClient);
  return {
    success: true,
    prospect: updatedRow ? mapProspectRow(updatedRow, teamMap) : undefined,
  };
}

/**
 * Deletes a prospect (allowed only for Admin or the teammate who added it).
 */
export async function deleteProspectAction(prospectId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const caller = await verifyTeamMemberCaller();
  const adminClient = createAdminClient();

  const { data: existing } = await adminClient
    .from('prospects')
    .select('id, full_name, email, added_by')
    .eq('id', prospectId)
    .single();

  if (!existing) {
    return { success: false, error: 'Prospect not found.' };
  }

  if (caller.role !== 'admin' && existing.added_by !== caller.id) {
    return {
      success: false,
      error: 'Forbidden: Only an administrator or the teammate who added this prospect can delete it.',
    };
  }

  const { error } = await adminClient.from('prospects').delete().eq('id', prospectId);
  if (error) {
    return { success: false, error: error.message };
  }

  await adminClient.from('audit_log').insert({
    user_id: caller.id,
    action: 'prospects.delete',
    target: prospectId,
    metadata: {
      fullName: existing.full_name,
      email: existing.email,
    },
  });

  return { success: true };
}

/**
 * Bulk assign or bulk status change on selected prospect IDs.
 */
export async function bulkUpdateProspectsAction(params: {
  prospectIds: string[];
  assignedTo?: string | null;
  status?: ProspectStatus;
}): Promise<{ success: boolean; updatedCount: number; error?: string }> {
  const caller = await verifyTeamMemberCaller();
  if (!params.prospectIds || params.prospectIds.length === 0) {
    return { success: false, updatedCount: 0, error: 'No prospects selected.' };
  }

  const adminClient = createAdminClient();
  const updatePayload: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (params.assignedTo !== undefined) {
    updatePayload.assigned_to = params.assignedTo;
    if (params.assignedTo && !params.status) {
      // Also transition 'new' prospects to 'assigned'
      await adminClient
        .from('prospects')
        .update({ assigned_to: params.assignedTo, status: 'assigned', updated_at: new Date().toISOString() })
        .in('id', params.prospectIds)
        .eq('status', 'new');
    }
  }
  if (params.status !== undefined) {
    updatePayload.status = params.status;
  }

  const { error } = await adminClient
    .from('prospects')
    .update(updatePayload)
    .in('id', params.prospectIds);

  if (error) {
    return { success: false, updatedCount: 0, error: error.message };
  }

  await adminClient.from('audit_log').insert({
    user_id: caller.id,
    action: 'prospects.bulk_update',
    metadata: {
      count: params.prospectIds.length,
      assignedTo: params.assignedTo,
      status: params.status,
    },
  });

  return { success: true, updatedCount: params.prospectIds.length };
}

/**
 * Duplicate-safe merge of two prospects:
 * - Combines socials (skipping exact platform+handleNormalized duplicates)
 * - Keeps the earliest created_at
 * - Combines all notes
 * - Retains non-empty company, email, phone, source, contact_id
 */
export async function mergeProspectsAction(
  primaryId: string,
  secondaryId: string
): Promise<{ success: boolean; mergedProspect?: Prospect; error?: string }> {
  const caller = await verifyTeamMemberCaller();
  if (primaryId === secondaryId) {
    return { success: false, error: 'Cannot merge a prospect with itself.' };
  }

  const adminClient = createAdminClient();
  const { data: rows } = await adminClient
    .from('prospects')
    .select('*, prospect_socials(*)')
    .in('id', [primaryId, secondaryId]);

  if (!rows || rows.length !== 2) {
    return { success: false, error: 'Both prospects must exist to merge.' };
  }

  const primary = rows.find(r => r.id === primaryId)!;
  const secondary = rows.find(r => r.id === secondaryId)!;

  const earliestCreatedAt =
    new Date(primary.created_at).getTime() <= new Date(secondary.created_at).getTime()
      ? primary.created_at
      : secondary.created_at;

  const combinedNotes = [primary.notes, secondary.notes]
    .map(n => (n || '').trim())
    .filter(Boolean)
    .join('\n---\n');

  const mergedEmail = primary.email || secondary.email || null;
  const mergedEmailNormalized = normalizeEmail(mergedEmail);

  // Move non-conflicting socials from secondary to primary before deleting secondary
  const primarySocialKeys = new Set(
    (primary.prospect_socials || []).map((s: any) => `${s.platform}:${s.handle_normalized}`)
  );

  const socialsToMove = (secondary.prospect_socials || []).filter(
    (s: any) => !primarySocialKeys.has(`${s.platform}:${s.handle_normalized}`)
  );

  // Delete secondary first so unique constraints on email_normalized or socials are released
  const { error: delErr } = await adminClient.from('prospects').delete().eq('id', secondaryId);
  if (delErr) {
    return { success: false, error: `Failed to remove merged duplicate: ${delErr.message}` };
  }

  // Insert socials from secondary into primary
  if (socialsToMove.length > 0) {
    await adminClient.from('prospect_socials').insert(
      socialsToMove.map((s: any) => ({
        prospect_id: primaryId,
        platform: s.platform,
        handle: s.handle,
        handle_normalized: s.handle_normalized,
        profile_url: s.profile_url,
      }))
    );
  }

  // Update primary record
  const { error: updErr } = await adminClient
    .from('prospects')
    .update({
      company: primary.company || secondary.company || '',
      email: mergedEmail,
      email_normalized: mergedEmailNormalized,
      phone: primary.phone || secondary.phone || null,
      source: primary.source || secondary.source || '',
      notes: combinedNotes.slice(0, 5000),
      assigned_to: primary.assigned_to || secondary.assigned_to || null,
      contact_id: primary.contact_id || secondary.contact_id || null,
      contacted_at: primary.contacted_at || secondary.contacted_at || null,
      created_at: earliestCreatedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', primaryId);

  if (updErr) {
    return { success: false, error: updErr.message };
  }

  await adminClient.from('audit_log').insert({
    user_id: caller.id,
    action: 'prospects.merge',
    target: primaryId,
    metadata: {
      primaryId,
      secondaryId,
      secondaryName: secondary.full_name,
      secondaryEmail: secondary.email,
    },
  });

  const { data: updatedPrimary } = await adminClient
    .from('prospects')
    .select('*, prospect_socials(*)')
    .eq('id', primaryId)
    .single();

  const teamMap = await getTeamMap(adminClient);
  return {
    success: true,
    mergedProspect: updatedPrimary ? mapProspectRow(updatedPrimary, teamMap) : undefined,
  };
}

export interface BulkPreviewRowResult extends ParsedProspectRow {
  ImportStatus: 'new' | 'duplicate' | 'invalid';
  duplicateReason?: string;
}

/**
 * Analyzes up to 500 parsed bulk rows against existing prospects, socials, contacts, DNC, and earlier rows in the batch.
 */
export async function previewBulkProspectsAction(
  rows: ParsedProspectRow[]
): Promise<{
  results: BulkPreviewRowResult[];
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
}> {
  await verifyTeamMemberCaller();
  const limited = rows.slice(0, 500);
  const adminClient = createAdminClient();
  const teamMap = await getTeamMap(adminClient);

  const [existingProspectsRes, existingSocialsRes, existingContactsRes, dncRes] = await Promise.all([
    adminClient.from('prospects').select('id, full_name, email, email_normalized, status, added_by, created_at'),
    adminClient.from('prospect_socials').select('platform, handle_normalized, prospect_id, prospects:prospect_id(full_name, status, added_by, created_at)'),
    adminClient.from('contacts').select('id, name, email, status, owner_user_id, created_at'),
    adminClient.from('do_not_contact').select('type, value, reason'),
  ]);

  const emailToProspect = new Map<string, any>();
  for (const p of existingProspectsRes.data || []) {
    if (p.email_normalized) emailToProspect.set(p.email_normalized, p);
  }

  const socialKeyToRecord = new Map<string, any>();
  for (const s of existingSocialsRes.data || []) {
    socialKeyToRecord.set(`${s.platform}:${s.handle_normalized}`, s);
  }

  const emailToContact = new Map<string, any>();
  for (const c of existingContactsRes.data || []) {
    const norm = normalizeEmail(c.email);
    if (norm) emailToContact.set(norm, c);
  }

  const dncValues = new Map<string, string>();
  for (const d of dncRes.data || []) {
    dncValues.set(d.value.toLowerCase(), d.reason || 'Do Not Contact');
  }

  const batchSeenEmails = new Map<string, number>();
  const batchSeenSocials = new Map<string, number>();

  const results: BulkPreviewRowResult[] = [];
  let newCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const row of limited) {
    if (!row.isValid) {
      invalidCount++;
      results.push({
        ...row,
        ImportStatus: 'invalid',
        duplicateReason: row.invalidReason || 'Invalid row',
      });
      continue;
    }

    let dupReason: string | undefined;

    // 1. DNC check
    if (row.email) {
      const domain = row.email.split('@')[1] || '';
      if (dncValues.has(row.email) || (row.emailNormalized && dncValues.has(row.emailNormalized)) || dncValues.has(domain)) {
        dupReason = `On Do Not Contact list (${dncValues.get(row.email) || dncValues.get(domain)})`;
      }
    }

    // 2. Existing prospect email check
    if (!dupReason && row.emailNormalized && emailToProspect.has(row.emailNormalized)) {
      const p = emailToProspect.get(row.emailNormalized);
      const who = teamMap.get(p.added_by)?.name || 'Teammate';
      dupReason = `Email already added by ${who} on ${formatShortDate(p.created_at)} (status: ${p.status})`;
    }

    // 3. Existing contact email check
    if (!dupReason && row.emailNormalized && emailToContact.has(row.emailNormalized)) {
      const c = emailToContact.get(row.emailNormalized);
      const who = c.owner_user_id ? teamMap.get(c.owner_user_id)?.name || 'Teammate' : 'Team';
      dupReason = `Already in Contacts (${c.name}, handled by ${who}, stage: ${c.status})`;
    }

    // 4. Existing social check
    if (!dupReason) {
      for (const s of row.socials) {
        const key = `${s.platform}:${s.handleNormalized}`;
        if (socialKeyToRecord.has(key)) {
          const rec = socialKeyToRecord.get(key);
          const p = rec.prospects as any;
          const who = p?.added_by ? teamMap.get(p.added_by)?.name || 'Teammate' : 'Teammate';
          dupReason = `${s.platform} @${s.handleNormalized} already added by ${who} on ${formatShortDate(p?.created_at)} (status: ${p?.status || 'new'})`;
          break;
        }
      }
    }

    // 5. Intra-batch duplicate check
    if (!dupReason && row.emailNormalized && batchSeenEmails.has(row.emailNormalized)) {
      dupReason = `Duplicate email within import batch (matches row #${batchSeenEmails.get(row.emailNormalized)})`;
    }
    if (!dupReason) {
      for (const s of row.socials) {
        const key = `${s.platform}:${s.handleNormalized}`;
        if (batchSeenSocials.has(key)) {
          dupReason = `Duplicate ${s.platform} @${s.handleNormalized} within import batch (matches row #${batchSeenSocials.get(key)})`;
          break;
        }
      }
    }

    if (dupReason) {
      duplicateCount++;
      results.push({
        ...row,
        ImportStatus: 'duplicate',
        duplicateReason: dupReason,
      });
    } else {
      newCount++;
      if (row.emailNormalized) batchSeenEmails.set(row.emailNormalized, row.rowNumber);
      for (const s of row.socials) {
        batchSeenSocials.set(`${s.platform}:${s.handleNormalized}`, row.rowNumber);
      }
      results.push({
        ...row,
        ImportStatus: 'new',
      });
    }
  }

  return { results, newCount, duplicateCount, invalidCount };
}

/**
 * Imports only valid, non-duplicate rows from a bulk preview (max 500 rows).
 */
export async function importBulkProspectsAction(params: {
  rows: ParsedProspectRow[];
  assignToUserId?: string | null;
}): Promise<{
  success: boolean;
  importedCount: number;
  skippedDuplicates: number;
  error?: string;
}> {
  const caller = await verifyTeamMemberCaller();
  const preview = await previewBulkProspectsAction(params.rows.slice(0, 500));
  const validNewRows = preview.results.filter(r => r.ImportStatus === 'new');

  if (validNewRows.length === 0) {
    return {
      success: true,
      importedCount: 0,
      skippedDuplicates: preview.duplicateCount,
    };
  }

  const adminClient = createAdminClient();
  let importedCount = 0;
  let skippedDuplicates = preview.duplicateCount;

  for (const row of validNewRows) {
    const socialsSearchText = row.socials
      .map(s => `${s.platform} ${s.handle} ${s.handleNormalized}`)
      .join(' ');

    const { data: inserted, error: insErr } = await adminClient
      .from('prospects')
      .insert({
        full_name: row.fullName,
        company: row.company || '',
        email: row.email,
        email_normalized: row.emailNormalized,
        notes: row.notes || '',
        source: row.source || 'Bulk Import',
        status: params.assignToUserId ? 'assigned' : 'new',
        added_by: caller.id,
        assigned_to: params.assignToUserId || null,
        socials_search_text: socialsSearchText,
      })
      .select('id')
      .single();

    if (insErr || !inserted) {
      skippedDuplicates++;
      continue;
    }

    if (row.socials.length > 0) {
      const { error: socErr } = await adminClient.from('prospect_socials').insert(
        row.socials.map(s => ({
          prospect_id: inserted.id,
          platform: s.platform,
          handle: s.handle,
          handle_normalized: s.handleNormalized,
          profile_url: s.profileUrl,
        }))
      );
      if (socErr) {
        await adminClient.from('prospects').delete().eq('id', inserted.id);
        skippedDuplicates++;
        continue;
      }
    }

    importedCount++;
  }

  await adminClient.from('audit_log').insert({
    user_id: caller.id,
    action: 'prospects.bulk_import',
    metadata: {
      importedCount,
      skippedDuplicates,
      invalidCount: preview.invalidCount,
    },
  });

  return {
    success: true,
    importedCount,
    skippedDuplicates,
  };
}

/**
 * Claims the signed-in user's next unassigned or assigned prospect with an email.
 */
export async function claimNextProspectAction(): Promise<{
  success: boolean;
  prospect?: Prospect;
  error?: string;
}> {
  const caller = await verifyTeamMemberCaller();
  const adminClient = createAdminClient();
  const serverClient = createServerClient();

  let claimedId: string | null = null;

  // Try atomic RPC first
  const { data: rpcId, error: rpcErr } = await serverClient.rpc('claim_next_prospect', {
    p_user_id: caller.id,
  });

  if (!rpcErr && rpcId) {
    claimedId = rpcId as string;
  } else {
    // Fallback query if RPC is not yet created
    const { data: candidates } = await adminClient
      .from('prospects')
      .select('id, assigned_to')
      .not('email', 'is', null)
      .in('status', ['new', 'assigned'])
      .or(`assigned_to.eq.${caller.id},assigned_to.is.null`)
      .order('created_at', { ascending: true })
      .limit(10);

    if (candidates && candidates.length > 0) {
      const preferred =
        candidates.find(c => c.assigned_to === caller.id) || candidates[0];
      claimedId = preferred.id;
      await adminClient
        .from('prospects')
        .update({
          assigned_to: caller.id,
          status: 'assigned',
          updated_at: new Date().toISOString(),
        })
        .eq('id', claimedId);
    }
  }

  if (!claimedId) {
    return {
      success: false,
      error: 'No queued prospects with an email address are currently available.',
    };
  }

  await adminClient.from('audit_log').insert({
    user_id: caller.id,
    action: 'prospects.claim_next',
    target: claimedId,
    metadata: {},
  });

  const { data: row } = await adminClient
    .from('prospects')
    .select('*, prospect_socials(*)')
    .eq('id', claimedId)
    .single();

  if (!row) {
    return { success: false, error: 'Failed to load claimed prospect.' };
  }

  const teamMap = await getTeamMap(adminClient);
  return {
    success: true,
    prospect: mapProspectRow(row, teamMap),
  };
}

/**
 * Look up a prospect by contactId or email so ComposeModal and ContactDetailModal
 * can show the prospect's social profiles and notes in a side panel.
 */
export async function getProspectForContactOrEmailAction(params: {
  prospectId?: string | null;
  contactId?: string | null;
  email?: string | null;
}): Promise<Prospect | null> {
  await verifyTeamMemberCaller();
  const adminClient = createAdminClient();
  const teamMap = await getTeamMap(adminClient);

  if (params.prospectId) {
    const { data } = await adminClient
      .from('prospects')
      .select('*, prospect_socials(*)')
      .eq('id', params.prospectId)
      .maybeSingle();
    if (data) return mapProspectRow(data, teamMap);
  }

  if (params.contactId) {
    const { data } = await adminClient
      .from('prospects')
      .select('*, prospect_socials(*)')
      .eq('contact_id', params.contactId)
      .maybeSingle();
    if (data) return mapProspectRow(data, teamMap);
  }

  const normEmail = normalizeEmail(params.email);
  if (normEmail) {
    const { data } = await adminClient
      .from('prospects')
      .select('*, prospect_socials(*)')
      .eq('email_normalized', normEmail)
      .maybeSingle();
    if (data) return mapProspectRow(data, teamMap);
  }

  return null;
}

/**
 * Fetches prospects queued to contact today for the Today Dashboard.
 */
export async function getTodayProspectQueueAction(): Promise<{
  queuesByUser: Record<string, Prospect[]>;
  unassignedReadyCount: number;
  totalReadyCount: number;
}> {
  await verifyTeamMemberCaller();
  const adminClient = createAdminClient();
  const teamMap = await getTeamMap(adminClient);

  const { data } = await adminClient
    .from('prospects')
    .select('*, prospect_socials(*)')
    .in('status', ['new', 'assigned'])
    .order('created_at', { ascending: true })
    .limit(150);

  const queuesByUser: Record<string, Prospect[]> = {};
  let unassignedReadyCount = 0;
  let totalReadyCount = 0;

  for (const row of data || []) {
    const p = mapProspectRow(row, teamMap);
    if (p.email) {
      totalReadyCount++;
      if (!p.assignedTo) {
        unassignedReadyCount++;
      }
    }
    const key = p.assignedTo || 'unassigned';
    if (!queuesByUser[key]) queuesByUser[key] = [];
    queuesByUser[key].push(p);
  }

  return {
    queuesByUser,
    unassignedReadyCount,
    totalReadyCount,
  };
}
