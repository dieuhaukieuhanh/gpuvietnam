#!/usr/bin/env node
/**
 * Post cut-over smoke: apex serves Next (not WordPress) + proxy health.
 * Usage: node scripts/smoke-apex-next.mjs [https://gpuvietnam.com]
 */
const apex = String(process.argv[2] || 'https://gpuvietnam.com').replace(/\/$/, '');
const work = 'https://work.gpuvietnam.com';

async function probe(url, opts = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    headers: { Accept: opts.accept || '*/*', ...(opts.headers || {}) },
  });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const home = await probe(`${apex}/`);
  assert(home.status === 200, `apex / expected 200, got ${home.status}`);
  assert(!/wp-includes|WordPress/i.test(home.text), 'apex still looks like WordPress');
  assert(
    home.text.includes('__NEXT_DATA__') || home.text.includes('/_next/'),
    'apex missing Next markers (__NEXT_DATA__ / /_next/)',
  );
  console.log('OK apex homepage is Next');

  const resolve = await probe(`${apex}/api/internal/comfy-proxy-resolve`, {
    accept: 'application/json',
  });
  assert(resolve.status !== 404 || !/wp-includes/i.test(resolve.text), 'resolve still WP 404 HTML');
  assert(
    resolve.headers.get('content-type')?.includes('json') ||
      resolve.status === 401 ||
      resolve.status === 400 ||
      resolve.status === 503,
    `resolve unexpected: ${resolve.status} ${resolve.headers.get('content-type')}`,
  );
  console.log(`OK resolve API status=${resolve.status} (JSON/auth path)`);

  const health = await probe(`${work}/health`);
  assert(health.status === 200 && health.text.trim() === 'ok', 'work health failed');
  console.log('OK work.gpuvietnam.com/health');

  console.log('smoke-apex-next: all checks passed');
}

main().catch((err) => {
  console.error('smoke-apex-next FAILED:', err.message || err);
  process.exit(1);
});
