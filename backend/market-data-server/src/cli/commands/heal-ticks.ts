#!/usr/bin/env tsx
/**
 * Heal-ticks command - backfills missing weekday tick data from Dukascopy into R2
 *
 * Usage:
 *   npx tsx src/cli/commands/heal-ticks.ts <SYMBOL> <START_DATE> <END_DATE> [--only-fridays] [--chunk-hours=24] [--delay-seconds=0] [--dry-run]
 *
 * Examples:
 *   npx tsx src/cli/commands/heal-ticks.ts EURUSD 2024-01-01 2024-12-31
 *   npx tsx src/cli/commands/heal-ticks.ts EURUSD 2024-01-01 2024-12-31 --only-fridays --dry-run
 */
import dotenv from 'dotenv';
import { ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { DukascopyToR2Importer } from './import.js';
import { getR2Client } from '../../services/r2Client.js';

dotenv.config();

function usage(): void {
  console.log('Usage: npx tsx src/cli/commands/heal-ticks.ts <SYMBOL> <START_DATE> <END_DATE> [--only-fridays] [--chunk-hours=24] [--delay-seconds=0] [--dry-run]');
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx src/cli/commands/heal-ticks.ts EURUSD 2024-01-01 2024-12-31');
  console.log('  npx tsx src/cli/commands/heal-ticks.ts EURUSD 2024-01-01 2024-12-31 --only-fridays --dry-run');
}

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function* iterateWeekdays(start: Date, end: Date): Generator<Date> {
  const current = new Date(start);
  while (current <= end) {
    const dow = current.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      yield new Date(current);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

function parseArgs(raw: string[]): {
  symbol: string;
  start: Date;
  end: Date;
  onlyFridays: boolean;
  chunkHours: number;
  delaySeconds: number;
  dryRun: boolean;
} {
  if (raw.length < 3) {
    usage();
    process.exit(1);
  }

  const symbol = raw[0].toUpperCase();
  const start = new Date(raw[1] + 'T00:00:00Z');
  const end = new Date(raw[2] + 'T23:59:59Z');

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    console.error('Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  const onlyFridays = raw.includes('--only-fridays');
  const dryRun = raw.includes('--dry-run');

  const chunkHoursArg = raw.find((a) => a.startsWith('--chunk-hours='));
  const delayArg = raw.find((a) => a.startsWith('--delay-seconds='));

  const chunkHours = chunkHoursArg ? parseInt(chunkHoursArg.split('=')[1], 10) : 24;
  const delaySeconds = delayArg ? parseInt(delayArg.split('=')[1], 10) : 0;

  if (Number.isNaN(chunkHours) || chunkHours <= 0) {
    console.error('Invalid chunk hours. Must be positive.');
    process.exit(1);
  }
  if (Number.isNaN(delaySeconds) || delaySeconds < 0) {
    console.error('Invalid delay seconds. Must be >= 0.');
    process.exit(1);
  }

  return { symbol, start, end, onlyFridays, chunkHours, delaySeconds, dryRun };
}

async function listTickDates(
  symbol: string,
  start: Date,
  end: Date
): Promise<Set<string>> {
  const r2Client = getR2Client();
  if (!r2Client) {
    throw new Error('R2 not configured');
  }

  const seen = new Set<string>();
  let continuationToken: string | undefined = undefined;
  const prefix = `ticks/${symbol}/`;

  do {
    const cmd: ListObjectsV2Command = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME!,
      Prefix: prefix,
      ContinuationToken: continuationToken
    });
    const resp: ListObjectsV2CommandOutput = await r2Client.s3Client.send(cmd);
    if (resp.Contents) {
      for (const obj of resp.Contents) {
        if (!obj.Key) continue;
        const parts = obj.Key.split('/');
        if (parts.length !== 6) continue;
        const [, keySymbol, yearStr, monthStr, dayStr] = parts;
        if (keySymbol !== symbol) continue;
        const fileDate = new Date(Date.UTC(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, parseInt(dayStr, 10)));
        if (fileDate >= start && fileDate <= end) {
          seen.add(dateStr(fileDate));
        }
      }
    }
    continuationToken = (resp as any).NextContinuationToken;
  } while (continuationToken);

  return seen;
}

async function main(): Promise<void> {
  const { symbol, start, end, onlyFridays, chunkHours, delaySeconds, dryRun } = parseArgs(process.argv.slice(2));

  console.log(`\n🩹 Healing ticks for ${symbol}`);
  console.log(`   Range: ${dateStr(start)} → ${dateStr(end)}`);
  console.log(`   Only Fridays: ${onlyFridays}`);
  console.log(`   Chunk hours: ${chunkHours}`);
  console.log(`   Delay seconds: ${delaySeconds}`);
  console.log(`   Dry run: ${dryRun}\n`);

  const present = await listTickDates(symbol, start, end);

  const missing: Date[] = [];
  for (const day of iterateWeekdays(start, end)) {
    const dow = day.getUTCDay();
    if (onlyFridays && dow !== 5) continue;
    if (!present.has(dateStr(day))) {
      missing.push(new Date(day));
    }
  }

  console.log(`Found ${missing.length} missing weekday(s)${onlyFridays ? ' (Fridays only)' : ''}.`);
  if (missing.length > 0) {
    console.log(`First 10 missing: ${missing.slice(0, 10).map(dateStr).join(', ')}`);
  }

  if (dryRun) {
    console.log('\n🔍 Dry run only. No imports performed.');
    return;
  }

  if (missing.length === 0) {
    console.log('\n✅ Nothing to backfill.');
    return;
  }

  const importer = new DukascopyToR2Importer();
  let success = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i++) {
    const day = missing[i];
    const label = dateStr(day);
    console.log(`\n[${i + 1}/${missing.length}] Importing ${label}...`);
    try {
      await importer.import(symbol, day, day, chunkHours, delaySeconds);
      success++;
    } catch (error: any) {
      failed++;
      console.error(`   ❌ Failed ${label}: ${error.message || error}`);
    }
  }

  console.log(`\n📊 Heal summary for ${symbol}:`);
  console.log(`   Successful: ${success}`);
  console.log(`   Failed: ${failed}`);
  if (failed > 0) {
    console.log('   ❗ Re-run for failed days or use smaller chunk hours if needed.');
  } else {
    console.log('   ✅ Completed without errors.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
