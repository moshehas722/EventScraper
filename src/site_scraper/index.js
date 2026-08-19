#!/usr/bin/env node
// Event scraper CLI.
//
// Usage:
//   node src/site_scraper/index.js [YYYY-MM-DD] [--all] [--json] [--vercel]
//
//   (no date)        list events for today
//   YYYY-MM-DD       list events for that specific day
//   --all            ignore the date filter, list every upcoming event
//   --json           output raw JSON instead of a formatted table
//   --vercel         also upload the events JSON to Vercel Blob
//
// Add more sites by dropping a module in src/site_scraper/sites/ that exports
// { meta, fetchEvents } and registering it in src/site_scraper/registry.js.

import { scrapeEvents, todayIso } from './registry.js';
import { setProgressQuiet } from './progress.js';
import { uploadEventsToBlob } from '../blob.js';

function parseArgs(argv) {
  const opts = { date: todayIso(), all: false, json: false, quiet: false, vercel: false };
  for (const arg of argv) {
    if (arg === '--all') opts.all = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true;
    else if (arg === '--vercel') opts.vercel = true;
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
      'Usage: node src/site_scraper/index.js [YYYY-MM-DD] [--all] [--json] [--vercel]\n' +
        '  (no date)   events for today\n' +
        '  YYYY-MM-DD  events for that day\n' +
        '  --all       every upcoming event\n' +
        '  --json      raw JSON output\n' +
        '  --quiet     suppress progress messages\n' +
        '  --vercel    also upload the events JSON to Vercel Blob',
    );
    return;
  }

  setProgressQuiet(opts.quiet);
  const events = await scrapeEvents({ date: opts.date, all: opts.all, quiet: opts.quiet });

  if (opts.json) {
    console.log(JSON.stringify(events, null, 2));
  } else {
    printTable(events, opts);
  }

  if (opts.vercel) {
    const blob = await uploadEventsToBlob(events, opts);
    console.log(`Uploaded to Vercel Blob: ${blob.pathname}`);
  }
}

function printTable(events, opts) {
  const scope = opts.all ? 'all upcoming days' : opts.date;
  console.log(`\nEvents for ${scope} — ${events.length} found\n`);
  if (events.length === 0) {
    console.log('  (no events)\n');
    return;
  }
  const whenW = opts.all ? 17 : 6;
  const priceW = Math.max(5, ...events.map((e) => e.cost.length));
  const siteW = Math.max(6, ...events.map((e) => e.source.length));
  const whenLabel = opts.all ? 'Date/Time' : 'Time';

  console.log(
    `  ${whenLabel.padEnd(whenW)}  ${'Price'.padEnd(priceW)}  ${'Source'.padEnd(siteW)}  Event`,
  );

  for (const e of events) {
    const when = opts.all ? `${e.date} ${e.time}` : e.time;
    console.log(
      `  ${when.padEnd(whenW)}  ${e.cost.padEnd(priceW)}  ${e.source.padEnd(siteW)}  ${e.name}`,
    );
    console.log(`  ${' '.repeat(whenW)}  ${' '.repeat(priceW)}  ${' '.repeat(siteW)}  ${e.reference}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
