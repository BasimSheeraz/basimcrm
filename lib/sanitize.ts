import DOMPurify from 'isomorphic-dompurify';

/**
 * List of executable extensions strictly blocked from preview or direct opening.
 */
export const BLOCKED_EXECUTABLE_EXTENSIONS = [
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.vbs',
  '.msi',
  '.dll',
  '.com',
  '.scr',
  '.jar',
  '.pif',
  '.app',
  '.cpl',
  '.gadget',
  '.hta',
  '.wsf'
];

/**
 * Checks whether a filename represents an executable file.
 */
export function isExecutableBlocked(filename: string): boolean {
  if (!filename) return false;
  const lower = filename.trim().toLowerCase();
  return BLOCKED_EXECUTABLE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Sanitizes HTML content from inbound email messages using DOMPurify.
 * Removes scripts, object/embed/iframe tags, dangerous event handlers, and data/javascript URIs.
 */
export function sanitizeEmailHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'a', 'b', 'blockquote', 'br', 'caption', 'code', 'div', 'em', 'h1', 'h2', 'h3',
      'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span',
      'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'target', 'alt', 'src', 'width', 'height', 'style', 'class', 'align', 'border'
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'frame', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
  });
}

/**
 * Validates file attachments for outbound sends:
 * Max 10 MB total, blocks executables.
 */
export function validateAttachments(attachments: { name: string; size: number }[]): { valid: boolean; error?: string } {
  if (!attachments || attachments.length === 0) return { valid: true };

  let totalSize = 0;
  for (const att of attachments) {
    if (isExecutableBlocked(att.name)) {
      return {
        valid: false,
        error: `Executable files (${att.name}) are blocked for security.`
      };
    }
    totalSize += att.size;
  }

  const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB
  if (totalSize > MAX_TOTAL_BYTES) {
    const sizeMb = (totalSize / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Total attachment size (${sizeMb} MB) exceeds the 10 MB limit.`
    };
  }

  return { valid: true };
}
