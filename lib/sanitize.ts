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
 * Sanitizes HTML content from inbound email messages.
 * Removes scripts, object/embed/iframe tags, dangerous event handlers, and data/javascript URIs.
 * Uses lightweight server-side sanitization to avoid heavy JSDOM initialization overhead on serverless.
 */
export function sanitizeEmailHtml(rawHtml: string): string {
  if (!rawHtml) return '';

  // Fast, safe regex sanitization for server environments
  let sanitized = rawHtml
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove script tags and contents
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove style tags and contents
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Remove iframe, frame, object, embed, form, input tags and contents
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<frame\b[^<]*(?:(?!<\/frame>)<[^<]*)*<\/frame>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    // Strip self-closing or unclosed risky elements
    .replace(/<\/?(script|style|iframe|frame|object|embed|form|input|applet|meta|link)\b[^>]*>/gi, '')
    // Strip inline JavaScript event handlers (e.g. onload, onclick, onerror)
    .replace(/\s+on[a-zA-Z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
    // Neutralize dangerous javascript: or data: URLs in href and src
    .replace(/\b(href|src)\s*=\s*(['"])\s*(?:javascript|data|vbscript):.*?\2/gi, '$1="#"')
    .replace(/\b(href|src)\s*=\s*(?:javascript|data|vbscript):[^\s>]+/gi, '$1="#"');

  return sanitized;
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
