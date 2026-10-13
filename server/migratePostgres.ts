import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresPool, closePostgresPool } from './postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, 'migrations', '001_postgres_schema.sql');

async function main() {
  const schema = await fs.readFile(schemaPath, 'utf8');
  // CREATE TABLE/INDEX IF NOT EXISTS is non-destructive; existing rows are not cleared.
  await postgresPool.query(schema);
  console.log('[POSTGRES] Initial schema migration applied successfully.');
}

main()
  .catch((error) => {
    console.error('[POSTGRES] Schema migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
