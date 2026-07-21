/**
 * Download stock models → upload to R2 (multipart; files can exceed 5GB).
 * Usage: node scripts/sync-stock-models-to-r2.mjs
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { buildStockModelR2Key } from '../src/lib/stock-models.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvLocal() {
  const p = path.join(root, '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

function resolveEndpoint() {
  const configured = String(process.env.R2_ENDPOINT ?? '').trim();
  const accountId = String(process.env.R2_ACCOUNT_ID ?? '').trim();
  if (configured && !/your-account|example\.com|changeme|placeholder/i.test(configured)) return configured;
  if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`;
  return configured || null;
}

function curlDownload(url, dest, minBytes) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = dest + '.part';
    try { fs.unlinkSync(part); } catch {}
    const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
    console.log('[download]', path.basename(dest));
    const child = spawn(curlBin, ['-fL', '--retry', '5', '--retry-delay', '3', '-A', 'gpuvietnam-stock-sync/1.0', '--output', part, url], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        try { fs.unlinkSync(part); } catch {}
        return reject(new Error('curl exit ' + code));
      }
      const size = fs.statSync(part).size;
      if (size < minBytes) {
        try { fs.unlinkSync(part); } catch {}
        return reject(new Error('file too small ' + size));
      }
      fs.renameSync(part, dest);
      console.log('[download] ok', (size / 1e6).toFixed(1), 'MB');
      resolve();
    });
  });
}

async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadFile(client, bucket, localPath, r2Relative) {
  const key = buildStockModelR2Key(r2Relative);
  if (await objectExists(client, bucket, key)) {
    console.log('[r2] already', key);
    return;
  }
  console.log('[r2] upload', key, (fs.statSync(localPath).size / 1e6).toFixed(1), 'MB');
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(localPath),
      ContentType: 'application/octet-stream',
    },
    queueSize: 2,
    partSize: 100 * 1024 * 1024,
  });
  let last = 0;
  upload.on('httpUploadProgress', (p) => {
    if (!p.total) return;
    const pct = Math.floor((p.loaded / p.total) * 100);
    if (pct >= last + 5) {
      last = pct;
      console.log('[r2]', pct + '%');
    }
  });
  await upload.done();
  console.log('[r2] ok', key);
}

const JOBS = [
  {
    rel: 'upscale_models/RealESRGAN_x4plus.pth',
    url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
    minBytes: 50_000_000,
  },
  {
    rel: 'checkpoints/sd_xl_base_1.0.safetensors',
    url: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors',
    minBytes: 5_000_000_000,
  },
  {
    rel: 'checkpoints/RealVisXL_V6.0_B1.safetensors',
    url: 'https://huggingface.co/SG161222/RealVisXL_V4.0/resolve/main/RealVisXL_V4.0.safetensors',
    minBytes: 5_000_000_000,
  },
];

async function main() {
  loadEnvLocal();
  const endpoint = resolveEndpoint();
  const bucket = process.env.R2_BUCKET_NAME;
  if (!endpoint || !bucket || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 env incomplete');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestHandler: new NodeHttpHandler({ connectionTimeout: 120_000, requestTimeout: 0 }),
  });

  const localRoot = path.join(root, 'local-models');
  for (const job of JOBS) {
    const key = buildStockModelR2Key(job.rel);
    if (await objectExists(client, bucket, key)) {
      console.log('[r2] already', key);
      continue;
    }
    const dest = path.join(localRoot, job.rel);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < job.minBytes) {
      await curlDownload(job.url, dest, job.minBytes);
    } else {
      console.log('[local] ok', dest);
    }
    await uploadFile(client, bucket, dest, job.rel);
  }
  console.log('DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
