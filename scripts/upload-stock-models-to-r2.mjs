/**
 * Upload stock ComfyUI models to R2 under stock/models/...
 *
 * Usage (from repo root, with R2_* in env):
 *   node scripts/upload-stock-models-to-r2.mjs --dir ./local-models
 *   node scripts/upload-stock-models-to-r2.mjs --file ./sd_xl_base_1.0.safetensors --key checkpoints/sd_xl_base_1.0.safetensors
 *
 * Expected layout under --dir:
 *   checkpoints/sd_xl_base_1.0.safetensors
 *   checkpoints/RealVisXL_V6.0_B1.safetensors
 *   upscale_models/RealESRGAN_x4plus.pth
 */
import fs from 'fs';
import path from 'path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  STOCK_MODEL_MANIFEST,
  STOCK_MODELS_R2_PREFIX,
  buildStockModelR2Key,
} from '../src/lib/stock-models.js';

function resolveEndpoint() {
  const configured = String(process.env.R2_ENDPOINT ?? '').trim();
  const accountId = String(process.env.R2_ACCOUNT_ID ?? '').trim();
  if (configured && !/your-account|example\.com|changeme|placeholder/i.test(configured)) {
    return configured;
  }
  if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`;
  return configured || null;
}

function parseArgs(argv) {
  /** @type {{ dir?: string; file?: string; key?: string; dryRun?: boolean }} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') out.dir = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--key') out.key = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

async function uploadOne(client, bucket, localPath, r2Relative) {
  const key = buildStockModelR2Key(r2Relative);
  const body = fs.createReadStream(localPath);
  const size = fs.statSync(localPath).size;
  console.log(`PUT s3://${bucket}/${key} (${(size / 1e9).toFixed(2)} GB) from ${localPath}`);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/octet-stream',
    }),
  );
  console.log(`OK ${key}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = resolveEndpoint();
  const bucket = process.env.R2_BUCKET_NAME;
  if (!endpoint || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !bucket) {
    console.error('Missing R2_ENDPOINT/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  if (args.file && args.key) {
    if (args.dryRun) {
      console.log(`[dry-run] ${args.file} -> ${buildStockModelR2Key(args.key)}`);
      return;
    }
    await uploadOne(client, bucket, path.resolve(args.file), args.key);
    return;
  }

  if (!args.dir) {
    console.error('Provide --dir <folder> or --file + --key');
    console.error(`Prefix: ${STOCK_MODELS_R2_PREFIX}/`);
    console.error('Manifest:');
    for (const m of STOCK_MODEL_MANIFEST) console.error(`  ${m.r2Relative}`);
    process.exit(1);
  }

  const root = path.resolve(args.dir);
  for (const m of STOCK_MODEL_MANIFEST) {
    const localPath = path.join(root, m.r2Relative);
    if (!fs.existsSync(localPath)) {
      console.warn(`SKIP missing ${localPath}`);
      continue;
    }
    if (args.dryRun) {
      console.log(`[dry-run] ${localPath} -> ${buildStockModelR2Key(m.r2Relative)}`);
      continue;
    }
    await uploadOne(client, bucket, localPath, m.r2Relative);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});