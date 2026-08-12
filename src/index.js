#!/usr/bin/env node
// Event scraper CLI.
//
// Usage:
//   node src/index.js [YYYY-MM-DD] [--all] [--json]
//
//   (no date)        list events for today
//   YYYY-MM-DD       list events for that specific day
//   --all            ignore the date filter, list every upcoming event
//   --json           output raw JSON instead of a formatted table
//
// Add more sites by dropping a module in src/sites/ that exports
// { meta, fetchEvents } and registering it in src/registry.js.

import { scrapeEvents, todayIso } from './registry.js';
import { setProgressQuiet } from './progress.js';

function parseArgs(argv) {
  const opts = { date: todayIso(), all: false, json: false, quiet: false };
  for (const arg of argv) {
    if (arg === '--all') opts.all = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) opts.date = arg;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else console.error(`Ignoring unrecognized argument: ${arg}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      'Usage: node src/index.js [YYYY-MM-DD] [--all] [--json]\n' +
        '  (no date)   events for today\n' +
        '  YYYY-MM-DD  events for that day\n' +
        '  --all       every upcoming event\n' +
        '  --json      raw JSON output\n' +
        '  --quiet     suppress progress messages',
    );
    return;
  }

  setProgressQuiet(opts.quiet);
  const events = await scrapeEvents({ date: opts.date, all: opts.all, quiet: opts.quiet });

  if (opts.json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  printTable(events, opts);
}

function printTable(events, opts) {
  const scope = opts.all ? 'all upcoming days' : opts.date;
  console.log(`\nEvents for ${scope} — ${events.length} found\n`);
  if (events.length === 0) {
    console.log('  (no events)\n');
    return;
  }
  const whenW = opts.all ? 17 : 6;
  const priceW = Math.max(5, ...events.map((e) => e.priceText.length));
  const siteW = Math.max(6, ...events.map((e) => e.site.length));
  const whenLabel = opts.all ? 'Date/Time' : 'Time';

  console.log(
    `  ${whenLabel.padEnd(whenW)}  ${'Price'.padEnd(priceW)}  ${'Source'.padEnd(siteW)}  Event`,
  );

  for (const e of events) {
    const when = opts.all ? `${e.date} ${e.time}` : e.time;
    console.log(
      `  ${when.padEnd(whenW)}  ${e.priceText.padEnd(priceW)}  ${e.site.padEnd(siteW)}  ${e.name}`,
    );
    console.log(`  ${' '.repeat(whenW)}  ${' '.repeat(priceW)}  ${' '.repeat(siteW)}  ${e.url}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
