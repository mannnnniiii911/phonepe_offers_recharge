import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { postgresPool, closePostgresPool } from './postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = process.env.SQLITE_DATABASE_PATH || path.join(here, 'data', 'database.sqlite');

// Explicit, opt-in copy only. It never deletes SQLite data or overwrites PostgreSQL rows.
const tables = [
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

function normalizeValue(table: string, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (table === 'network_providers' && column === 'is_active') return Boolean(value);
  if (table === 'recharge_orders' && column === 'plan_snapshot' && typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

async function main() {
  if (process.env.CONFIRM_SQLITE_COPY !== 'YES') {
    throw new Error('Refusing to copy without CONFIRM_SQLITE_COPY=YES. This operation is additive and preserves source rows.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}. Set SQLITE_DATABASE_PATH to the existing database file; no data was changed.`);
  }

  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  let copied = 0;
  try {
    for (const table of tables) {
      const columns = (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name);
      if (!columns.length) {
        console.log(`[SQLITE_COPY] Skipping missing source table: ${table}`);
        continue;
      }
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>;
      const quotedColumns = columns.map((c) => '"' + c.replace(/"/g, '""') + '"').join(', ');
      const placeholders = columns.map((_, i) => '$' + (i + 1)).join(', ');
      const sql = `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
      let tableCopied = 0;
      for (const row of rows) {
        const values = columns.map((column) => normalizeValue(table, column, row[column]));
        const client = await postgresPool.connect();
        try {
          await client.query('BEGIN');
          const result = await client.query(sql, values);
          await client.query('COMMIT');
          if (result.rowCount) tableCopied += result.rowCount;
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(`Failed copying ${table}; stopped without deleting source data. Details: ${String(error)}`);
        } finally {
          client.release();
        }
      }
      copied += tableCopied;
      console.log(`[SQLITE_COPY] ${table}: ${tableCopied} new rows copied; ${rows.length - tableCopied} already present or skipped by conflict rules.`);
    }
    console.log(`[SQLITE_COPY] Finished. ${copied} new rows copied. SQLite source was opened read-only and remains unchanged.`);
  } finally {
    sqlite.close();
  }
}

main().catch((error) => {
  console.error('[SQLITE_COPY_ERROR]', error);
  process.exitCode = 1;
}).finally(async () => {
  await closePostgresPool();
});
