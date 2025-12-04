#!/usr/bin/env tsx
/**
 * Import command - Imports tick data from Dukascopy to R2 data lake
 *
 * Usage:
 *   npx tsx src/cli/commands/import.ts <SYMBOL> <START_DATE> <END_DATE> [CHUNK_HOURS] [DELAY_SECONDS] [CONCURRENCY] [--local-dir=<path>] [--local-only]
 *
 * Examples:
 *   npx tsx src/cli/commands/import.ts EURUSD 2024-02-01 2024-02-29
 *   npx tsx src/cli/commands/import.ts EURUSD 2024-01-01 2024-12-31 24 0 4
 *   npx tsx src/cli/commands/import.ts EURUSD 2024-01-01 2024-01-07 --local-dir=./data/ticks --local-only
 */
import { type JsonItemTick, getHistoricalRates } from 'dukascopy-node';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import PQueue from 'p-queue';
import { getR2Client, Tick } from '../../services/r2Client.js';

dotenv.config();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Supported Dukascopy instruments (forex pairs)
export const VALID_SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
  'EURGBP', 'EURJPY', 'EURCHF', 'GBPJPY', 'AUDJPY', 'EURAUD', 'GBPAUD'
] as const;

const DUKASCOPY_HTTP_HOST = 'http://datafeed.dukascopy.com';
const DUKASCOPY_USER_AGENT = 'curl/8.7.1';

export type ValidSymbol = typeof VALID_SYMBOLS[number];
type ChunkRange = { start: Date; end: Date };
type ImportDestinationOptions = {
  saveToR2: boolean;
  localDir?: string;
};

/**
 * Import raw tick data from Dukascopy to R2 data lake
 *
 * This is the OPTIMIZED data lake approach:
 * 1. Fetch ticks from Dukascopy
 * 2. Store raw ticks in R2 (cheap storage: $0.015/GB vs $0.15/GB PostgreSQL)
 * 3. Materialize to PostgreSQL candles on-demand (use materialize command)
 */
export class DukascopyToR2Importer {
  private r2Client: ReturnType<typeof getR2Client> = null;
  private readonly saveToR2: boolean;
  private readonly localDir?: string;

  constructor(options?: Partial<ImportDestinationOptions>) {
    this.saveToR2 = options?.saveToR2 !== false;
    this.localDir = options?.localDir ?? process.env.LOCAL_TICKS_DIR;

    if (this.saveToR2) {
      this.r2Client = getR2Client();
      if (!this.r2Client) {
        throw new Error('R2 client not configured. Set R2 credentials in environment.');
      }
    } else {
      this.r2Client = null;
    }

    if (!this.saveToR2 && !this.localDir) {
      throw new Error('No destination configured. Use --local-dir or set LOCAL_TICKS_DIR when disabling R2 uploads.');
    }
  }

  /**
   * Validate symbol is supported by Dukascopy
   */
  private validateSymbol(symbol: string): ValidSymbol {
    const upper = symbol.toUpperCase();
    if (!VALID_SYMBOLS.includes(upper as ValidSymbol)) {
      throw new Error(`Invalid symbol: ${symbol}. Supported: ${VALID_SYMBOLS.join(', ')}`);
    }
    return upper as ValidSymbol;
  }

  /**
   * Fetch historical rates from Dukascopy with retry logic
   */
  private async fetchFromDukascopy(
    symbol: string,
    from: Date,
    to: Date
  ): Promise<Tick[]> {
    const customFetcher = async (url: string): Promise<Buffer> => {
      const httpUrl = url.replace('https://datafeed.dukascopy.com', DUKASCOPY_HTTP_HOST);
      const response = await (globalThis.fetch as any)(httpUrl, {
        headers: { 'user-agent': DUKASCOPY_USER_AGENT }
      });

      if (!response?.ok) {
        throw new Error(`HTTP ${response?.status ?? 'unknown'} for ${httpUrl}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    };

    // Note: getHistoricalRates types don’t expose fetcherFn, so we cast to any.
    const config: any = {
      instrument: symbol.toLowerCase() as any,
      dates: { from, to },
      timeframe: 'tick',
      format: 'json',
      batchSize: 6,
      pauseBetweenBatchesMs: 200,
      useCache: true,
      retryOnEmpty: true,
      retryCount: 2,
      pauseBetweenRetriesMs: 2000,
      failAfterRetryCount: false,
      fetcherFn: customFetcher
    };

    const data = await getHistoricalRates(config) as JsonItemTick[];

    if (!data || data.length === 0) {
      return [];
    }

    // Sanitize ticks from Dukascopy - reject NaNs and invalid prices
    const fromSeconds = from.getTime() / 1000;
    const toSeconds = to.getTime() / 1000;

    const mapped = data.map(tick => ({
      timestamp: typeof tick.timestamp === 'number' ? tick.timestamp / 1000 : NaN,
      bid: typeof tick.bidPrice === 'number' ? tick.bidPrice : NaN,
      ask: typeof tick.askPrice === 'number' ? tick.askPrice : NaN
    }));

    const valid = mapped.filter(t =>
      Number.isFinite(t.timestamp) &&
      Number.isFinite(t.bid) &&
      Number.isFinite(t.ask) &&
      t.bid > 0 &&
      t.ask > 0
    );

    const inRange = valid.filter(t => t.timestamp >= fromSeconds && t.timestamp <= toSeconds);

    const droppedOutOfRange = valid.length - inRange.length;
    if (droppedOutOfRange > 0) {
      console.warn(`   ⚠️  Dropped ${droppedOutOfRange} ticks outside requested window (${from.toISOString()} - ${to.toISOString()})`);
    }

    if (inRange.length === 0) {
      return [];
    }

    const dropped = mapped.length - valid.length;
    if (dropped > 0) {
      console.warn(`   ⚠️  Dropped ${dropped} malformed ticks from Dukascopy`);
    }

    return inRange;
  }

  /**
   * Persist ticks to local disk when configured
   */
  private async saveTicksLocally(symbol: string, date: Date, ticks: Tick[]): Promise<string> {
    if (!this.localDir) {
      throw new Error('Local directory not configured');
    }

    const baseDir = path.resolve(this.localDir);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const dir = path.join(baseDir, symbol, year.toString(), month, day);
    await fs.mkdir(dir, { recursive: true });

    const filename = `part-${Date.now()}.json`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, JSON.stringify(ticks));
    return filePath;
  }

  /**
   * Fetch and upload a time range with adaptive chunk sizing
   * If a large chunk fails with BufferFetcher, automatically retry with smaller chunks
   */
  private async fetchAndUploadWithAdaptiveChunks(
    symbol: string,
    from: Date,
    to: Date,
    currentChunkHours: number
  ): Promise<{ ticks: number; chunks: number }> {
    const isFridayCloseWindow = from.getUTCDay() === 5 && from.getUTCHours() >= 21;
    const isSaturday = from.getUTCDay() === 6;
    const isSundayBeforeOpen = from.getUTCDay() === 0 && from.getUTCHours() < 22;

    if (isFridayCloseWindow || isSaturday || isSundayBeforeOpen) {
      const label = `${from.toISOString().slice(0, 16)} to ${to.toISOString().slice(0, 16)}`;
      console.log(`   ⏭️  Skipping ${label} (weekend close window)`);
      return { ticks: 0, chunks: 0 };
    }

    try {
      const ticks = await this.fetchFromDukascopy(symbol, from, to);

      if (ticks.length === 0) {
        return { ticks: 0, chunks: 0 };
      }

      const partitionDate = new Date(from);
      const destinations: string[] = [];

      if (this.saveToR2 && this.r2Client) {
        const key = await this.r2Client.uploadTicks(symbol, partitionDate, ticks);
        const keySuffix = key.split('/').slice(-4).join('/');
        destinations.push(`R2:${keySuffix}`);
      }

      if (this.localDir) {
        const localPath = await this.saveTicksLocally(symbol, partitionDate, ticks);
        const rel = path.relative(process.cwd(), localPath);
        destinations.push(`local:${rel}`);
      }

      console.log(`   ✅ Fetched ${ticks.length.toLocaleString()} ticks → ${destinations.join(' | ')}`);

      return { ticks: ticks.length, chunks: 1 };

    } catch (error: any) {
      const isBufferFetcher = error.message?.includes('BufferFetcher') || error.stack?.includes('BufferFetcher');

      if (!isBufferFetcher) {
        throw error;
      }

      if (currentChunkHours <= 1) {
        const timeStr = from.toISOString().slice(11, 16);
        console.log(`   ⏭️  Skipping ${from.toISOString().split('T')[0]} ${timeStr} (no data)`);
        return { ticks: 0, chunks: 0 };
      }

      const smallerChunk = 1;
      console.log(`   🔄 Retrying ${from.toISOString().slice(0, 16)} to ${to.toISOString().slice(0, 16)} with ${smallerChunk}h chunks...`);

      let totalTicks = 0;
      let totalChunks = 0;
      let current = new Date(from);

      while (current < to) {
        const subChunkEnd = new Date(current);
        subChunkEnd.setTime(current.getTime() + smallerChunk * 60 * 60 * 1000 - 1);

        if (subChunkEnd > to) {
          subChunkEnd.setTime(to.getTime());
        }

        const result = await this.fetchAndUploadWithAdaptiveChunks(symbol, current, subChunkEnd, smallerChunk);
        totalTicks += result.ticks;
        totalChunks += result.chunks;

        current.setTime(subChunkEnd.getTime() + 1);
      }

      return { ticks: totalTicks, chunks: totalChunks };
    }
  }

  /**
   * Build chunk schedule while respecting market hours/weekend closures
   */
  private buildChunkSchedule(start: Date, end: Date, chunkHours: number): ChunkRange[] {
    const chunks: ChunkRange[] = [];
    let currentDate = new Date(start);

    while (currentDate <= end) {
      const dayOfWeek = currentDate.getUTCDay();
      const hour = currentDate.getUTCHours();

      const isSaturday = dayOfWeek === 6;
      const isSundayBeforeOpen = dayOfWeek === 0 && hour < 22;
      const isFridayClose = dayOfWeek === 5 && hour >= 21;

      if (isFridayClose) {
        const skipLabel = currentDate.toISOString().slice(0, 16);
        console.log(`⏭️  Skipping ${skipLabel} (market closed - Friday close)`);
        const sundayOpen = new Date(currentDate);
        sundayOpen.setUTCDate(sundayOpen.getUTCDate() + 2);
        sundayOpen.setUTCHours(22, 0, 0, 0);
        currentDate = sundayOpen;
        continue;
      }

      if (isSaturday || isSundayBeforeOpen) {
        const skipLabel = currentDate.toISOString().slice(0, 16);
        console.log(`⏭️  Skipping ${skipLabel} (market closed)`);

        if (isSaturday) {
          currentDate.setUTCDate(currentDate.getUTCDate() + 1);
          currentDate.setUTCHours(22, 0, 0, 0);
        } else {
          currentDate.setUTCHours(22, 0, 0, 0);
        }
        continue;
      }

      const chunkStart = new Date(currentDate);
      const chunkEnd = new Date(currentDate);
      chunkEnd.setTime(currentDate.getTime() + chunkHours * 60 * 60 * 1000 - 1);

      const chunkDayOfWeek = currentDate.getUTCDay();
      if (chunkDayOfWeek === 5 && chunkEnd.getUTCHours() >= 21) {
        chunkEnd.setUTCHours(20, 59, 59, 999);
      }

      const endOfDay = new Date(currentDate);
      endOfDay.setUTCHours(23, 59, 59, 999);
      if (chunkEnd > endOfDay) {
        chunkEnd.setTime(endOfDay.getTime());
      }

      if (chunkEnd > end) {
        chunkEnd.setTime(end.getTime());
      }

      chunks.push({ start: chunkStart, end: new Date(chunkEnd) });

      const wasEndOfDay = chunkEnd.getUTCHours() === 23 && chunkEnd.getUTCMinutes() === 59;
      const wasFridayClose = chunkDayOfWeek === 5 && chunkEnd.getUTCHours() === 20 && chunkEnd.getUTCMinutes() === 59;

      if (wasEndOfDay || wasFridayClose) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        currentDate.setUTCHours(0, 0, 0, 0);
      } else {
        currentDate.setTime(chunkEnd.getTime() + 1);
      }
    }

    return chunks;
  }

  /**
   * Import tick data for a date range from Dukascopy to R2
   */
  async import(
    symbol: string,
    startDate: Date,
    endDate: Date,
    chunkHours: number = 24,
    delaySeconds: number = 0,
    concurrency: number = 3
  ): Promise<void> {
    const validatedSymbol = this.validateSymbol(symbol);

    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    const requestedEnd = new Date(endDate);
    requestedEnd.setUTCHours(23, 59, 59, 999);

    // Clamp to last fully available UTC day to avoid asking Dukascopy for future/partial data
    const nowUtc = new Date();
    const lastCompleteDay = new Date(Date.UTC(
      nowUtc.getUTCFullYear(),
      nowUtc.getUTCMonth(),
      nowUtc.getUTCDate() - 1,
      23, 59, 59, 999
    ));

    let end = requestedEnd;
    if (requestedEnd > lastCompleteDay) {
      end = lastCompleteDay;
      console.log(`⚠️  End date capped to last complete UTC day: ${end.toISOString().split('T')[0]}`);
    }

    if (start > end) {
      console.log(`⚠️  Requested range is beyond available data. Nothing to import (start ${start.toISOString().split('T')[0]} > end ${end.toISOString().split('T')[0]}).`);
      return;
    }

    if (start.toISOString().split('T')[0] === end.toISOString().split('T')[0]) {
      const dayOfWeek = start.getUTCDay();
      if (dayOfWeek === 6) {
        console.log(`⚠️  Cannot import Saturday: ${start.toISOString().split('T')[0]}`);
        console.log(`   Forex markets are closed on Saturdays.`);
        return;
      }
    }

    const destinationLabels: string[] = [];
    if (this.saveToR2) destinationLabels.push('R2');
    if (this.localDir) destinationLabels.push(`local:${path.resolve(this.localDir)}`);
    const destinationText = destinationLabels.join(' & ');

    console.log(`\n📦 Importing ${validatedSymbol} from Dukascopy → ${destinationText}`);
    console.log(`   From: ${start.toISOString()}`);
    console.log(`   To: ${end.toISOString()}`);
    console.log(`   Chunk size: ${chunkHours} hour(s)`);
    console.log(`   Concurrency: ${concurrency} chunk(s) in parallel`);
    console.log(`   Delay between chunks: ${delaySeconds} second(s)`);
    console.log(`   Destinations: ${destinationLabels.join(', ')}`);
    console.log(`   NOTE: All times are UTC\n`);

    const uvThreadpool = Number(process.env.UV_THREADPOOL_SIZE ?? '4');
    if (concurrency > 1 && (Number.isNaN(uvThreadpool) || uvThreadpool < 32)) {
      const displayValue = Number.isNaN(uvThreadpool) ? 'default(4)' : uvThreadpool;
      console.log(`⚠️  UV_THREADPOOL_SIZE=${displayValue} may bottleneck DNS lookups. Set to 64-128 for best throughput when running concurrent chunks.`);
    }

    const chunks = this.buildChunkSchedule(start, end, chunkHours);

    if (chunks.length === 0) {
      console.log('✅ Nothing to import after skipping market closures.');
      return;
    }

    let processedChunks = 0;
    let totalTicks = 0;

    const queue = new PQueue({ concurrency });

    chunks.forEach((chunk, index) => {
      queue.add(async () => {
        const chunkLabel = `${chunk.start.toISOString().slice(0, 16)} to ${chunk.end.toISOString().slice(0, 16)}`;
        console.log(`\n📦 Chunk ${index + 1}/${chunks.length}: ${chunkLabel}`);

        try {
          const result = await this.fetchAndUploadWithAdaptiveChunks(
            validatedSymbol,
            chunk.start,
            chunk.end,
            chunkHours
          );

          totalTicks += result.ticks;
          processedChunks += result.chunks;

          if (result.ticks === 0) {
            console.log(`   ⚠️  No data found for this chunk`);
          }

        } catch (error: any) {
          const isNetworkError = error.message?.includes('ENOTFOUND') ||
                                error.message?.includes('getaddrinfo') ||
                                error.message?.includes('EAI_AGAIN') ||
                                error.message?.includes('ETIMEDOUT') ||
                                error.message?.includes('ECONNREFUSED') ||
                                error.message?.includes('network') ||
                                error.message?.includes('socket hang up');

          if (isNetworkError) {
            console.error(`   ⚠️  Network error (will retry):`, error.message);
            console.log(`   ⏸️  Waiting 30 seconds before retry...`);
            await sleep(30000);

            try {
              const result = await this.fetchAndUploadWithAdaptiveChunks(
                validatedSymbol,
                chunk.start,
                chunk.end,
                chunkHours
              );
              totalTicks += result.ticks;
              processedChunks += result.chunks;
            } catch (retryError: any) {
              console.error(`   ❌ Retry failed:`, retryError.message);
              console.log(`   ⏭️  Skipping chunk after retry failure`);
            }
          } else {
            console.error(`   ❌ Error:`, error.message);
            throw error;
          }
        }

        if (delaySeconds > 0) {
          await sleep(delaySeconds * 1000);
        }
      });
    });

    await queue.onIdle();

    console.log(`\n🎉 Import complete!`);
    console.log(`   Chunks processed: ${processedChunks}`);
    console.log(`   Total ticks uploaded: ${totalTicks.toLocaleString()}`);
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const nonFlagArgs = args.filter(a => !a.startsWith('--'));
  const flagArgs = args.filter(a => a.startsWith('--'));

  if (nonFlagArgs.length < 3) {
    console.error('Usage: npx tsx src/cli/commands/import.ts <SYMBOL> <START_DATE> <END_DATE> [CHUNK_HOURS] [DELAY_SECONDS] [CONCURRENCY] [--local-dir=<path>] [--local-only]');
    console.error('');
    console.error('Arguments:');
    console.error('  SYMBOL         - Forex pair (e.g., EURUSD, GBPUSD)');
    console.error('  START_DATE     - Start date in YYYY-MM-DD format');
    console.error('  END_DATE       - End date in YYYY-MM-DD format');
    console.error('  CHUNK_HOURS    - Optional: Hours per chunk (default: 24)');
    console.error('  DELAY_SECONDS  - Optional: Delay between chunks in seconds (default: 0)');
    console.error('  CONCURRENCY    - Optional: Number of chunks to process in parallel (default: 3)');
    console.error('  --local-dir    - Optional: Directory to also write tick JSON (env: LOCAL_TICKS_DIR)');
    console.error('  --local-only   - Optional: Disable R2 upload and save only to local-dir');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/cli/commands/import.ts EURUSD 2024-02-01 2024-02-29');
    console.error('  npx tsx src/cli/commands/import.ts EURUSD 2024-01-01 2024-12-31 24 0 4');
    console.error('  npx tsx src/cli/commands/import.ts EURUSD 2024-01-01 2024-01-07 --local-dir=./data/ticks --local-only');
    process.exit(1);
  }

  const symbol = nonFlagArgs[0].toUpperCase();
  const startDate = new Date(nonFlagArgs[1] + 'T00:00:00Z');
  const endDate = new Date(nonFlagArgs[2] + 'T23:59:59Z');
  const chunkHours = nonFlagArgs[3] ? parseInt(nonFlagArgs[3]) : 24;
  const delaySeconds = nonFlagArgs[4] ? parseInt(nonFlagArgs[4]) : 0;
  const concurrency = nonFlagArgs[5] ? parseInt(nonFlagArgs[5]) : 3;

  const localDirFlag = flagArgs.find(a => a.startsWith('--local-dir='));
  const localDir = localDirFlag ? localDirFlag.split('=')[1] : process.env.LOCAL_TICKS_DIR;
  const localOnly = flagArgs.includes('--local-only');
  const saveToR2 = !localOnly;

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    console.error('❌ Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  if (isNaN(chunkHours) || chunkHours <= 0) {
    console.error('❌ Invalid chunk hours. Must be a positive number.');
    process.exit(1);
  }

  if (isNaN(delaySeconds) || delaySeconds < 0) {
    console.error('❌ Invalid delay seconds. Must be zero or positive.');
    process.exit(1);
  }

  if (isNaN(concurrency) || concurrency <= 0) {
    console.error('❌ Invalid concurrency. Must be a positive number.');
    process.exit(1);
  }

  if (localOnly && !localDir) {
    console.error('❌ --local-only requires --local-dir or LOCAL_TICKS_DIR');
    process.exit(1);
  }

  const importer = new DukascopyToR2Importer({ saveToR2, localDir });

  try {
    await importer.import(symbol, startDate, endDate, chunkHours, delaySeconds, concurrency);
  } catch (error: any) {
    console.error('\n❌ Fatal error details:');
    console.error('Error message:', error.message);
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
