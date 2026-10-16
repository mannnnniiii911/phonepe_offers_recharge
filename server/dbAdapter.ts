import { db as sqliteDb } from './db';
import pg from 'pg';

/**
 * Universal Database Adapter Interface
 * Provides asynchronous access for both SQLite (default) and PostgreSQL (opt-in).
 */

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DatabaseAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;
  transaction<T>(cb: (client: DatabaseAdapter) => Promise<T>): Promise<T>;
  isPostgres(): boolean;
}

/**
 * Translate SQL for PostgreSQL compatibility:
 * - Replaces ? with $1, $2, ...
 * - Translates SQLite date functions: datetime('now', ...), date('now'), date(created_at)
 * - Translates SQLite integer boolean (is_active = 1) to boolean (is_active = true)
 */
export function translateSqlForPostgres(sql: string): string {
  let paramIndex = 1;
  let translated = sql.replace(/\?/g, () => `$${paramIndex++}`);

  translated = translated.replace(/datetime\('now',\s*'-10 seconds'\)/gi, "NOW() - INTERVAL '10 seconds'");
  translated = translated.replace(/datetime\('now',\s*'-7 days'\)/gi, "NOW() - INTERVAL '7 days'");
  translated = translated.replace(/datetime\('now',\s*'-14 days'\)/gi, "NOW() - INTERVAL '14 days'");
  translated = translated.replace(/date\('now'\)/gi, "CURRENT_DATE");
  translated = translated.replace(/date\(created_at\)/gi, "created_at::date");
  translated = translated.replace(/\bis_active\s*=\s*1\b/gi, "is_active = true");
  translated = translated.replace(/\bis_active\s*=\s*0\b/gi, "is_active = false");

  return translated;
}

/**
 * SQLite Adapter implementation using better-sqlite3.
 * Preserves synchronous SQLite performance wrapped in async Promises.
 */
class SQLiteAdapter implements DatabaseAdapter {
  isPostgres(): boolean {
    return false;
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const stmt = sqliteDb.prepare(sql);
    const rows = stmt.all(...params) as T[];
    return { rows, rowCount: rows.length };
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const stmt = sqliteDb.prepare(sql);
    const row = stmt.get(...params) as T | undefined;
    return row ?? null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    const stmt = sqliteDb.prepare(sql);
    const info = stmt.run(...params);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  async transaction<T>(cb: (client: DatabaseAdapter) => Promise<T>): Promise<T> {
    sqliteDb.exec('BEGIN IMMEDIATE');
    try {
      const result = await cb(this);
      sqliteDb.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        sqliteDb.exec('ROLLBACK');
      } catch {}
      throw err;
    }
  }
}

/**
 * PostgreSQL Adapter implementation using node-postgres (pg.Pool).
 */
class PostgresAdapter implements DatabaseAdapter {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  isPostgres(): boolean {
    return true;
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const pgSql = translateSqlForPostgres(sql);
    const res = await this.pool.query(pgSql, params);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const pgSql = translateSqlForPostgres(sql);
    const res = await this.pool.query(pgSql, params);
    return (res.rows[0] as T) ?? null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    const pgSql = translateSqlForPostgres(sql);
    const res = await this.pool.query(pgSql, params);
    return { changes: res.rowCount ?? 0 };
  }

  async transaction<T>(cb: (client: DatabaseAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter: DatabaseAdapter = {
        isPostgres: () => true,
        query: async <R = any>(sql: string, params: any[] = []): Promise<QueryResult<R>> => {
          const pgSql = translateSqlForPostgres(sql);
          const res = await client.query(pgSql, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
        },
        queryOne: async <R = any>(sql: string, params: any[] = []): Promise<R | null> => {
          const pgSql = translateSqlForPostgres(sql);
          const res = await client.query(pgSql, params);
          return (res.rows[0] as R) ?? null;
        },
        execute: async (sql: string, params: any[] = []): Promise<{ changes: number }> => {
          const pgSql = translateSqlForPostgres(sql);
          const res = await client.query(pgSql, params);
          return { changes: res.rowCount ?? 0 };
        },
        transaction: async () => {
          throw new Error('Nested transactions not supported');
        },
      };

      const result = await cb(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * Singleton database adapter instance.
 * Default is strictly SQLite unless USE_POSTGRES=true and DATABASE_URL is configured.
 */
let adapterInstance: DatabaseAdapter | null = null;

export function getDatabaseAdapter(): DatabaseAdapter {
  if (adapterInstance) return adapterInstance;

  const usePostgres = process.env.USE_POSTGRES === 'true';
  const dbUrl = process.env.DATABASE_URL;

  if (usePostgres && dbUrl) {
    const pool = new pg.Pool({
      connectionString: dbUrl,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 10,
    });
    adapterInstance = new PostgresAdapter(pool);
  } else {
    adapterInstance = new SQLiteAdapter();
  }

  return adapterInstance;
}

export const dbAdapter = getDatabaseAdapter();
