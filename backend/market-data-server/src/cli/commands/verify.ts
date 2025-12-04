#!/usr/bin/env tsx
/**
 * Verify command - sanity checks R2 tick/candle coverage and integrity
 *
 * Usage:
 *   npx tsx src/cli/commands/verify.ts <SYMBOL> <START_DATE> <END_DATE> [--ticks-only] [--candles-only]
 *
 * Examples:
 *   npx tsx src/cli/commands/verify.ts EURUSD 2024-01-01 2024-12-31
 *   npx tsx src/cli/commands/verify.ts EURUSD 2024-01-01 2024-12-31 --ticks-only
 */
import dotenv from 'dotenv';
import { ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { getR2Client, Candle } from '../../services/r2Client.js';

dotenv.config();

type Mode = 'ticks' | 'candles';

function usage(): void {
  console.log('Usage: npx tsx src/cli/commands/verify.ts <SYMBOL> <START_DATE> <END_DATE> [--ticks-only] [--candles-only]');
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx src/cli/commands/verify.ts EURUSD 2024-01-01 2024-12-31');
  console.log('  npx tsx src/cli/commands/verify.ts EURUSD 2024-01-01 2024-12-31 --ticks-only');
}

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function expectedBarsForDay(d: Date): number {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return 0; // weekend
  if (dow === 5) return 22 * 12; // Friday close at 22:00 UTC -> 264 bars
  return 24 * 12; // 288 bars Monday-Thursday
}

function* iterateDays(start: Date, end: Date): Generator<Date> {
  const current = new Date(start);
  while (current <= end) {
    yield new Date(current);
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

function parseTickKey(key: string): { symbol: string; year: number; month: number; day: number } | null {
  const parts = key.split('/');
  if (parts.length !== 6 || parts[0] !== 'ticks') return null;
  const [, symbol, year, month, day] = parts;
  return {
    symbol,
    year: parseInt(year, 10),
    month: parseInt(month, 10),
    day: parseInt(day, 10)
  };
}

function getMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function listTickKeys(r2Client: NonNullable<ReturnType<typeof getR2Client>>, symbol: string): Promise<string[]> {
  const keys: string[] = [];
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
        if (obj.Key && obj.Key.endsWith('.json')) {
          keys.push(obj.Key);
        }
      }
    }
    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

async function listCandleKeysForMonth(
  r2Client: NonNullable<ReturnType<typeof getR2Client>>,
  symbol: string,
  month: string
): Promise<string[]> {
  const [yearStr, monthStr] = month.split('-');
  const date = new Date(Date.UTC(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1));
  return r2Client.listCandleFiles(symbol, date);
}

async function checkTickCoverage(
  r2Client: NonNullable<ReturnType<typeof getR2Client>>,
  symbol: string,
  start: Date,
  end: Date
): Promise<{ missingWeekdays: string[]; missingFridays: string[]; coveredDays: number; expectedWeekdays: number }> {
  const keys = await listTickKeys(r2Client, symbol);
  const presentDates = new Set<string>();

  for (const key of keys) {
    const meta = parseTickKey(key);
    if (!meta) continue;
    const fileDate = new Date(Date.UTC(meta.year, meta.month - 1, meta.day));
    if (fileDate < start || fileDate > end) continue;
    presentDates.add(dateStr(fileDate));
  }

  const missingWeekdays: string[] = [];
  const missingFridays: string[] = [];
  let expectedWeekdays = 0;

  for (const day of iterateDays(start, end)) {
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    expectedWeekdays++;
    const ds = dateStr(day);
    if (!presentDates.has(ds)) {
      missingWeekdays.push(ds);
      if (dow === 5) missingFridays.push(ds);
    }
  }

  return {
    missingWeekdays,
    missingFridays,
    coveredDays: presentDates.size,
    expectedWeekdays
  };
}

function validateCandleValues(c: Candle): string | null {
  const nums = [c.open, c.high, c.low, c.close, c.volume, c.trades];
  if (nums.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return 'Non-finite candle values';
  }
  if (!(c.time instanceof Date) || Number.isNaN(c.time.getTime())) {
    return 'Invalid candle timestamp';
  }
  if (c.high < c.low) {
    return 'High < low';
  }
  const maxPrice = Math.max(c.open, c.close);
  const minPrice = Math.min(c.open, c.close);
  if (c.high < maxPrice || c.low > minPrice) {
    return 'OHLC inconsistent with high/low';
  }
  return null;
}

async function checkCandleIntegrity(
  r2Client: NonNullable<ReturnType<typeof getR2Client>>,
  symbol: string,
  start: Date,
  end: Date
): Promise<{ issues: string[]; summary: Record<string, { bars: number; expected: number }> }> {
  const months = new Set<string>();
  for (const d of iterateDays(start, end)) {
    months.add(getMonthKey(d));
  }

  const dayBars = new Map<string, Candle[]>();
  const issues: string[] = [];

  for (const month of months) {
    const keys = await listCandleKeysForMonth(r2Client, symbol, month);
    for (const key of keys) {
      const candles = await r2Client.downloadCandleFile(key);
      for (const candle of candles) {
        const ds = dateStr(candle.time);
        const candleDate = new Date(ds + 'T00:00:00Z');
        if (candleDate < start || candleDate > end) continue;
        const err = validateCandleValues(candle);
        if (err) {
          issues.push(`${ds}: ${err} (key: ${key})`);
          continue;
        }
        if (!dayBars.has(ds)) dayBars.set(ds, []);
        dayBars.get(ds)!.push(candle);
      }
    }
  }

  const summary: Record<string, { bars: number; expected: number }> = {};
  for (const day of iterateDays(start, end)) {
    const ds = dateStr(day);
    const expected = expectedBarsForDay(day);
    const bars = dayBars.get(ds)?.length || 0;
    summary[ds] = { bars, expected };

    if (expected === 0) continue; // weekend, skip

    if (bars === 0) {
      issues.push(`${ds}: no candles found`);
      continue;
    }

    const dayCandles = dayBars.get(ds)!;
    dayCandles.sort((a, b) => a.time.getTime() - b.time.getTime());

    // Deduplicate identical timestamps (track duplicates as issues)
    const unique: Candle[] = [];
    const seen = new Set<number>();
    let duplicateCount = 0;
    for (const c of dayCandles) {
      const t = c.time.getTime();
      if (seen.has(t)) {
        duplicateCount++;
        continue;
      }
      seen.add(t);
      unique.push(c);
    }
    if (duplicateCount > 0) {
      issues.push(`${ds}: ${duplicateCount} duplicate candles`);
    }

    // Check gaps/step alignment on unique candles
    let stepIssues = 0;
    for (let i = 1; i < unique.length; i++) {
      const deltaMs = unique[i].time.getTime() - unique[i - 1].time.getTime();
      if (deltaMs !== 300000) {
        stepIssues++;
      }
    }
    if (stepIssues > 0) {
      issues.push(`${ds}: ${stepIssues} non-5m gaps/overlaps`);
    }

    // Check count with tolerance (allow small holiday gaps)
    if (unique.length < expected * 0.95) {
      issues.push(`${ds}: only ${unique.length}/${expected} candles (${((unique.length / expected) * 100).toFixed(1)}%)`);
    }
  }

  return { issues, summary };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    usage();
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  const startDate = new Date(args[1] + 'T00:00:00Z');
  const endDate = new Date(args[2] + 'T23:59:59Z');
  const ticksOnly = args.includes('--ticks-only');
  const candlesOnly = args.includes('--candles-only');

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    console.error('Invalid date(s). Use YYYY-MM-DD');
    process.exit(1);
  }

  const modes: Mode[] = [];
  if (ticksOnly && candlesOnly) {
    console.error('Choose at most one of --ticks-only or --candles-only');
    process.exit(1);
  }
  if (ticksOnly) modes.push('ticks');
  if (candlesOnly) modes.push('candles');
  if (modes.length === 0) modes.push('ticks', 'candles');

  const r2Client = getR2Client();
  if (!r2Client) {
    console.error('R2 not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
    process.exit(1);
  }

  console.log(`\n🔎 Verifying ${symbol} from ${dateStr(startDate)} to ${dateStr(endDate)} (${modes.join(' & ')})\n`);

  let hasIssues = false;

  if (modes.includes('ticks')) {
    console.log('📂 Checking tick coverage...');
    const res = await checkTickCoverage(r2Client, symbol, startDate, endDate);
    console.log(`   Days with ticks: ${res.coveredDays}/${res.expectedWeekdays} weekdays`);
    if (res.missingWeekdays.length > 0) {
      hasIssues = true;
      console.log(`   ❌ Missing weekdays: ${res.missingWeekdays.length}`);
      console.log(`      First 10: ${res.missingWeekdays.slice(0, 10).join(', ')}`);
      console.log(`   ❌ Missing Fridays: ${res.missingFridays.length}`);
      if (res.missingFridays.length) {
        console.log(`      First 5 Fridays: ${res.missingFridays.slice(0, 5).join(', ')}`);
      }
    } else {
      console.log('   ✅ Tick coverage complete for weekdays');
    }
  }

  if (modes.includes('candles')) {
    console.log('\n🕯️  Checking candle integrity...');
    const { issues, summary } = await checkCandleIntegrity(r2Client, symbol, startDate, endDate);

    const totalDays = Object.keys(summary).length;
    const daysWithCandles = Object.values(summary).filter((s) => s.bars > 0).length;
    console.log(`   Days with candles: ${daysWithCandles}/${totalDays}`);

    if (issues.length > 0) {
      hasIssues = true;
      console.log(`   ❌ Issues found: ${issues.length}`);
      for (const line of issues.slice(0, 20)) {
        console.log(`      - ${line}`);
      }
      if (issues.length > 20) {
        console.log(`      ...and ${issues.length - 20} more`);
      }
    } else {
      console.log('   ✅ Candle integrity looks good in range');
    }
  }

  console.log('');
  if (hasIssues) {
    console.log('❌ Verification failed. See details above.');
    process.exit(1);
  } else {
    console.log('✅ Verification passed.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
