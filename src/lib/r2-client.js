import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** @type {S3Client | null} */
let r2Client = null;

export function isR2Configured() {
  return Boolean(
    process.env.R2_ENDPOINT &&
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
      endpoint: process.env.R2_ENDPOINT,
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
