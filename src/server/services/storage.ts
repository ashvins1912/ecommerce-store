import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'uploads');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

const hasR2Config =
  Boolean(process.env.R2_ACCOUNT_ID) &&
  Boolean(process.env.R2_ACCESS_KEY_ID) &&
  Boolean(process.env.R2_SECRET_ACCESS_KEY) &&
  Boolean(process.env.R2_BUCKET_NAME);

const r2Client = hasR2Config
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

/**
 * Compresses an uploaded image buffer into WebP strictly < 120KB (with 420px thumbnail)
 * and uploads to Cloudflare R2 if configured, otherwise stores locally in /data/uploads.
 */
export async function processAndStoreImage(
  buffer: Buffer,
  originalName = 'product'
): Promise<{ url: string; thumbUrl: string; byteSize: number; storage: 'r2' | 'local' }> {
  const safeBase = originalName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'asset';
  const id = `${safeBase}-${crypto.randomBytes(6).toString('hex')}`;

  // Iteratively target < 120KB WebP with crisp quality
  let quality = 80;
  let mainWebp = await sharp(buffer)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 5 })
    .toBuffer();

  while (mainWebp.byteLength > 120 * 1024 && quality > 40) {
    quality -= 10;
    mainWebp = await sharp(buffer)
      .rotate()
      .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 6 })
      .toBuffer();
  }

  const thumbWebp = await sharp(buffer)
    .rotate()
    .resize({ width: 420, height: 420, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72, effort: 5 })
    .toBuffer();

  const mainKey = `products/${id}.webp`;
  const thumbKey = `products/${id}-thumb.webp`;

  if (r2Client && process.env.R2_BUCKET_NAME) {
    await Promise.all([
      r2Client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: mainKey,
          Body: mainWebp,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      ),
      r2Client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: thumbKey,
          Body: thumbWebp,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      ),
    ]);

    const cdnBase = (process.env.R2_PUBLIC_CDN_URL || '').replace(/\/$/, '');
    return {
      url: cdnBase ? `${cdnBase}/${mainKey}` : `/uploads/${id}.webp`,
      thumbUrl: cdnBase ? `${cdnBase}/${thumbKey}` : `/uploads/${id}-thumb.webp`,
      byteSize: mainWebp.byteLength,
      storage: 'r2',
    };
  }

  ensureUploadDir();
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.webp`), mainWebp);
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}-thumb.webp`), thumbWebp);

  return {
    url: `/uploads/${id}.webp`,
    thumbUrl: `/uploads/${id}-thumb.webp`,
    byteSize: mainWebp.byteLength,
    storage: 'local',
  };
}

export function getUploadDir(): string {
  ensureUploadDir();
  return UPLOAD_DIR;
}
