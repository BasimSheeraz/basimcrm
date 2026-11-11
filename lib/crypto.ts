import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Returns the 32-byte encryption key from environment.
 * Throws a fatal error if ENCRYPTION_KEY is missing or not 32 bytes (64 hex characters).
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error('Fatal: ENCRYPTION_KEY is missing from environment. Must be a 32-byte hex string (64 characters).');
  }

  const cleanKey = envKey.trim();
  if (cleanKey.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    throw new Error(
      `Fatal: ENCRYPTION_KEY must be exactly 32 bytes represented as a 64-character hexadecimal string. Received ${cleanKey.length} characters.`
    );
  }

  return Buffer.from(cleanKey, 'hex');
}

/**
 * Encrypts a string using AES-256-GCM with authentication tag.
 * Output format: iv:tag:ciphertext (hex)
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 */
export function decryptToken(encryptedData: string): string {
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }
  
  const [ivHex, tagHex, ciphertextHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Hashes a recovery code with SHA-256 for secure storage.
 */
export function hashRecoveryCode(code: string): string {
  return crypto
    .createHash('sha256')
    .update(code.trim().toUpperCase())
    .digest('hex');
}

/**
 * Generates 8 random one-time recovery codes in XXXX-XXXX format.
 */
export function generateRecoveryCodes(): { rawCodes: string[]; hashedCodes: string[] } {
  const rawCodes: string[] = [];
  const hashedCodes: string[] = [];
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32 without ambiguous 0/O, 1/I

  for (let i = 0; i < 8; i++) {
    let part1 = '';
    let part2 = '';
    const bytes = crypto.randomBytes(8);
    for (let j = 0; j < 4; j++) {
      part1 += chars[bytes[j] % chars.length];
      part2 += chars[bytes[j + 4] % chars.length];
    }
    const code = `${part1}-${part2}`;
    rawCodes.push(code);
    hashedCodes.push(hashRecoveryCode(code));
  }

  return { rawCodes, hashedCodes };
}
