#!/usr/bin/env tsx
/**
 * Materialize-update command - Continues materializing candles from the last day in DB.
 *
 * Usage:
 *   npx tsx src/cli/commands/materialize-update.ts <SYMBOL> [--days=<n>] [--dry-run] [--skip-refresh]
 *   npx tsx src/cli/commands/materialize-update.ts --all [--days=<n>] [--dry-run] [--skip-refresh]
 *
 * Notes:
 *   - You must provide a symbol or --all (no implicit default).
 *   - When DB has no candles for a symbol, falls back to the last N days (default 1).
 */
import dotenv from 'dotenv';
import { getPool, closePool } from '../../services/database.js';
import { getR2Client } from '../../services/r2Client.js';
import { MaterializationService } from '../../services/materializationService.js';
import { VALID_SYMBOLS } from './import.js';

dotenv.config();

function usage(): void {
  console.error('Usage:');
  console.error('  npx tsx src/cli/commands/materialize-update.ts <SYMBOL> [--days=<n>] [--dry-run] [--skip-refresh]');
  console.error('  npx tsx src/cli/commands/materialize-update.ts --all [--days=<n>] [--dry-run] [--skip-refresh]');
  console.error('Notes: requires a symbol or --all.');
  process.exit(1);
}

function lastCompleteUtcDay(): Date {
  const nowUtc = new Date();
  return new Date(Date.UTC(
    nowUtc.getUTCFullYear(),
    nowUtc.getUTCMonth(),
    nowUtc.getUTCDate() - 1,
    23, 59, 59, 999
  ));
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));

  const all = flags.includes('--all');
  const dryRun = flags.includes('--dry-run');
  const skipRefresh = flags.includes('--skip-refresh');

  const daysFlag = flags.find((a) => a.startsWith('--days='));
  const fallbackDays = daysFlag ? parseInt(daysFlag.split('=')[1], 10) : 1;

  if (!all && positional.length === 0) usage();
  if (all && positional.length > 0) usage();
  if (Number.isNaN(fallbackDays) || fallbackDays <= 0) {
    console.error('❌ --days must be a positive integer.');
    process.exit(1);
  }

  const symbols = all ? [...VALID_SYMBOLS] : [positional[0].toUpperCase()];

  const pool = getPool();
  const r2Client = getR2Client();
  if (!r2Client) {
    console.error('❌ R2 not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
    process.exit(1);
  }

  const svc = new MaterializationService(pool, r2Client);
  const endDate = lastCompleteUtcDay();

  console.log(`\n🔄 Materialize update`);
  console.log(`   Target: ${all ? 'all supported symbols' : symbols[0]}`);
  console.log(`   Fallback days when empty: ${fallbackDays}`);
  console.log(`   Dry run: ${dryRun}`);
  console.log(`   Refresh views after: ${skipRefresh ? 'no' : 'yes'}`);
  console.log(`   End date (cap): ${toDateStr(endDate)}\n`);

  let totalCandles = 0;

  for (const symbol of symbols) {
    console.log(`\n=== ${symbol} ===`);
    const latestDbDay = await svc.getLatestCandleDay(symbol);
    const startDate = latestDbDay
      ? new Date(Date.UTC(latestDbDay.getUTCFullYear(), latestDbDay.getUTCMonth(), latestDbDay.getUTCDate() + 1))
      : new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate() - (fallbackDays - 1)));

    if (startDate > endDate) {
      console.log(`✅ Up to date. Latest DB day: ${latestDbDay ? toDateStr(latestDbDay) : 'none'}`);
      continue;
    }

    console.log(`Planning materialization: ${toDateStr(startDate)} → ${toDateStr(endDate)}`);

    if (dryRun) {
      const hasR2 = await svc.checkR2Coverage(symbol, startDate, endDate);
      console.log(`   R2 coverage: ${hasR2 ? 'available' : 'missing'}`);
      const coverage = await svc.getCandleCoverage(symbol, startDate, endDate);
      console.log(`   Days total: ${coverage.totalDays}, covered in DB: ${coverage.coveredDays}, missing: ${coverage.totalDays - coverage.coveredDays}`);
      if (coverage.missingRanges.length > 0) {
        console.log('   Missing ranges:');
        coverage.missingRanges.forEach(r => console.log(`     ${toDateStr(r.start)} → ${toDateStr(r.end)}`));
      }
      continue;
    }

    const hasR2 = await svc.checkR2Coverage(symbol, startDate, endDate);
    if (!hasR2) {
      console.log('⚠️  No R2 candle data for this range. Skipping.');
      continue;
    }

    const count = await svc.materialize5mCandles(symbol, startDate, endDate);
    totalCandles += count;
  }

  if (!dryRun && !skipRefresh) {
    console.log('\n🔄 Refreshing materialized views...');
    await svc.refreshMaterializedViews();
    console.log('✅ Views refreshed');
  }

  await closePool();

  if (!dryRun) {
    console.log(`\n🎉 Materialize update complete. Total candles inserted/updated: ${totalCandles}`);
  } else {
    console.log(`\n🔍 Dry run complete (no changes made).`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error('Fatal error:', err);
    await closePool();
    process.exit(1);
  });
}
