import { DeliverabilityWarning, SpamRiskLevel } from '@/types';

export const DEFAULT_OPT_OUT_SENTENCE = "If this isn't relevant, just reply 'no' and I won't email again.";

/**
 * Calculates current warm-up daily cap based on weeks since warm-up began.
 * Week 1: 5/day
 * Week 2: 10/day
 * Week 3: 15/day
 * Week 4+: 20/day
 * Hard ceiling: 30/day
 */
export function calculateWarmupDailyCap(
  warmupStartedAt: string, 
  userCap: number = 5, 
  override: boolean = false
): { allowedCap: number; weekNumber: number; daysActive: number } {
  const started = new Date(warmupStartedAt).getTime();
  const now = Date.now();
  const diffDays = Math.max(0, Math.floor((now - started) / (1000 * 60 * 60 * 24)));
  const weekNumber = Math.floor(diffDays / 7) + 1;

  let scheduleCap = 5;
  if (weekNumber === 2) scheduleCap = 10;
  else if (weekNumber === 3) scheduleCap = 15;
  else if (weekNumber >= 4) scheduleCap = 20;

  const hardCap = Math.min(30, Math.max(1, userCap));

  if (override) {
    return { allowedCap: hardCap, weekNumber, daysActive: diffDays };
  }

  return {
    allowedCap: Math.min(scheduleCap, hardCap),
    weekNumber,
    daysActive: diffDays
  };
}

/**
 * Returns current date and time in Pakistan Standard Time (PKT, UTC+5).
 */
export function getPktTime(): { dateStr: string; hour: number; minute: number; isBusinessHours: boolean; isWeekend: boolean } {
  const now = new Date();
  const pktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
  const hour = pktDate.getHours();
  const minute = pktDate.getMinutes();
  const day = pktDate.getDay(); // 0 is Sunday, 6 is Saturday

  const isWeekend = day === 0 || day === 6;
  const isBusinessHours = !isWeekend && hour >= 9 && hour < 18;
  const dateStr = pktDate.toISOString().split('T')[0];

  return { dateStr, hour, minute, isBusinessHours, isWeekend };
}

/**
 * Computes next scheduled send time respecting business hours and a random 60-180s gap.
 */
export function calculateNextScheduledSendTime(lastQueuedAt?: string): Date {
  const baseTime = lastQueuedAt ? new Date(lastQueuedAt) : new Date();
  // Random delay between 60 and 180 seconds
  const randomDelaySeconds = Math.floor(Math.random() * (180 - 60 + 1)) + 60;
  const nextTarget = new Date(Math.max(Date.now(), baseTime.getTime()) + (randomDelaySeconds * 1000));

  // Check PKT business hours
  const pkt = new Date(nextTarget.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
  const hour = pkt.getHours();
  const day = pkt.getDay();

  if (day === 0) {
    // Sunday: jump to Monday 9:00 AM PKT
    nextTarget.setDate(nextTarget.getDate() + 1);
    nextTarget.setHours(9, 0, 0, 0);
  } else if (day === 6) {
    // Saturday: jump to Monday 9:00 AM PKT
    nextTarget.setDate(nextTarget.getDate() + 2);
    nextTarget.setHours(9, 0, 0, 0);
  } else if (hour < 9) {
    // Forward to 9:00 AM PKT today
    const waitHours = 9 - hour;
    nextTarget.setTime(nextTarget.getTime() + waitHours * 60 * 60 * 1000);
  } else if (hour >= 18) {
    // Forward to 9:00 AM PKT tomorrow (or Monday if Friday)
    const daysToAdd = day === 5 ? 3 : 1;
    const hoursTillMidnight = 24 - hour;
    nextTarget.setTime(nextTarget.getTime() + (hoursTillMidnight + 9) * 60 * 60 * 1000 + (daysToAdd - 1) * 24 * 60 * 60 * 1000);
  }

  return nextTarget;
}

/**
 * Checks for common domain typos in email addresses.
 */
export function detectDomainTypo(email: string): string | null {
  if (!email || !email.includes('@')) return null;
  const domain = email.split('@')[1].toLowerCase().trim();

  const typoMap: Record<string, string> = {
    'gmial.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmail.con': 'gmail.com',
    'gmaill.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'gmail.co': 'gmail.com',
    'yaho.com': 'yahoo.com',
    'yahooo.com': 'yahoo.com',
    'yaho.co': 'yahoo.com',
    'hotmial.com': 'hotmail.com',
    'hotmai.com': 'hotmail.com',
    'outlok.com': 'outlook.com',
    'outloo.com': 'outlook.com',
    'iclou.com': 'icloud.com',
  };

  return typoMap[domain] || null;
}

/**
 * Detects if an email address is a generic role account.
 */
export function isRoleAddress(email: string): boolean {
  if (!email || !email.includes('@')) return false;
  const localPart = email.split('@')[0].toLowerCase().trim();
  const rolePrefixes = [
    'info', 'support', 'admin', 'sales', 'noreply', 'no-reply', 
    'help', 'billing', 'contact', 'team', 'office', 'marketing', 
    'jobs', 'hr', 'inquiries', 'general'
  ];
  return rolePrefixes.includes(localPart);
}

/**
 * Detects unresolved placeholder variables like {{first_name}} or {{company}}.
 */
export function findUnresolvedVariables(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [];
  return Array.from(new Set(matches));
}

/**
 * Calculates similarity between two strings using token-based Jaccard Index (0 to 1).
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  const tokenize = (s: string) => new Set(
    s.toLowerCase()
     .replace(/[^\w\s]/g, ' ')
     .split(/\s+/)
     .filter(w => w.length > 2)
  );

  const setA = tokenize(text1);
  const setB = tokenize(text2);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  setA.forEach(token => {
    if (setB.has(token)) intersection++;
  });

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Comprehensive spam risk evaluation returning score (0-100), level, and granular reasons.
 */
export function calculateSpamRisk(params: {
  subject: string;
  body: string;
  hasAttachments: boolean;
  isFirstEmail: boolean;
}): { level: SpamRiskLevel; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const unresolvedVars = [
    ...findUnresolvedVariables(params.subject),
    ...findUnresolvedVariables(params.body)
  ];
  if (unresolvedVars.length > 0) {
    score += 50;
    reasons.push(`Unresolved template variables: ${unresolvedVars.join(', ')}`);
  }

  // Links check
  const linkMatches = params.body.match(/https?:\/\/[^\s]+/gi) || [];
  if (linkMatches.length > 2) {
    score += 35;
    reasons.push(`Contains ${linkMatches.length} links (maximum 1 recommended on cold outreach)`);
  } else if (linkMatches.length > 1) {
    score += 15;
    reasons.push('Contains multiple links');
  }

  // Attachments on first email
  if (params.hasAttachments && params.isFirstEmail) {
    score += 40;
    reasons.push('Attachments on first cold email trigger spam filters');
  }

  // Subject checks
  const lowerSubject = (params.subject || '').toLowerCase().trim();
  const subjectWords = lowerSubject.split(/\s+/).filter(Boolean);

  if (params.isFirstEmail && (lowerSubject.startsWith('re:') || lowerSubject.startsWith('fwd:'))) {
    score += 35;
    reasons.push('Using fake "Re:" or "Fwd:" prefixes on initial outreach');
  }

  if (subjectWords.length > 0 && (subjectWords.length < 3 || subjectWords.length > 8)) {
    score += 10;
    reasons.push(`Subject length (${subjectWords.length} words) outside recommended 3-8 word range`);
  }

  const spamWords = [
    'free', 'urgent', 'guarantee', 'guaranteed', 'buy now', 'act now', 
    'risk free', 'click here', 'congratulations', '100%', 'winner', 
    'no cost', 'exclusive deal', 'double your', 'earn cash', 'cash prize',
    'limited time', 'make money', 'secret'
  ];

  const matchedWords = spamWords.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(lowerSubject));
  if (matchedWords.length > 0) {
    score += 25;
    reasons.push(`Spam keywords in subject ("${matchedWords.slice(0, 2).join('", "')}")`);
  }

  if (/[!?]{2,}/.test(params.subject) || /\${2,}/.test(params.subject)) {
    score += 20;
    reasons.push('Excessive punctuation (!!!, ???, $$$) in subject');
  }

  const rawSubjectWords = params.subject.split(/\s+/).filter(w => w.length > 3);
  if (rawSubjectWords.some(w => w === w.toUpperCase() && /^[A-Z]+$/.test(w))) {
    score += 20;
    reasons.push('ALL-CAPS words in subject');
  }

  // Body word count
  const bodyWords = (params.body || '').trim().split(/\s+/).filter(Boolean);
  if (params.isFirstEmail) {
    if (bodyWords.length < 20) {
      score += 15;
      reasons.push(`Body too short (${bodyWords.length} words, minimum 20 recommended)`);
    } else if (bodyWords.length > 200) {
      score += 20;
      reasons.push(`Body too long (${bodyWords.length} words, max 200 recommended for cold emails)`);
    }
  }

  const clampedScore = Math.min(100, score);
  let level: SpamRiskLevel = 'low';
  if (clampedScore >= 50) level = 'high';
  else if (clampedScore >= 20) level = 'medium';

  return { level, score: clampedScore, reasons };
}

/**
 * Checks email content for deliverability risks (warnings and blocking conditions).
 */
export function lintEmailDeliverability(params: {
  subject: string;
  body: string;
  hasAttachments: boolean;
  isFirstEmail: boolean;
}): DeliverabilityWarning[] {
  const warnings: DeliverabilityWarning[] = [];

  // 1. Unresolved variables (BLOCKING)
  const unresolved = [
    ...findUnresolvedVariables(params.subject),
    ...findUnresolvedVariables(params.body)
  ];
  if (unresolved.length > 0) {
    warnings.push({
      type: 'unresolved_variables',
      message: `Unresolved variables: ${unresolved.join(', ')}. Please replace with real prospect information.`,
      severity: 'blocking'
    });
  }

  // 2. Link count
  const linkMatches = params.body.match(/https?:\/\/[^\s]+/gi) || [];
  if (linkMatches.length > 2) {
    warnings.push({
      type: 'link_count',
      message: `Contains ${linkMatches.length} links. Blocked on cold outreach (max 1 link recommended, max 2 allowed).`,
      severity: 'blocking'
    });
  } else if (linkMatches.length > 1) {
    warnings.push({
      type: 'link_count',
      message: `Contains 2 links. Free Gmail accounts get much higher inbox placement with at most 1 link.`,
      severity: 'warning'
    });
  }

  // 3. Attachments on first outreach (BLOCKING)
  if (params.hasAttachments && params.isFirstEmail) {
    warnings.push({
      type: 'first_email_attachment',
      message: 'Sending attachments on your first outreach email is blocked. Send plain text first and share the file upon reply.',
      severity: 'blocking'
    });
  }

  // 4. Fake "Re:" / "Fwd:" on first email (BLOCKING)
  const lowerSubject = params.subject.toLowerCase().trim();
  if (params.isFirstEmail && (lowerSubject.startsWith('re:') || lowerSubject.startsWith('fwd:'))) {
    warnings.push({
      type: 'subject_trick',
      message: 'Deceptive "Re:" or "Fwd:" prefixes on first touch trigger immediate spam filtering.',
      severity: 'blocking'
    });
  }

  // 5. Subject words & symbols
  const spamWords = [
    'free', 'urgent', 'guarantee', 'guaranteed', 'buy now', 'act now', 
    'risk free', 'click here', 'congratulations', '100%', 'winner', 
    'no cost', 'exclusive deal', 'double your', 'earn cash', 'make money'
  ];

  const matchedWords = spamWords.filter(word => new RegExp(`\\b${word}\\b`, 'i').test(lowerSubject));
  const hasExcessivePunctuation = /[!?]{2,}/.test(params.subject) || /\${2,}/.test(params.subject);
  const words = params.subject.split(/\s+/).filter(w => w.length > 3);
  const hasAllCapsWord = words.some(w => w === w.toUpperCase() && /^[A-Z]+$/.test(w));

  if (matchedWords.length > 0 || hasExcessivePunctuation || hasAllCapsWord) {
    const reasons: string[] = [];
    if (matchedWords.length > 0) reasons.push(`keyword "${matchedWords[0]}"`);
    if (hasExcessivePunctuation) reasons.push('repeated punctuation (!!!, ???, $$$)');
    if (hasAllCapsWord) reasons.push('ALL-CAPS words');

    warnings.push({
      type: 'spam_words',
      message: `Subject contains spam triggers (${reasons.join(', ')}). A conversational, lowercase subject gets higher open rates.`,
      severity: 'warning'
    });
  }

  // 6. Body word count
  const bodyWords = (params.body || '').trim().split(/\s+/).filter(Boolean);
  if (params.isFirstEmail) {
    if (bodyWords.length < 20) {
      warnings.push({
        type: 'body_word_count',
        message: `Body is short (${bodyWords.length} words). Emails with at least 20 words avoid looking like spam probes.`,
        severity: 'warning'
      });
    } else if (bodyWords.length > 200) {
      warnings.push({
        type: 'body_word_count',
        message: `Body is long (${bodyWords.length} words). Short emails (under 150 words) get 2.3x more replies.`,
        severity: 'warning'
      });
    }
  }

  return warnings;
}

/**
 * Scans email text for clear opt-out phrases
 */
export function isOptOutMessage(bodyText: string): boolean {
  const optOutPhrases = [
    'stop',
    'unsubscribe',
    'remove me',
    'please remove',
    'not interested',
    'take me off',
    'take us off',
    'do not email',
    'don\'t email',
    'leave me alone',
    'no thanks',
    'not looking',
    'no'
  ];

  const lower = bodyText.toLowerCase().trim();
  // Exact match for short replies like "no" or "stop"
  if (lower === 'no' || lower === 'stop' || lower === 'unsubscribe') return true;

  return optOutPhrases.some(phrase => {
    const regex = new RegExp(`\\b${phrase}\\b`, 'i');
    return regex.test(lower);
  });
}

/**
 * Detects if a message is a delivery bounce
 */
export function isBounceMessage(fromEmail: string, subject: string): boolean {
  const bounceSenders = ['mailer-daemon', 'postmaster', 'mail-daemon'];
  const lowerFrom = (fromEmail || '').toLowerCase();
  const lowerSubject = (subject || '').toLowerCase();

  const isSenderBounce = bounceSenders.some(s => lowerFrom.includes(s));
  const isSubjectBounce = 
    lowerSubject.includes('delivery status notification') ||
    lowerSubject.includes('undeliverable') ||
    lowerSubject.includes('failure notice') ||
    lowerSubject.includes('returned mail') ||
    lowerSubject.includes('mail delivery failed') ||
    lowerSubject.includes('address not found') ||
    lowerSubject.includes('550');

  return isSenderBounce || isSubjectBounce;
}

/**
 * Detects if a message is an automated out-of-office or auto-reply
 */
export function isAutoReplyMessage(headers: Record<string, string>, subject: string): boolean {
  const lowerSubject = (subject || '').toLowerCase();
  if (
    lowerSubject.startsWith('out of office:') ||
    lowerSubject.startsWith('automatic reply:') ||
    lowerSubject.startsWith('away from office:') ||
    lowerSubject.startsWith('auto-reply:')
  ) {
    return true;
  }

  if (headers['auto-submitted'] && headers['auto-submitted'].toLowerCase().includes('auto-replied')) {
    return true;
  }

  if (headers['x-autoreply'] && headers['x-autoreply'].toLowerCase() === 'yes') {
    return true;
  }

  return false;
}
