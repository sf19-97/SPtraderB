#!/usr/bin/env tsx
/**
 * Candle update command - continue migrating ticks → candles in R2 from the last candle month found.
 *
 * Usage:
 *   npx tsx src/cli/commands/candle-update.ts <SYMBOL> [--days=<n>] [--dry-run] [--delete-ticks]
 *   npx tsx src/cli/commands/candle-update.ts --all [--days=<n>] [--dry-run] [--delete-ticks]
 *
 * Notes:
 *   - Requires a symbol or --all.
 *   - If no candles exist yet, falls back to last N days (default 1).
 *   - Uses existing migrate logic (TickToCandleMigrator) to build candles and upload to R2.
 */
import dotenv from 'dotenv';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { TickToCandleMigrator } from './migrate.js';
import { VALID_SYMBOLS } from './import.js';
import { getR2Client } from '../../services/r2Client.js';

dotenv.config();

function usage(): void {
  console.error('Usage:');
  console.error('  npx tsx src/cli/commands/candle-update.ts <SYMBOL> [--days=<n>] [--dry-run] [--delete-ticks]');
  console.error('  npx tsx src/cli/commands/candle-update.ts --all [--days=<n>] [--dry-run] [--delete-ticks]');
  process.exit(1);
}

function lastCompleteUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999));
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Find the latest candle month present in R2 for a symbol.
 * Returns the last day of that month, or null if none exist.
 */
async function findLatestCandleDay(symbol: string): Promise<Date | null> {
  const r2 = getR2Client();
  if (!r2) throw new Error('R2 client not configured');

  const prefix = `candles/${symbol}/`;
  let token: string | undefined;
  let latest: { year: number; month: number } | null = null;

  do {
    const resp = await r2.s3Client.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME!,
      Prefix: prefix,
      ContinuationToken: token
    }));

    for (const obj of resp.Contents || []) {
      if (!obj.Key) continue;
      const parts = obj.Key.split('/');
      // candles/SYMBOL/YYYY/MM/part-xxxx.json
      if (parts.length < 5) continue;
      const year = parseInt(parts[2], 10);
      const month = parseInt(parts[3], 10);
      if (Number.isNaN(year) || Number.isNaN(month)) continue;
      if (!latest || year > latest.year || (year === latest.year && month > latest.month)) {
        latest = { year, month };
      }
    }

    token = resp.NextContinuationToken;
  } while (token);

  if (!latest) return null;
  // last day of the month
  const lastDay = new Date(Date.UTC(latest.year, latest.month, 0, 0, 0, 0, 0));
  return lastDay;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));

  const all = flags.includes('--all');
  const dryRun = flags.includes('--dry-run');
  const deleteTicks = flags.includes('--delete-ticks');

  const daysFlag = flags.find((a) => a.startsWith('--days='));
  const fallbackDays = daysFlag ? parseInt(daysFlag.split('=')[1], 10) : 1;

  if (!all && positional.length === 0) usage();
  if (all && positional.length > 0) usage();
  if (Number.isNaN(fallbackDays) || fallbackDays <= 0) {
    console.error('❌ --days must be a positive integer.');
    process.exit(1);
  }

  const symbols = all ? [...VALID_SYMBOLS] : [positional[0].toUpperCase()];
  const endDate = lastCompleteUtcDay();

  console.log(`\n🔄 Candle update (ticks → candles in R2)`);
  console.log(`   Target: ${all ? 'all supported symbols' : symbols[0]}`);
  console.log(`   Fallback days when empty: ${fallbackDays}`);
  console.log(`   Dry run: ${dryRun}`);
  console.log(`   Delete ticks after: ${deleteTicks}`);
  console.log(`   End date: ${toDateStr(endDate)}\n`);

  let totalCandles = 0;
  const migrator = new TickToCandleMigrator();

  for (const symbol of symbols) {
    console.log(`\n=== ${symbol} ===`);
    const latestCandleDay = await findLatestCandleDay(symbol);

    const startDate = latestCandleDay
      ? new Date(Date.UTC(latestCandleDay.getUTCFullYear(), latestCandleDay.getUTCMonth(), latestCandleDay.getUTCDate() + 1))
      : new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate() - (fallbackDays - 1)));

    if (startDate > endDate) {
      console.log(`✅ Up to date. Latest candle month ends ${latestCandleDay ? toDateStr(latestCandleDay) : 'n/a'}`);
      continue;
    }

    console.log(`Planning migrate: ${toDateStr(startDate)} → ${toDateStr(endDate)}`);
    if (dryRun) {
      console.log('Dry run only. Skipping migration.');
      continue;
    }

    await migrator.migrateRange(symbol, startDate, endDate, { dryRun, deleteTicks });
  }

  if (!dryRun) {
    console.log(`\n🎉 Candle update complete. (See per-range summaries above)`);
  } else {
    console.log(`\n🔍 Dry run complete (no changes made).`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
