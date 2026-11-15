import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

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

/**
 * Deletes uploaded product assets from Cloudflare R2 / CDN and local /data/uploads directory.
 * Static seeded assets under /src/assets/ are untouched.
 */
export async function deleteStoredImageAssets(urls: string[]): Promise<{
  deletedCount: number;
  deletedKeys: string[];
  skippedUrls: string[];
}> {
  const uniqueUrls = Array.from(new Set(urls.map((u) => (u || '').trim()).filter(Boolean)));
  const r2Keys = new Set<string>();
  const localFilenames = new Set<string>();
  const skippedUrls: string[] = [];
  const cdnBase = (process.env.R2_PUBLIC_CDN_URL || '').replace(/\/$/, '');

  for (const rawUrl of uniqueUrls) {
    if (rawUrl.startsWith('/src/assets/') || rawUrl.startsWith('data:')) {
      skippedUrls.push(rawUrl);
      continue;
    }

    let pathname = rawUrl;
    if (/^https?:\/\//i.test(rawUrl)) {
      try {
        pathname = new URL(rawUrl).pathname;
      } catch {
        skippedUrls.push(rawUrl);
        continue;
      }
    }

    if (cdnBase && rawUrl.startsWith(cdnBase)) {
      const relKey = rawUrl.slice(cdnBase.length).replace(/^\/+/, '');
      if (relKey) r2Keys.add(relKey);
    } else if (pathname.startsWith('/uploads/')) {
      const safeFile = path.basename(pathname);
      if (safeFile && safeFile !== '.' && safeFile !== '..') {
        localFilenames.add(safeFile);
        r2Keys.add(`products/${safeFile}`);
      }
    } else if (pathname.includes('/products/')) {
      const relKey = pathname.replace(/^\/+/, '');
      r2Keys.add(relKey);
    } else {
      skippedUrls.push(rawUrl);
    }
  }

  // Ensure companion thumb/main variants are also queued if one was passed
  for (const file of Array.from(localFilenames)) {
    if (file.endsWith('-thumb.webp')) {
      localFilenames.add(file.replace(/-thumb\.webp$/, '.webp'));
    } else if (file.endsWith('.webp')) {
      localFilenames.add(file.replace(/\.webp$/, '-thumb.webp'));
    }
  }
  for (const key of Array.from(r2Keys)) {
    if (key.endsWith('-thumb.webp')) {
      r2Keys.add(key.replace(/-thumb\.webp$/, '.webp'));
    } else if (key.endsWith('.webp')) {
      r2Keys.add(key.replace(/\.webp$/, '-thumb.webp'));
    }
  }

  const deletedKeys: string[] = [];

  if (r2Client && process.env.R2_BUCKET_NAME && r2Keys.size > 0) {
    await Promise.all(
      Array.from(r2Keys).map(async (key) => {
        try {
          await r2Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME!,
              Key: key,
            })
          );
          deletedKeys.push(`r2:${key}`);
        } catch {
          // Ignore missing object or transient CDN deletion errors
        }
      })
    );
  }

  for (const file of localFilenames) {
    const resolved = path.resolve(UPLOAD_DIR, file);
    if (!resolved.startsWith(UPLOAD_DIR + path.sep)) continue;
    try {
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
        deletedKeys.push(`local:${file}`);
      }
    } catch {
      // Ignore unlink failure
    }
  }

  return {
    deletedCount: deletedKeys.length,
    deletedKeys,
    skippedUrls,
  };
}
