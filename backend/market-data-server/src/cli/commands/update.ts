#!/usr/bin/env tsx
/**
 * Update command - Fetches the newest available data for a symbol (or all symbols)
 * by continuing from the last day present in R2.
 *
 * Usage:
 *   npx tsx src/cli/commands/update.ts <SYMBOL> [--days=<n>] [--chunk-hours=<n>] [--delay-seconds=<n>] [--concurrency=<n>] [--local-dir=<path>] [--local-only] [--dry-run]
 *   npx tsx src/cli/commands/update.ts --all [--days=<n>] [--chunk-hours=<n>] [--delay-seconds=<n>] [--concurrency=<n>] [--local-dir=<path>] [--local-only] [--dry-run]
 *
 * Examples:
 *   npx tsx src/cli/commands/update.ts EURUSD --days=3
 *   npx tsx src/cli/commands/update.ts --all --chunk-hours=12 --concurrency=2
 */
import dotenv from 'dotenv';
import { ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { DukascopyToR2Importer, VALID_SYMBOLS } from './import.js';
import { getR2Client } from '../../services/r2Client.js';

dotenv.config();

function usage(): void {
  console.error('Usage:');
  console.error('  npx tsx src/cli/commands/update.ts <SYMBOL> [--days=<n>] [--chunk-hours=<n>] [--delay-seconds=<n>] [--concurrency=<n>] [--local-dir=<path>] [--local-only] [--dry-run]');
  console.error('  npx tsx src/cli/commands/update.ts --all [--days=<n>] [--chunk-hours=<n>] [--delay-seconds=<n>] [--concurrency=<n>] [--local-dir=<path>] [--local-only] [--dry-run]');
  console.error('');
  console.error('Notes:');
  console.error('  - You must specify a symbol or --all.');
  console.error('  - --days is used only when the symbol has no data in R2 yet (fallback window).');
  process.exit(1);
}

function buildTicksPrefix(): string {
  const assetType = process.env.R2_ASSET_TYPE?.trim().toLowerCase();
  const baseTicksPrefix = process.env.TICKS_PREFIX || 'ticks';
  return assetType ? `${baseTicksPrefix}/${assetType}` : baseTicksPrefix;
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

/**
 * Find the most recent UTC date that has tick files for the symbol.
 */
async function findLatestTickDate(
  bucket: string,
  ticksPrefix: string,
  symbol: string
): Promise<Date | null> {
  const r2Client = getR2Client();
  if (!r2Client) {
    throw new Error('R2 client not configured. Set R2 credentials in environment.');
  }

  const s3 = r2Client.s3Client;
  const prefix = `${ticksPrefix}/${symbol}/`;
  let continuationToken: string | undefined;
  let latest: Date | null = null;

  do {
    const resp: ListObjectsV2CommandOutput = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken
    }));

    for (const obj of resp.Contents || []) {
      if (!obj.Key) continue;
      const parts = obj.Key.split('/');
      const symbolIndex = parts.findIndex((p) => p.toUpperCase() === symbol.toUpperCase());
      if (symbolIndex === -1 || symbolIndex + 3 >= parts.length) continue;

      const [yearStr, monthStr, dayStr] = parts.slice(symbolIndex + 1, symbolIndex + 4);
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);
      if ([year, month, day].some((n) => Number.isNaN(n))) continue;

      const candidate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      if (!latest || candidate > latest) {
        latest = candidate;
      }
    }

    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);

  return latest;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagArgs = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));

  const all = flagArgs.includes('--all');
  const dryRun = flagArgs.includes('--dry-run');
  const localOnly = flagArgs.includes('--local-only');

  const daysFlag = flagArgs.find((a) => a.startsWith('--days='));
  const chunkFlag = flagArgs.find((a) => a.startsWith('--chunk-hours='));
  const delayFlag = flagArgs.find((a) => a.startsWith('--delay-seconds='));
  const concurrencyFlag = flagArgs.find((a) => a.startsWith('--concurrency='));
  const localDirFlag = flagArgs.find((a) => a.startsWith('--local-dir='));

  const fallbackDays = daysFlag ? parseInt(daysFlag.split('=')[1], 10) : 1;
  const chunkHours = chunkFlag ? parseInt(chunkFlag.split('=')[1], 10) : 24;
  const delaySeconds = delayFlag ? parseInt(delayFlag.split('=')[1], 10) : 0;
  const concurrency = concurrencyFlag ? parseInt(concurrencyFlag.split('=')[1], 10) : 3;
  const localDir = localDirFlag ? localDirFlag.split('=')[1] : process.env.LOCAL_TICKS_DIR;
  const saveToR2 = !localOnly;

  if (!all && positional.length === 0) {
    usage();
  }
  if (all && positional.length > 0) {
    console.error('❌ Do not mix positional symbol with --all. Choose one.');
    usage();
  }

  if (Number.isNaN(fallbackDays) || fallbackDays <= 0) {
    console.error('❌ --days must be a positive integer.');
    process.exit(1);
  }
  if (Number.isNaN(chunkHours) || chunkHours <= 0) {
    console.error('❌ --chunk-hours must be a positive integer.');
    process.exit(1);
  }
  if (Number.isNaN(delaySeconds) || delaySeconds < 0) {
    console.error('❌ --delay-seconds must be zero or positive.');
    process.exit(1);
  }
  if (Number.isNaN(concurrency) || concurrency <= 0) {
    console.error('❌ --concurrency must be a positive integer.');
    process.exit(1);
  }
  if (localOnly && !localDir) {
    console.error('❌ --local-only requires --local-dir or LOCAL_TICKS_DIR');
    process.exit(1);
  }

  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    console.error('❌ R2_BUCKET_NAME not set');
    process.exit(1);
  }

  const ticksPrefix = buildTicksPrefix();
  const symbols = all ? [...VALID_SYMBOLS] : [positional[0].toUpperCase()];

  const importer = new DukascopyToR2Importer({ saveToR2, localDir });
  const endDate = lastCompleteUtcDay();

  console.log(`\n🔄 Update mode`);
  console.log(`   Target: ${all ? 'all supported symbols' : symbols[0]}`);
  console.log(`   Fallback days when empty: ${fallbackDays}`);
  console.log(`   Chunk hours: ${chunkHours}`);
  console.log(`   Concurrency: ${concurrency}`);
  console.log(`   Delay seconds: ${delaySeconds}`);
  console.log(`   Dry run: ${dryRun}`);
  console.log(`   Destinations: ${saveToR2 ? 'R2' : ''}${localOnly ? 'local-only' : localDir ? `, local:${localDir}` : ''}\n`);

  for (const symbol of symbols) {
    console.log(`\n=== ${symbol} ===`);
    const latest = await findLatestTickDate(bucket, ticksPrefix, symbol);

    let startDate: Date;
    if (latest) {
      startDate = new Date(latest);
      startDate.setUTCDate(startDate.getUTCDate() + 1);
    } else {
      const fallbackStart = new Date(endDate);
      fallbackStart.setUTCDate(fallbackStart.getUTCDate() - (fallbackDays - 1));
      startDate = fallbackStart;
    }

    // Normalize times
    startDate.setUTCHours(0, 0, 0, 0);

    if (startDate > endDate) {
      console.log(`✅ Up to date. Latest day in R2: ${latest ? toDateStr(latest) : 'none'}`);
      continue;
    }

    console.log(`Planning import: ${toDateStr(startDate)} → ${toDateStr(endDate)}`);
    if (dryRun) {
      console.log('Dry run only. Skipping import.');
      continue;
    }

    try {
      await importer.import(symbol, startDate, endDate, chunkHours, delaySeconds, concurrency);
    } catch (error: any) {
      console.error(`❌ Failed to update ${symbol}:`, error.message || error);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
