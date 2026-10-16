import test from 'node:test';
import assert from 'node:assert/strict';
import { translateSqlForPostgres } from './dbAdapter.ts';

test('translateSqlForPostgres: replaces ? with $1, $2, ...', () => {
  const sql = 'SELECT * FROM users WHERE id = ? AND email = ?';
  assert.equal(translateSqlForPostgres(sql), 'SELECT * FROM users WHERE id = $1 AND email = $2');
});

test('translateSqlForPostgres: translates SQLite date functions', () => {
  const sql1 = "SELECT id FROM customer_submissions WHERE created_at >= datetime('now', '-10 seconds')";
  assert.equal(translateSqlForPostgres(sql1), "SELECT id FROM customer_submissions WHERE created_at >= NOW() - INTERVAL '10 seconds'");

  const sql2 = "SELECT COUNT(*) FROM customer_submissions WHERE date(created_at) = date('now')";
  assert.equal(translateSqlForPostgres(sql2), "SELECT COUNT(*) FROM customer_submissions WHERE created_at::date = CURRENT_DATE");

  const sql3 = "SELECT COUNT(*) FROM customer_submissions WHERE created_at >= datetime('now', '-7 days')";
  assert.equal(translateSqlForPostgres(sql3), "SELECT COUNT(*) FROM customer_submissions WHERE created_at >= NOW() - INTERVAL '7 days'");

  const sql4 = "SELECT COUNT(*) FROM customer_submissions WHERE created_at >= datetime('now', '-14 days')";
  assert.equal(translateSqlForPostgres(sql4), "SELECT COUNT(*) FROM customer_submissions WHERE created_at >= NOW() - INTERVAL '14 days'");
});

test('translateSqlForPostgres: translates boolean integer comparisons', () => {
  const sql = 'SELECT * FROM network_providers WHERE is_active = 1';
  assert.equal(translateSqlForPostgres(sql), 'SELECT * FROM network_providers WHERE is_active = true');
});
