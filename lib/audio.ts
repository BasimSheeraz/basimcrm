/**
 * Web Audio API synthesized notification sound.
 * Plays a calm, pleasant Apple-like chime without requiring external MP3 assets.
 */
export function playNotificationSound() {
  if (typeof window === 'undefined') return;

  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Harmonic dual tone (pleasant glassy bell)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now); // A5
    osc1.frequency.exponentialRampToValueAtTime(1318.51, now + 0.12); // E6

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1046.5, now); // C6
    osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.15); // A6

    // Envelope
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.15, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.55);
    osc2.stop(now + 0.55);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 800);
  } catch (err) {
    console.warn('AudioContext playback error:', err);
  }
}

/**
 * Requests browser notification permission when user clicks enable.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  const result = await Notification.requestPermission();
  return result;
}

/**
 * Triggers a browser desktop notification if permission is granted.
 */
export function showDesktopNotification(title: string, body: string, onClick?: () => void) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    try {
      const n = new Notification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'inbound-email'
      });

      if (onClick) {
        n.onclick = () => {
          window.focus();
          onClick();
          n.close();
        };
      }
    } catch (err) {
      console.warn('Notification display failed:', err);
    }
  }
}
