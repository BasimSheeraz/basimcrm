import { DeliverabilityWarning } from '@/types';

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
export function getPktTime(): { dateStr: string; hour: number; minute: number; isBusinessHours: boolean } {
  const now = new Date();
  // PKT is UTC+5
  const pktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
  const hour = pktDate.getHours();
  const minute = pktDate.getMinutes();

  // Business hours: 9:00 AM to 6:00 PM (18:00)
  const isBusinessHours = hour >= 9 && hour < 18;
  const dateStr = pktDate.toISOString().split('T')[0];

  return { dateStr, hour, minute, isBusinessHours };
}

/**
 * Computes next scheduled send time respecting business hours and random 45-120s delay.
 */
export function calculateNextScheduledSendTime(lastQueuedAt?: string): Date {
  const baseTime = lastQueuedAt ? new Date(lastQueuedAt) : new Date();
  // Random delay between 45 and 120 seconds
  const randomDelaySeconds = Math.floor(Math.random() * (120 - 45 + 1)) + 45;
  const nextTarget = new Date(Math.max(Date.now(), baseTime.getTime()) + (randomDelaySeconds * 1000));

  // Check PKT business hours
  const pkt = new Date(nextTarget.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
  const hour = pkt.getHours();

  if (hour < 9) {
    // Forward to 9:00 AM PKT today
    const waitHours = 9 - hour;
    nextTarget.setTime(nextTarget.getTime() + waitHours * 60 * 60 * 1000);
  } else if (hour >= 18) {
    // Forward to 9:00 AM PKT tomorrow
    const hoursTillMidnight = 24 - hour;
    nextTarget.setTime(nextTarget.getTime() + (hoursTillMidnight + 9) * 60 * 60 * 1000);
  }

  return nextTarget;
}

/**
 * Checks email content for deliverability risks:
 * 1. More than 2 links (recommends max 1)
 * 2. Attachments on first cold email
 * 3. Spam trigger words or symbols in subject
 */
export function lintEmailDeliverability(params: {
  subject: string;
  body: string;
  hasAttachments: boolean;
  isFirstEmail: boolean;
}): DeliverabilityWarning[] {
  const warnings: DeliverabilityWarning[] = [];

  // 1. Link count
  const linkMatches = params.body.match(/https?:\/\/[^\s]+/gi) || [];
  if (linkMatches.length > 2) {
    warnings.push({
      type: 'link_count',
      message: `Contains ${linkMatches.length} links. Free Gmail accounts have better inbox delivery with at most 1 link.`
    });
  }

  // 2. Attachments on first outreach
  if (params.hasAttachments && params.isFirstEmail) {
    warnings.push({
      type: 'first_email_attachment',
      message: 'Sending attachments on your first outreach email can trigger spam filters. Consider sending text first and offering the file upon reply.'
    });
  }

  // 3. Spam words in subject
  const spamWords = [
    'free', 'urgent', 'guarantee', 'guaranteed', 'buy now', 'act now', 
    'risk free', 'click here', 'congratulations', '100%', 'winner', 
    'no cost', 'exclusive deal', 'double your', 'earn cash'
  ];

  const lowerSubject = params.subject.toLowerCase();
  const matchedWords = spamWords.filter(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    return regex.test(lowerSubject);
  });

  const hasExcessivePunctuation = /[!?]{2,}/.test(params.subject) || /\${2,}/.test(params.subject);
  const words = params.subject.split(/\s+/).filter(w => w.length > 3);
  const hasAllCapsWord = words.some(w => w === w.toUpperCase() && /^[A-Z]+$/.test(w));

  if (matchedWords.length > 0 || hasExcessivePunctuation || hasAllCapsWord) {
    const reasons: string[] = [];
    if (matchedWords.length > 0) reasons.push(`keywords like "${matchedWords[0]}"`);
    if (hasExcessivePunctuation) reasons.push('repeated punctuation (!!!, ???)');
    if (hasAllCapsWord) reasons.push('ALL-CAPS words');

    warnings.push({
      type: 'spam_words',
      message: `Subject line contains spam triggers (${reasons.join(', ')}). A conversational, lowercase subject gets higher open rates.`
    });
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
    'not looking'
  ];

  const lower = bodyText.toLowerCase();
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
  const lowerFrom = fromEmail.toLowerCase();
  const lowerSubject = subject.toLowerCase();

  const isSenderBounce = bounceSenders.some(s => lowerFrom.includes(s));
  const isSubjectBounce = 
    lowerSubject.includes('delivery status notification') ||
    lowerSubject.includes('undeliverable') ||
    lowerSubject.includes('failure notice') ||
    lowerSubject.includes('returned mail') ||
    lowerSubject.includes('mail delivery failed');

  return isSenderBounce || isSubjectBounce;
}

/**
 * Detects if a message is an automated out-of-office or auto-reply
 */
export function isAutoReplyMessage(headers: Record<string, string>, subject: string): boolean {
  const lowerSubject = subject.toLowerCase();
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
