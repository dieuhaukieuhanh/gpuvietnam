#!/usr/bin/env node
/**
 * Summarize tmp/provision-journal.jsonl funnel for Clore/Vast go/no-go.
 *
 * Usage:
 *   node scripts/summarize-provision-journal.mjs
 *   node scripts/summarize-provision-journal.mjs --provider=clore
 *   node scripts/summarize-provision-journal.mjs --path=tmp/provision-journal.jsonl
 */

import {
  readProvisionJournal,
  resolveProvisionJournalPath,
  summarizeProvisionJournal,
} from '../src/lib/gpu/provision-journal.js';

function parseArgs(argv) {
  /** @type {{ provider: string | null; path: string | null }} */
  const out = { provider: null, path: null };
  for (const arg of argv) {
    if (arg.startsWith('--provider=')) out.provider = arg.slice('--provider='.length).trim() || null;
    else if (arg.startsWith('--path=')) out.path = arg.slice('--path='.length).trim() || null;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.path || resolveProvisionJournalPath();
  const rows = readProvisionJournal(file);
  const summary = summarizeProvisionJournal(rows, { provider: args.provider });
  const f = summary.funnel;

  console.log(`Provision journal: ${file}`);
  console.log(`Total attempts: ${summary.total}${summary.provider ? ` (provider=${summary.provider})` : ''}`);
  if (summary.total === 0) {
    console.log('No rows yet — open machines (Clore/Vast) to append journal lines.');
    return;
  }

  console.log('');
  console.log('Funnel (% of attempts):');
  console.log(`  Rent OK              ${f.rentOk.count}/${summary.total} (${f.rentOk.pct}%)`);
  console.log(`  http_pub present     ${f.httpPub.count}/${summary.total} (${f.httpPub.pct}%)`);
  console.log(`  HTTP endpoint OK     ${f.httpEndpointOk.count}/${summary.total} (${f.httpEndpointOk.pct}%)`);
  console.log(`  /system_stats OK     ${f.systemStatsOk.count}/${summary.total} (${f.systemStatsOk.pct}%)`);
  console.log(`  Prompt smoke OK      ${f.promptSmokeOk.count}/${summary.total} (${f.promptSmokeOk.pct}%)`);
  console.log(`  RUNNING              ${f.running.count}/${summary.total} (${f.running.pct}%)`);
  if (summary.avgRentToRunningMs != null) {
    console.log(`  Avg rent→RUNNING     ${Math.round(summary.avgRentToRunningMs / 1000)}s`);
  }

  const failSteps = Object.entries(summary.failByStep).sort((a, b) => b[1] - a[1]);
  if (failSteps.length) {
    console.log('');
    console.log('Fails by step:');
    for (const [step, count] of failSteps) {
      console.log(`  ${step}: ${count}`);
    }
  }

  const failCats = Object.entries(summary.failByCategory).sort((a, b) => b[1] - a[1]);
  if (failCats.length) {
    console.log('');
    console.log('Fails by category:');
    for (const [cat, count] of failCats) {
      console.log(`  ${cat}: ${count}`);
    }
  }

  console.log('');
  console.log(JSON.stringify(summary, null, 2));
}

main();
