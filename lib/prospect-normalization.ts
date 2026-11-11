export type SocialPlatform =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'tiktok'
  | 'x'
  | 'youtube'
  | 'website'
  | 'other';

export type ProspectStatus =
  | 'new'
  | 'assigned'
  | 'contacted'
  | 'replied'
  | 'not_interested'
  | 'bad_email'
  | 'do_not_contact';

export const SOCIAL_PLATFORMS: { value: SocialPlatform; label: string; placeholder: string }[] = [
  { value: 'instagram', label: 'Instagram', placeholder: '@username or instagram.com/username' },
  { value: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/username' },
  { value: 'x', label: 'X (Twitter)', placeholder: '@handle or x.com/handle' },
  { value: 'tiktok', label: 'TikTok', placeholder: '@handle or tiktok.com/@handle' },
  { value: 'facebook', label: 'Facebook', placeholder: 'facebook.com/username' },
  { value: 'youtube', label: 'YouTube', placeholder: '@channel or youtube.com/@channel' },
  { value: 'website', label: 'Website', placeholder: 'https://company.com' },
  { value: 'other', label: 'Other', placeholder: 'handle or profile URL' },
];

export const PROSPECT_STATUSES: { value: ProspectStatus; label: string; badgeClass: string }[] = [
  { value: 'new', label: 'New', badgeClass: 'bg-[#0A84FF]/15 text-[#0A84FF] border-[#0A84FF]/30' },
  { value: 'assigned', label: 'Assigned', badgeClass: 'bg-[#5E5CE6]/20 text-[#8E8CE8] border-[#5E5CE6]/35' },
  { value: 'contacted', label: 'Contacted', badgeClass: 'bg-[#FF9F0A]/15 text-[#FF9F0A] border-[#FF9F0A]/30' },
  { value: 'replied', label: 'Replied', badgeClass: 'bg-[#30D158]/15 text-[#30D158] border-[#30D158]/30' },
  { value: 'not_interested', label: 'Not Interested', badgeClass: 'bg-white/10 text-white/60 border-white/15' },
  { value: 'bad_email', label: 'Bad Email', badgeClass: 'bg-[#FF453A]/15 text-[#FF453A] border-[#FF453A]/30' },
  { value: 'do_not_contact', label: 'Do Not Contact', badgeClass: 'bg-[#FF453A]/20 text-[#FF453A] border-[#FF453A]/40' },
];

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
]);

export function isPublicEmailDomain(domain?: string | null): boolean {
  if (!domain) return true;
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/**
 * Cleans and lowercases the email as stored in `prospects.email`.
 */
export function cleanRawEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return null;
  return trimmed;
}

/**
 * Normalizes an email address for strict duplicate detection (`prospects.email_normalized`).
 * - Lowercases and trims
 * - For Gmail (`gmail.com` / `googlemail.com`), strips dots `.` and any `+tag` from the local part
 *   so `john.doe+x@gmail.com` and `johndoe@gmail.com` resolve to `johndoe@gmail.com`.
 */
export function normalizeEmail(raw?: string | null): string | null {
  const cleaned = cleanRawEmail(raw);
  if (!cleaned) return null;

  const parts = cleaned.split('@');
  if (parts.length !== 2) return null;

  let [localPart, domain] = parts;
  if (!localPart || !domain || !domain.includes('.')) return null;

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    domain = 'gmail.com';
    localPart = localPart.split('+')[0];
    localPart = localPart.replace(/\./g, '');
  }

  if (!localPart) return null;
  return `${localPart}@${domain}`;
}

/**
 * Auto-detects social platform if user pastes a full URL.
 */
export function detectSocialPlatformFromInput(
  rawInput: string,
  fallback: SocialPlatform = 'instagram'
): SocialPlatform {
  const lower = rawInput.trim().toLowerCase();
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) return 'instagram';
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('x.com/') || lower.includes('twitter.com/')) return 'x';
  if (lower.includes('facebook.com') || lower.includes('fb.com')) return 'facebook';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (/^https?:\/\//.test(lower) && !lower.startsWith('@')) return 'website';
  return fallback;
}

/**
 * Normalizes any social handle or full profile URL down to its canonical handle:
 * - Lowercase, trim
 * - Strip query strings (`?...`) and hash fragments (`#...`)
 * - Strip protocol (`https://`, `http://`) and `www.` / `m.` / `mobile.`
 * - Strip platform domain prefixes (`instagram.com/name/` -> `name`)
 * - Strip `@` prefix and trailing slashes `/`
 */
export function normalizeSocialHandle(platform: SocialPlatform, rawInput: string): string {
  if (!rawInput) return '';

  let h = rawInput.trim().toLowerCase();

  // Strip query strings and hash fragments
  h = h.split('?')[0].split('#')[0];

  // Strip protocol
  h = h.replace(/^https?:\/\//i, '');

  // Strip www., m., mobile.
  h = h.replace(/^(www\.|m\.|mobile\.)/i, '');

  // Strip known domain prefixes
  h = h.replace(/^(instagram\.com\/|instagr\.am\/)/i, '');
  h = h.replace(/^(facebook\.com\/|fb\.com\/)/i, '');
  h = h.replace(/^(linkedin\.com\/in\/|linkedin\.com\/company\/|linkedin\.com\/school\/|linkedin\.com\/)/i, '');
  h = h.replace(/^(tiktok\.com\/@|tiktok\.com\/)/i, '');
  h = h.replace(/^(x\.com\/|twitter\.com\/)/i, '');
  h = h.replace(/^(youtube\.com\/@|youtube\.com\/c\/|youtube\.com\/channel\/|youtube\.com\/user\/|youtube\.com\/|youtu\.be\/)/i, '');

  // Strip leading/trailing slashes and whitespace
  h = h.replace(/^[\/\s]+|[\/\s]+$/g, '');

  // Strip leading @
  h = h.replace(/^@+/, '');

  // Strip trailing slashes again
  h = h.replace(/^[\/\s]+|[\/\s]+$/g, '');

  // For social handle platforms, take the first path segment (e.g. instagram.com/name/reels -> name)
  if (
    ['instagram', 'tiktok', 'x', 'facebook', 'linkedin', 'youtube'].includes(platform) &&
    h.includes('/')
  ) {
    h = h.split('/')[0];
  }

  h = h.replace(/^@+/, '').replace(/\/+$/, '').trim();
  return h;
}

/**
 * Builds a safe, clickable profile URL (`https://...`) for opening in a new tab.
 */
export function buildSocialProfileUrl(
  platform: SocialPlatform,
  handleNormalized: string,
  rawInput?: string
): string {
  const cleanHandle = handleNormalized || normalizeSocialHandle(platform, rawInput || '');
  if (!cleanHandle) return 'https://';

  switch (platform) {
    case 'instagram':
      return `https://www.instagram.com/${encodeURIComponent(cleanHandle)}`;
    case 'facebook':
      return `https://www.facebook.com/${encodeURIComponent(cleanHandle)}`;
    case 'linkedin':
      return `https://www.linkedin.com/in/${encodeURIComponent(cleanHandle)}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${encodeURIComponent(cleanHandle)}`;
    case 'x':
      return `https://x.com/${encodeURIComponent(cleanHandle)}`;
    case 'youtube':
      return `https://www.youtube.com/@${encodeURIComponent(cleanHandle)}`;
    case 'website': {
      const cleaned = cleanHandle.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      return `https://${cleaned}`;
    }
    case 'other':
    default: {
      if (rawInput && /^https?:\/\//i.test(rawInput.trim())) {
        return rawInput.trim();
      }
      if (cleanHandle.includes('.') && !cleanHandle.includes(' ')) {
        return `https://${cleanHandle}`;
      }
      return `https://www.google.com/search?q=${encodeURIComponent(cleanHandle)}`;
    }
  }
}

/**
 * Dice coefficient bigram similarity between two strings (0 to 1) for fuzzy duplicate warning.
 */
export function calculateStringSimilarity(a?: string | null, b?: string | null): number {
  const s1 = (a || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const s2 = (b || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const bigrams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bg = s1.slice(i, i + 2);
    bigrams1.set(bg, (bigrams1.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bg = s2.slice(i, i + 2);
    const count = bigrams1.get(bg) || 0;
    if (count > 0) {
      bigrams1.set(bg, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / (s1.length + s2.length - 2);
}

/**
 * Escapes CSV cell values and blocks CSV Formula Injection (=, +, -, @, \t, \r).
 */
export function sanitizeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let str = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Defend against CSV Formula Injection
  if (/^[=+\-@\t\r]/.test(str.trimStart())) {
    str = `'${str}`;
  }

  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export interface ParsedProspectRow {
  rowNumber: number;
  rawLine: string;
  fullName: string;
  company: string;
  email: string | null;
  emailNormalized: string | null;
  socials: {
    platform: SocialPlatform;
    handle: string;
    handleNormalized: string;
    profileUrl: string;
  }[];
  source: string;
  notes: string;
  isValid: boolean;
  invalidReason?: string;
}

/**
 * Parses a pasted multi-line string or CSV text (up to 500 rows).
 * Supports flexible column orders (Name, Social URL/@handle, Email, Company in any order).
 */
export function parseBulkProspectInput(rawText: string): ParsedProspectRow[] {
  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) return [];

  // Detect if first line is a CSV header
  const firstLower = lines[0].toLowerCase();
  const hasHeader =
    firstLower.includes('name') &&
    (firstLower.includes('email') ||
      firstLower.includes('instagram') ||
      firstLower.includes('social') ||
      firstLower.includes('handle') ||
      firstLower.includes('company'));

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const limitedLines = dataLines.slice(0, 500);

  return limitedLines.map((line, idx) => {
    const rowNumber = idx + 1;
    // Split by comma, tab, or pipe (respecting simple quotes)
    const tokens = splitCsvLine(line)
      .map(t => t.trim())
      .filter(Boolean);

    let email: string | null = null;
    const socials: ParsedProspectRow['socials'] = [];
    const textTokens: string[] = [];

    for (const token of tokens) {
      // 1. Check if token is an email
      const emailMatch = token.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      if (emailMatch && !email) {
        email = cleanRawEmail(token);
        continue;
      }

      // 2. Check if token looks like a social URL or @handle
      const lower = token.toLowerCase();
      const isSocialUrl =
        lower.includes('instagram.com') ||
        lower.includes('instagr.am') ||
        lower.includes('linkedin.com') ||
        lower.includes('tiktok.com') ||
        lower.includes('x.com/') ||
        lower.includes('twitter.com/') ||
        lower.includes('facebook.com') ||
        lower.includes('fb.com') ||
        lower.includes('youtube.com') ||
        lower.includes('youtu.be') ||
        /^https?:\/\//.test(lower);

      const isAtHandle = token.startsWith('@') && token.length > 1 && !token.includes(' ');

      if (isSocialUrl || isAtHandle) {
        const platform = detectSocialPlatformFromInput(token, 'instagram');
        const handleNormalized = normalizeSocialHandle(platform, token);
        if (handleNormalized) {
          socials.push({
            platform,
            handle: token.slice(0, 500),
            handleNormalized,
            profileUrl: buildSocialProfileUrl(platform, handleNormalized, token),
          });
          continue;
        }
      }

      textTokens.push(token);
    }

    // If no tokens had @ or URL, but there are 3+ tokens and one looks like a plain handle
    let fullName = textTokens[0] || '';
    let company = textTokens[1] || '';
    let notes = textTokens.slice(2).join(' | ');

    // Fallback: if no name was provided, derive display name from handle or email local part
    if (!fullName && socials.length > 0) {
      fullName = socials[0].handleNormalized;
    } else if (!fullName && email) {
      fullName = email.split('@')[0];
    }

    const emailNormalized = normalizeEmail(email);
    const hasContactMethod = Boolean(emailNormalized || socials.length > 0);
    const isValid = Boolean(fullName.trim().length > 0 && hasContactMethod);

    let invalidReason: string | undefined;
    if (!fullName.trim()) {
      invalidReason = 'Missing prospect name';
    } else if (!hasContactMethod) {
      invalidReason = 'Requires at least an email or a social handle/URL';
    } else if (email && !emailNormalized) {
      invalidReason = `Invalid email format: ${email}`;
    }

    const source =
      socials.length > 0
        ? socials[0].platform.charAt(0).toUpperCase() + socials[0].platform.slice(1)
        : 'CSV / Bulk Import';

    return {
      rowNumber,
      rawLine: line,
      fullName: fullName.slice(0, 200),
      company: company.slice(0, 200),
      email,
      emailNormalized,
      socials,
      source,
      notes: notes.slice(0, 2000),
      isValid,
      invalidReason,
    };
  });
}

function splitCsvLine(line: string): string[] {
  const delimiter = line.includes('\t') ? '\t' : ',';
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
