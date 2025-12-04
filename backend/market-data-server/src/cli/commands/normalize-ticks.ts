#!/usr/bin/env tsx
/**
 * Normalize ticks from source timezone to UTC, preserving raw data.
 *
 * - Reads ticks from a source prefix (default: ticks-raw or ticks)
 * - Applies source timezone from config/timezones.yaml (per broker/symbol with defaults)
 * - Writes normalized ticks to a destination prefix (default: ticks-normalized)
 * - Emits a manifest alongside each batch
 *
 * Usage:
 *   npx tsx src/cli/commands/normalize-ticks.ts <SYMBOL> <START_DATE> <END_DATE> [--source-prefix=<prefix>] [--dest-prefix=<prefix>] [--broker=<name>] [--dry-run]
 *
 * Example:
 *   npx tsx src/cli/commands/normalize-ticks.ts AUDUSD 2024-01-01 2024-12-31 --source-prefix=ticks --dest-prefix=ticks-normalized --broker=dukascopy
 */
import dotenv from 'dotenv';
import { DateTime } from 'luxon';
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

interface TimeConfig {
  source_tz?: string;
}

function loadConfig(): TimeConfig {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // Locate config relative to project root to avoid cwd issues
  const candidatePaths = [
    path.join(process.cwd(), 'config', 'timezones.yaml'),
    path.join(__dirname, '..', '..', '..', 'config', 'timezones.yaml')
  ];
  for (const configPath of candidatePaths) {
    if (fs.existsSync(configPath)) {
      const parsed = YAML.parse(fs.readFileSync(configPath, 'utf8')) || {};
      return parsed;
    }
  }
  return {};
}

function getSourceTz(config: any, broker?: string): string {
  if (broker && config?.brokers?.[broker]?.source_tz) {
    return config.brokers[broker].source_tz;
  }
  if (config?.defaults?.source_tz) return config.defaults.source_tz;
  return 'UTC';
}

function toDate(d: string): Date {
  const parsed = new Date(d + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${d}`);
  }
  return parsed;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function streamToString(stream: any): Promise<string> {
  if (typeof stream.transformToString === 'function') {
    return stream.transformToString();
  }
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function listKeysForDay(s3: S3Client, bucket: string, prefix: string, symbol: string, date: Date): Promise<string[]> {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const fullPrefix = `${prefix}/${symbol}/${year}/${month}/${day}/`;

  const keys: string[] = [];
  let token: string | undefined;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: fullPrefix,
      ContinuationToken: token
    }));
    for (const obj of resp.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = resp.NextContinuationToken;
  } while (token);
  return keys;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: npx tsx src/cli/commands/normalize-ticks.ts <SYMBOL> <START_DATE> <END_DATE> [--source-prefix=<prefix>] [--dest-prefix=<prefix>] [--broker=<name>] [--dry-run]');
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  const startDate = toDate(args[1]);
  const endDate = toDate(args[2]);
  const sourcePrefix = (args.find(a => a.startsWith('--source-prefix=')) || '').split('=')[1] || 'ticks';
  const destPrefix = (args.find(a => a.startsWith('--dest-prefix=')) || '').split('=')[1] || 'ticks-normalized';
  const broker = (args.find(a => a.startsWith('--broker=')) || '').split('=')[1] || 'dukascopy';
  const dryRun = args.includes('--dry-run');

  const bucket = process.env.R2_BUCKET_NAME || 'data-lake';
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error('Missing R2 credentials');
    process.exit(1);
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey }
  });

  const config = loadConfig();
  const sourceTz = getSourceTz(config, broker);
  if (sourceTz === 'UTC') {
    console.warn('⚠️  Source timezone resolved to UTC (config not found?). Using UTC; offsets will be 0.');
  }

  console.log(`\n🌐 Normalizing ticks for ${symbol}`);
  console.log(`   Range: ${formatDate(startDate)} → ${formatDate(endDate)}`);
  console.log(`   Source TZ: ${sourceTz}`);
  console.log(`   Source prefix: ${sourcePrefix}`);
  console.log(`   Dest prefix: ${destPrefix}`);
  console.log(`   Broker: ${broker}`);
  console.log(`   Bucket: ${bucket}`);
  console.log(`   Dry run: ${dryRun}\n`);

  let totalDays = 0;
  let writtenBatches = 0;

  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = new Date(d);
    totalDays++;
    const keys = await listKeysForDay(s3, bucket, sourcePrefix, symbol, day);
    if (keys.length === 0) continue;

    // Bucket by DESTINATION UTC day after normalization
    const buckets: Record<string, { ticks: any[]; offsets: Set<number> }> = {};

    for (const key of keys) {
      const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!resp.Body) continue;
      const body = await streamToString(resp.Body);
      const ticks = JSON.parse(body);

      for (const tick of ticks) {
        const dtLocal = DateTime.fromSeconds(tick.timestamp, { zone: sourceTz });
        const dtUtc = dtLocal.toUTC();
        const destDate = dtUtc.toISODate(); // UTC day after normalization
        if (!destDate) continue; // should not happen, but guard

        if (!buckets[destDate]) buckets[destDate] = { ticks: [], offsets: new Set<number>() };
        buckets[destDate]!.offsets.add(dtLocal.offset);
        buckets[destDate]!.ticks.push({ ...tick, timestamp: dtUtc.toSeconds() });
      }
    }

    for (const [destDate, data] of Object.entries(buckets)) {
      const [y, m, dd] = destDate.split('-');
      const destKey = `${destPrefix}/${symbol}/${y}/${m}/${dd}/part-${Date.now()}.json`;

      data.ticks.sort((a, b) => a.timestamp - b.timestamp);

      if (dryRun) {
        console.log(`[DRY] ${destDate}: would write ${data.ticks.length} ticks to ${destKey}`);
        continue;
      }

      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: destKey,
        Body: JSON.stringify(data.ticks),
        ContentType: 'application/json'
      }));

      const manifest = {
        symbol,
        source_prefix: sourcePrefix,
        dest_prefix: destPrefix,
        source_tz: sourceTz,
        date_utc: destDate,
        offsets_applied_minutes: Array.from(data.offsets.values()),
        count: data.ticks.length,
        first_utc: data.ticks[0] ? DateTime.fromSeconds(data.ticks[0].timestamp).toUTC().toISO() : null,
        last_utc: data.ticks[data.ticks.length - 1] ? DateTime.fromSeconds(data.ticks[data.ticks.length - 1].timestamp).toUTC().toISO() : null,
        checksum_sha1: crypto.createHash('sha1').update(JSON.stringify(data.ticks)).digest('hex'),
        generated_at: new Date().toISOString()
      };

      const manifestKey = destKey.replace(/part-.*\\.json$/, `manifest-${Date.now()}.json`);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: manifestKey,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: 'application/json'
      }));

      writtenBatches++;
      console.log(`✅ ${destDate}: wrote ${data.ticks.length} ticks → ${destKey} (offsets: ${Array.from(data.offsets.values()).join(',')})`);
    }
  }

  console.log(`\nDone. Days scanned: ${totalDays}. Batches written: ${writtenBatches}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
