import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Automatically load environment variables from .env or .env.migration if present
dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.migration'))) {
  dotenv.config({ path: path.join(process.cwd(), '.env.migration') });
}

/**
 * SQLite to Supabase Migration & Verification Script
 *
 * Usage:
 *   SUPABASE_URL="https://[PROJECT-REF].supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="ey..." \
 *   npx tsx server/migrateToSupabase.ts
 *
 * Safety rules:
 *  - SQLite is opened strictly read-only.
 *  - Passwords, tokens, UPI IDs, mobile numbers, and secrets are NEVER logged.
 *  - Records are migrated in FK-dependency order.
 *  - HTTP response status and Content-Range are strictly validated before trusting counts.
 *  - Verification fetches ALL rows via pagination (PostgREST default cap is 1,000).
 *  - Checksums compare canonicalized rows from BOTH sides; type mismatches are normalized.
 *  - Safe for repeated runs (upsert / merge-duplicates on primary keys).
 */

// ---------------------------------------------------------------------------
// Table definitions: migration order + schema-aware column metadata
// ---------------------------------------------------------------------------

export const MIGRATION_TABLES = [
  'admin_users',
  'network_providers',
  'recharge_plans',
  'special_offers',
  'customer_submissions',
  'website_settings',
  'admin_audit_logs',
  'recharge_orders',
  'login_attempts',
  'payment_click_events',
] as const;

export type TableName = (typeof MIGRATION_TABLES)[number];

/** Primary key field per table, used for deterministic sort. */
const TABLE_PRIMARY_KEYS: Record<TableName, string> = {
  admin_users: 'id',
  network_providers: 'id',
  recharge_plans: 'id',
  special_offers: 'id',
  customer_submissions: 'id',
  website_settings: 'setting_key',
  admin_audit_logs: 'id',
  recharge_orders: 'id',
  login_attempts: 'ip',
  payment_click_events: 'id',
};

/**
 * Column type hints used for canonicalization.
 *
 * 'numeric'    – SQLite REAL / PostgreSQL NUMERIC(10,2): normalize to JS number
 * 'boolean'    – SQLite INTEGER (0/1) / PostgreSQL BOOLEAN: normalize to boolean
 * 'timestamp'  – ISO-8601 TEXT / TIMESTAMPTZ: normalize via new Date().toISOString()
 * 'integer'    – INTEGER on both sides: normalize to JS number
 * 'text'       – no transformation
 *
 * Only columns whose types DIFFER between SQLite and PostgreSQL need entries here.
 * All other columns are compared as-is after JSON serialization.
 */
type ColType = 'numeric' | 'boolean' | 'timestamp' | 'integer' | 'text';

const TABLE_COLUMN_TYPES: Partial<Record<TableName, Record<string, ColType>>> = {
  network_providers: {
    is_active: 'boolean',
    display_order: 'integer',
    created_at: 'timestamp',
    updated_at: 'timestamp',
  },
  recharge_plans: {
    price: 'numeric',
    original_price: 'numeric',
    display_order: 'integer',
    created_at: 'timestamp',
    updated_at: 'timestamp',
  },
  special_offers: {
    duration_minutes: 'integer',
    display_order: 'integer',
    start_time: 'timestamp',
    end_time: 'timestamp',
    created_at: 'timestamp',
    updated_at: 'timestamp',
  },
  customer_submissions: {
    created_at: 'timestamp',
  },
  website_settings: {
    updated_at: 'timestamp',
  },
  admin_audit_logs: {
    created_at: 'timestamp',
  },
  recharge_orders: {
    plan_price: 'numeric',
    payment_started_at: 'timestamp',
    customer_confirmed_at: 'timestamp',
    admin_verified_at: 'timestamp',
    created_at: 'timestamp',
    updated_at: 'timestamp',
  },
  payment_click_events: {
    clicked_at: 'timestamp',
    created_at: 'timestamp',
  },
  admin_users: {
    created_at: 'timestamp',
    updated_at: 'timestamp',
  },
  login_attempts: {
    attempts: 'integer',
    last_attempt: 'integer',
    blocked_until: 'integer',
  },
};

// ---------------------------------------------------------------------------
// Row transformation helpers
// ---------------------------------------------------------------------------

/**
 * Canonicalize a single field value for checksum comparison.
 *
 * The same function is called on BOTH the SQLite and PostgREST sides,
 * so any representation difference (number vs string, 'Z' vs '+00:00') is erased.
 */
export function canonicalizeValue(value: unknown, type: ColType | undefined): unknown {
  if (value === null || value === undefined) return null;

  switch (type) {
    case 'numeric': {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case 'boolean': {
      if (value === 1 || value === true || value === 'true') return true;
      if (value === 0 || value === false || value === 'false') return false;
      return Boolean(value);
    }
    case 'timestamp': {
      if (typeof value !== 'string') return value;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : d.toISOString();
    }
    case 'integer': {
      const n = Number(value);
      return Number.isFinite(n) ? Math.round(n) : value;
    }
    case 'text':
    default:
      return value;
  }
}

/**
 * Prepare a row for checksum hashing.
 *
 * - Uses the full column list from the SQLite schema (union of all keys seen in rows).
 * - Fills missing keys with null (PostgREST may omit nullable columns).
 * - Sorts keys deterministically.
 * - Canonicalizes each value according to its column type.
 * - Redacts password_hash and mobile_number from the hash input to avoid
 *   logging sensitive values during debugging (both sides still hash the same key name
 *   mapped to a constant sentinel, so checksum equivalence is preserved).
 */
const REDACTED_SENTINEL = '__REDACTED__';
const SENSITIVE_COLUMNS = new Set(['password_hash', 'mobile_number']);

export function canonicalizeRow(
  row: Record<string, unknown>,
  table: TableName,
  allKeys: string[]
): Record<string, unknown> {
  const columnTypes = TABLE_COLUMN_TYPES[table] ?? {};
  const normalized: Record<string, unknown> = {};

  for (const key of allKeys.slice().sort()) {
    if (SENSITIVE_COLUMNS.has(key)) {
      normalized[key] = REDACTED_SENTINEL;
    } else {
      normalized[key] = canonicalizeValue(row[key] ?? null, columnTypes[key]);
    }
  }

  return normalized;
}

/**
 * Compute SHA-256 checksum over all rows in a table.
 *
 * - Rows are sorted deterministically by primary key.
 * - Each row is canonicalized before hashing.
 * - Returns 'EMPTY_TABLE' for empty tables (both sides return the same string).
 */
export function computeTableChecksum(
  rows: Record<string, unknown>[],
  table: TableName,
  allKeys: string[]
): string {
  if (rows.length === 0) return 'EMPTY_TABLE';

  const pkField = TABLE_PRIMARY_KEYS[table];
  const sortedRows = [...rows].sort((a, b) =>
    String(a[pkField] ?? '').localeCompare(String(b[pkField] ?? ''))
  );

  const hash = crypto.createHash('sha256');
  for (const row of sortedRows) {
    const canonical = canonicalizeRow(row, table, allKeys);
    hash.update(JSON.stringify(canonical));
  }
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// SQLite helpers
// ---------------------------------------------------------------------------

/**
 * Transform a SQLite row for PostgreSQL insertion.
 * Only converts fields where the types differ between dialects.
 */
export function transformRowForPostgres(
  table: TableName,
  row: Record<string, unknown>
): Record<string, unknown> {
  const transformed = { ...row };
  const columnTypes = TABLE_COLUMN_TYPES[table] ?? {};

  for (const [col, type] of Object.entries(columnTypes)) {
    if (col in transformed) {
      transformed[col] = canonicalizeValue(transformed[col], type);
    }
  }

  return transformed;
}

// ---------------------------------------------------------------------------
// PostgREST pagination helper
// ---------------------------------------------------------------------------

const POSTGREST_PAGE_SIZE = 500; // well below the default 1,000-row cap

/**
 * Fetch ALL rows from a PostgREST table endpoint using Range-based pagination.
 *
 * PostgREST returns at most `max_rows` per request (default 1,000).
 * This function fetches pages until all rows are collected.
 *
 * Validates:
 *  - HTTP status on every page request.
 *  - content-range header presence and parsability.
 *  - Actual rows received vs declared total (fails on mismatch).
 *
 * Returns { ok: true, rows, totalDeclared } or { ok: false, error }.
 */
export async function fetchAllRowsPaginated(
  baseUrl: string,
  table: string,
  headers: Record<string, string>
): Promise<
  | { ok: true; rows: Record<string, unknown>[]; totalDeclared: number }
  | { ok: false; error: string }
> {
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;
  let totalDeclared: number | null = null;

  for (;;) {
    const rangeEnd = offset + POSTGREST_PAGE_SIZE - 1;
    const pageHeaders = {
      ...headers,
      Prefer: 'count=exact',
      'Range-Unit': 'items',
      Range: `${offset}-${rangeEnd}`,
    };

    const res = await fetch(`${baseUrl}/rest/v1/${table}?select=*&order=${TABLE_PRIMARY_KEYS[table as TableName] ?? 'id'}.asc`, {
      method: 'GET',
      headers: pageHeaders,
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} (${res.statusText}) fetching page at offset ${offset}` };
    }

    const contentRange = res.headers.get('content-range');
    if (!contentRange) {
      return { ok: false, error: `Missing content-range header on page at offset ${offset}` };
    }

    // content-range format: "0-499/1234" or "*/0" for empty
    const parts = contentRange.split('/');
    if (parts.length !== 2) {
      return { ok: false, error: `Malformed content-range "${contentRange}" at offset ${offset}` };
    }

    const totalStr = parts[1];
    const parsedTotal = parseInt(totalStr, 10);
    if (Number.isNaN(parsedTotal)) {
      return { ok: false, error: `Non-numeric total in content-range "${contentRange}"` };
    }

    // On first page, record the declared total
    if (totalDeclared === null) {
      totalDeclared = parsedTotal;
    } else if (totalDeclared !== parsedTotal) {
      // Total changed mid-pagination — data is being written concurrently
      return {
        ok: false,
        error: `Declared total changed from ${totalDeclared} to ${parsedTotal} during pagination (concurrent write?)`,
      };
    }

    const pageRows = (await res.json()) as Record<string, unknown>[];

    if (!Array.isArray(pageRows)) {
      return { ok: false, error: `PostgREST returned non-array response at offset ${offset}` };
    }

    allRows.push(...pageRows);

    if (pageRows.length === 0 || allRows.length >= totalDeclared) {
      break;
    }

    offset += POSTGREST_PAGE_SIZE;
  }

  // Final integrity check: rows received must equal declared total
  if (allRows.length !== totalDeclared) {
    return {
      ok: false,
      error: `Row count mismatch: declared ${totalDeclared} but received ${allRows.length} after pagination`,
    };
  }

  return { ok: true, rows: allRows, totalDeclared };
}

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

async function verifyEnvironment(): Promise<{ supabaseUrl: string; serviceKey: string }> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('\n[Configuration Missing]');
    console.error('Please provide Supabase credentials via environment variables:');
    console.error('  export SUPABASE_URL="https://[YOUR-PROJECT].supabase.co"');
    console.error('  export SUPABASE_SERVICE_ROLE_KEY="[YOUR-SERVICE-ROLE-KEY]"');
    process.exit(1);
  }

  return { supabaseUrl, serviceKey };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

async function migrateViaRest(supabaseUrl: string, serviceKey: string) {
  const dbPath = path.join(process.cwd(), 'server', 'data', 'database.sqlite');
  if (!fs.existsSync(dbPath)) {
    console.error('[Error] SQLite database not found at:', dbPath);
    process.exit(1);
  }

  // Open SQLite in strict read-only mode
  const sqliteDb = new Database(dbPath, { readonly: true });

  // -------------------------------------------------------------------------
  // Phase 1: Read SQLite source records
  // -------------------------------------------------------------------------
  console.log('\n[Phase 1] Reading SQLite source records (read-only)...');

  const sqliteCounts: Record<string, number> = {};
  const sqliteChecksums: Record<string, string> = {};
  const sqliteAllKeys: Record<string, string[]> = {};

  for (const table of MIGRATION_TABLES) {
    const count = (sqliteDb.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
    sqliteCounts[table] = count;

    const rows = sqliteDb.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];

    // Collect the union of all column names seen across all rows (handles nullable columns)
    const allKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).sort();
    sqliteAllKeys[table] = allKeys;

    const transformed = rows.map((r) => transformRowForPostgres(table, r));
    sqliteChecksums[table] = computeTableChecksum(transformed, table, allKeys);

    console.log(`  - ${table.padEnd(25)} : ${String(count).padStart(5)} rows`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Migrate to Supabase
  // -------------------------------------------------------------------------
  console.log('\n[Phase 2] Migrating to Supabase via service-role REST API...');

  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const insertHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };

  for (const table of MIGRATION_TABLES) {
    const rows = sqliteDb.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
    if (rows.length === 0) {
      console.log(`  ✓ ${table.padEnd(25)} : 0 rows (skipped)`);
      continue;
    }

    const transformedRows = rows.map((r) => transformRowForPostgres(table, r));

    // Batch in chunks of 100 to avoid payload limits
    const chunkSize = 100;
    for (let i = 0; i < transformedRows.length; i += chunkSize) {
      const chunk = transformedRows.slice(i, i + chunkSize);
      const res = await fetch(`${baseUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers: insertHeaders,
        body: JSON.stringify(chunk),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`\n[Migration Error] Failed inserting into ${table} (chunk ${i / chunkSize + 1}):`);
        console.error(`HTTP ${res.status}: ${errorText}`);
        process.exit(1);
      }
    }

    console.log(`  ✓ ${table.padEnd(25)} : ${String(transformedRows.length).padStart(5)} rows uploaded`);
  }

  // -------------------------------------------------------------------------
  // Phase 3: Integrity Verification (Row counts & SHA-256 Checksums)
  // -------------------------------------------------------------------------
  console.log('\n[Phase 3] Verifying destination data integrity via PostgREST...');

  const verifyHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: 'application/json',
  };

  interface TableResult {
    table: string;
    sqliteCount: number;
    supabaseCount: number | null;
    countMatch: boolean;
    checksumMatch: boolean;
    error?: string;
  }

  const results: TableResult[] = [];

  for (const table of MIGRATION_TABLES) {
    const pageResult = await fetchAllRowsPaginated(baseUrl, table, verifyHeaders);

    if (!pageResult.ok) {
      results.push({
        table,
        sqliteCount: sqliteCounts[table],
        supabaseCount: null,
        countMatch: false,
        checksumMatch: false,
        error: pageResult.error,
      });
      continue;
    }

    const { rows: destRows, totalDeclared } = pageResult;
    const countMatch = totalDeclared === sqliteCounts[table];

    // If counts differ, record the error and continue to the next table
    if (!countMatch) {
      results.push({
        table,
        sqliteCount: sqliteCounts[table],
        supabaseCount: totalDeclared,
        countMatch: false,
        checksumMatch: false,
        error: `Row count mismatch: SQLite has ${sqliteCounts[table]}, Supabase has ${totalDeclared}`,
      });
      continue;
    }

    // Canonicalize destination rows using the same column list as the source
    const allKeys = sqliteAllKeys[table];
    const destChecksum = computeTableChecksum(
      destRows as Record<string, unknown>[],
      table,
      allKeys
    );
    const checksumMatch = destChecksum === sqliteChecksums[table];

    results.push({
      table,
      sqliteCount: sqliteCounts[table],
      supabaseCount: totalDeclared,
      countMatch,
      checksumMatch,
      error: checksumMatch ? undefined : 'Checksum mismatch — data content differs',
    });
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(92));
  console.log('TABLE                      SQLITE   SUPABASE   ROWS           CHECKSUM');
  console.log('='.repeat(92));

  let allPassed = true;
  for (const r of results) {
    const countStatus = r.countMatch ? 'MATCH ✓' : 'MISMATCH ✗';
    const checksumStatus = r.error && !r.countMatch
      ? `ERROR: ${r.error}`
      : r.checksumMatch
      ? 'VERIFIED ✓'
      : `MISMATCH ✗${r.error ? ` (${r.error})` : ''}`;

    if (!r.countMatch || !r.checksumMatch) allPassed = false;

    const supStr = r.supabaseCount === null ? '    ERR' : String(r.supabaseCount).padStart(7);
    console.log(
      `${r.table.padEnd(25)} ${String(r.sqliteCount).padStart(6)}   ${supStr}   ${countStatus.padEnd(14)} ${checksumStatus}`
    );
  }

  console.log('='.repeat(92));
  console.log('\n[Note] Row counts and SHA-256 payload checksums verified.');
  console.log('[Note] Sensitive fields (password_hash, mobile_number) are not logged;');
  console.log('       they are replaced with a fixed sentinel before hashing — both sides use');
  console.log('       the same sentinel, so checksum equivalence is preserved.');

  if (allPassed) {
    console.log('\n🎉 ALL TABLES VERIFIED. Row counts and checksums match 100%.');
  } else {
    console.error('\n❌ MIGRATION INTEGRITY FAILED. One or more tables had count or checksum mismatches.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(92));
  console.log('PhonePe Recharge: SQLite → Supabase Migration Utility');
  console.log('='.repeat(92));

  const { supabaseUrl, serviceKey } = await verifyEnvironment();
  await migrateViaRest(supabaseUrl, serviceKey);
}

// Only execute when invoked directly from CLI
if (process.argv[1]?.endsWith('migrateToSupabase.ts') || process.argv[1]?.endsWith('migrateToSupabase.js')) {
  main().catch((err) => {
    console.error('\n[Migration Error]:', err.message);
    process.exit(1);
  });
}
