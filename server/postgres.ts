import { Pool, type QueryResult, type QueryResultRow } from 'pg';

/**
 * PostgreSQL connection pool used by the migration.
 * This is intentionally separate from the existing SQLite adapter until all
 * database callers have been converted; switching the adapter prematurely
 * would break routes that still use synchronous better-sqlite3 APIs.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required when importing the PostgreSQL adapter.');
}

const useSsl =
  process.env.PGSSLMODE === 'require' ||
  connectionString.includes('supabase.co') ||
  connectionString.includes('pooler.supabase.com');

export const postgresPool = new Pool({
  connectionString,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

postgresPool.on('error', (error) => {
  console.error('[POSTGRES_POOL_ERROR]', error);
});

export async function postgresQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return postgresPool.query<T>(text, values);
}

export async function closePostgresPool(): Promise<void> {
  await postgresPool.end();
}
