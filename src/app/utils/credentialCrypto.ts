// ============================================
// AES-256-GCM encryption for sensitive credentials (cPanel passwords)
// ============================================

import crypto from 'crypto';
import config from '../config';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const PREFIX = 'enc:v1:';

const getKey = (): Buffer => {
  const secret = config.cpanel_credentials_secret || config.jwt_access_secret;
  if (!secret) {
    throw new Error('CPANEL_CREDENTIALS_SECRET (or JWT_ACCESS_SECRET) is not configured.');
  }
  // Derive a stable 32-byte key from the secret string
  return crypto.createHash('sha256').update(String(secret)).digest();
};

/** Encrypt plaintext → `enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>` */
export const encryptCredential = (plaintext: string): string => {
  if (!plaintext) return plaintext;
  // Already encrypted — leave as-is
  if (plaintext.startsWith(PREFIX)) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX.slice(0, -1), // "enc:v1"
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
};

/** Decrypt ciphertext produced by encryptCredential. Passes through plaintext if not encrypted. */
export const decryptCredential = (ciphertext: string): string => {
  if (!ciphertext) return ciphertext;
  if (!ciphertext.startsWith(PREFIX)) return ciphertext;

  const parts = ciphertext.split(':');
  // enc:v1:iv:tag:data  → ['enc','v1',iv,tag,data]
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Invalid encrypted credential format.');
  }

  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const data = Buffer.from(parts[4], 'base64url');

  if (iv.length !== IV_LEN || tag.length !== AUTH_TAG_LEN) {
    throw new Error('Invalid encrypted credential metadata.');
  }

  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
};

/** Whether a stored value looks like an encrypted credential. */
export const isEncryptedCredential = (value?: string | null): boolean =>
  Boolean(value && value.startsWith(PREFIX));
