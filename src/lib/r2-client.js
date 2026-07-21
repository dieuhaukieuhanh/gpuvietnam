import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  buildUserBackupR2Key,
  sanitizeBackupObjectKey,
} from './machine-backup-token.js';

/** @type {S3Client | null} */
let r2Client = null;

/**
 * Prefer R2_ENDPOINT; if missing/placeholder, derive from R2_ACCOUNT_ID.
 * @returns {string | null}
 */
export function resolveR2Endpoint() {
  const configured = String(process.env.R2_ENDPOINT ?? '').trim();
  const accountId = String(process.env.R2_ACCOUNT_ID ?? '').trim();
  const placeholder = /your-account|example\.com|changeme|placeholder/i.test(configured);

  if (configured && !placeholder) return configured;
  if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`;
  return configured || null;
}

export function isR2Configured() {
  return Boolean(
    resolveR2Endpoint() &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME,
  );
}

export function getR2Client() {
  if (!isR2Configured()) {
    return null;
  }

  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: resolveR2Endpoint(),
      credentials: {
        accessKeyId: String(process.env.R2_ACCESS_KEY_ID),
        secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY),
      },
    });
  }

  return r2Client;
}

/**
 * @param {string} key
 * @param {Buffer | Uint8Array} body
 * @param {string} [contentType]
 */
export async function uploadToR2(key, body, contentType = 'application/gzip') {
  const client = getR2Client();
  if (!client) {
    throw new Error('R2 is not configured');
  }

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return key;
}

/**
 * @param {string} key
 * @returns {Promise<Buffer>}
 */
export async function downloadFromR2(key) {
  const client = getR2Client();
  if (!client) {
    throw new Error('R2 is not configured');
  }

  const response = await client.send(
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }),
  );

  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

/**
 * Time-limited GET URL for any object key in the bucket (server-side only).
 * @param {string} r2Key
 * @param {{ expiresIn?: number }} [options]
 */
export async function createPresignedDownloadUrl(r2Key, options = {}) {
  const client = getR2Client();
  if (!client) {
    throw new Error('R2 is not configured');
  }
  const key = String(r2Key ?? '').replace(/^\/+/, '');
  if (!key || key.includes('..')) {
    throw new Error('Invalid R2 key');
  }
  const expiresIn = Math.min(
    3600,
    Math.max(60, Math.floor(Number(options.expiresIn ?? 900) || 900)),
  );
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  });
  const downloadUrl = await getSignedUrl(client, command, { expiresIn });
  return { downloadUrl, r2Key: key, expiresIn };
}

/**
 * Create time-limited PUT URLs under users/{userId}/(outputs|workflows|models)/…
 * @param {string} userId
 * @param {Array<{ key: string; contentType?: string }>} objects
 * @param {{ expiresIn?: number }} [options]
 */
export async function createPresignedUploadUrls(userId, objects, options = {}) {
  const client = getR2Client();
  if (!client) {
    throw new Error('R2 is not configured');
  }

  const uid = String(userId ?? '').trim();
  if (!uid) throw new Error('Missing userId');

  const expiresIn = Math.min(
    3600,
    Math.max(60, Math.floor(Number(options.expiresIn ?? 900) || 900)),
  );

  const list = Array.isArray(objects) ? objects.slice(0, 50) : [];
  /** @type {Array<{ key: string; r2Key: string; contentType: string; uploadUrl: string }>} */
  const uploads = [];
  /** @type {Array<{ key: string; error: string }>} */
  const errors = [];

  for (const item of list) {
    const rawKey = item?.key != null ? String(item.key) : '';
    const sanitized = sanitizeBackupObjectKey(rawKey);
    if (!sanitized.ok) {
      errors.push({ key: rawKey || '(empty)', error: sanitized.error });
      continue;
    }

    const contentType =
      typeof item.contentType === 'string' && item.contentType.trim()
        ? item.contentType.trim().slice(0, 120)
        : 'application/octet-stream';
    const r2Key = buildUserBackupR2Key(uid, sanitized.key);

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn });
    uploads.push({
      key: sanitized.key,
      r2Key,
      contentType,
      uploadUrl,
    });
  }

  return { expiresIn, uploads, errors };
}