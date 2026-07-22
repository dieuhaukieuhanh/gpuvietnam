const fs = require('fs');

function toUtf8(path) {
  const buf = fs.readFileSync(path);
  let text;
  if (buf[1] === 0 && buf[3] === 0) text = buf.toString('utf16le');
  else text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  fs.writeFileSync(path, text, 'utf8');
  return text;
}

const testPath = 'src/lib/gpu/providers/clore/clore-orphan-reconcile.test.mjs';
let test = toUtf8(testPath);
test = test.replace("from './clore-orphan-reconcile.js'", "from './clore-orphan-core.js'");
fs.writeFileSync(testPath, test, 'utf8');
console.log('test import ok', test.includes('clore-orphan-core'));

const docsPath = 'AI_DEBUGGING.md';
let docs = toUtf8(docsPath);
const marker = '## Recovering Clore Orphan Orders';
const idx = docs.indexOf(marker);
let head = idx >= 0 ? docs.slice(0, idx) : docs;
head = head.replace(/\n+$/, '\n\n');
if (!head.includes('clore-orphan-reconcile.test.mjs')) {
  head = head.replace(
    'node --test src/lib/logging/logger.test.mjs\n```',
    'node --test src/lib/logging/logger.test.mjs\nnode --test src/lib/gpu/providers/clore/clore-orphan-reconcile.test.mjs\n```'
  );
}
let section = fs.readFileSync('tmp/orphan-docs-section.md', 'utf8');
if (section.charCodeAt(0) === 0xfeff) section = section.slice(1);
fs.writeFileSync(docsPath, head + section, 'utf8');
console.log('docs ok');
