import { TeammateStatus } from '@/types';

/**
 * Formats a timestamp into a clean relative time (e.g. "Just now", "14 min ago", "2h ago", "yesterday")
 */
export function formatLastSeen(dateString?: string): string {
  if (!dateString) return 'a while ago';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return 'recently';
  }
}

/**
 * Returns the indicator color class for a given teammate status.
 */
export function getStatusDotClass(status: TeammateStatus): string {
  switch (status) {
    case 'online':
      return 'bg-[#30D158] shadow-[0_0_8px_rgba(48,209,88,0.6)]';
    case 'idle':
      return 'bg-[#FF9F0A] shadow-[0_0_8px_rgba(255,159,10,0.6)]';
    case 'offline':
    default:
      return 'bg-white/30';
  }
}

/**
 * Returns human readable status label
 */
export function getStatusLabel(status: TeammateStatus): string {
  switch (status) {
    case 'online':
      return 'Active';
    case 'idle':
      return 'Idle (away)';
    case 'offline':
    default:
      return 'Offline';
  }
}
