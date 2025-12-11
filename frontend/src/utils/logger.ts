// Lightweight logger for browser console with simple redaction

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const SENSITIVE_KEYS = new Set([
  'token',
  'accessToken',
  'authorization',
  'cookie',
  'password',
  'secret',
  'apiKey',
  'api_key',
  'session',
  'sessionId',
  'session_id',
]);

const globalLevel =
  LEVEL_ORDER[(import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'info'] ?? LEVEL_ORDER.info;

function sanitize(value: any, depth = 0): any {
  if (depth > 3) return '[Object]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));

  const safe: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      safe[key] = '[REDACTED]';
    } else {
      safe[key] = sanitize(val, depth + 1);
    }
  }
  return safe;
}

function log(level: LogLevel, namespace: string, args: any[]) {
  if (LEVEL_ORDER[level] > globalLevel) return;
  const method =
    level === 'debug'
      ? console.debug
      : level === 'info'
      ? console.info
      : level === 'warn'
      ? console.warn
      : console.error;

  const prefix = `[SPtraderB][${namespace}]`;
  const safeArgs = args.map((arg) => sanitize(arg));
  method(prefix, ...safeArgs);
}

export function createLogger(namespace: string) {
  return {
    error: (...args: any[]) => log('error', namespace, args),
    warn: (...args: any[]) => log('warn', namespace, args),
    info: (...args: any[]) => log('info', namespace, args),
    debug: (...args: any[]) => log('debug', namespace, args),
  };
}
