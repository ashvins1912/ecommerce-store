import crypto from 'node:crypto';

const VERSION = 'v1';

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY?.trim();
  if (!raw) throw new Error('ENCRYPTION_MASTER_KEY must be configured before storing sensitive data.');
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes (base64 or 64-char hex).');
  return key;
}

export function encryptField(plaintext: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptField(payload: string): string {
  const [version, ivPart, tagPart, ciphertextPart] = String(payload || '').split('.');
  if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Unsupported or malformed encrypted field.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function blindIndex(value: string): string {
  const key = masterKey();
  return crypto.createHmac('sha256', key).update(value.trim().toLowerCase()).digest('hex');
}

export function maskSecret(value: string): string {
  return value.length <= 4 ? '••••' : `••••••••${value.slice(-4)}`;
}
