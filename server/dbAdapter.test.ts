import test from 'node:test';
import assert from 'node:assert/strict';
import { dbAdapter } from './dbAdapter.ts';

test('DB Adapter (SQLite mode): performs basic queries', async () => {
  assert.equal(dbAdapter.isPostgres(), false);

  const res = await dbAdapter.query('SELECT setting_key, setting_value FROM website_settings LIMIT 2');
  assert.equal(Array.isArray(res.rows), true);
  assert.equal(res.rows.length <= 2, true);

  const one = await dbAdapter.queryOne('SELECT setting_value FROM website_settings WHERE setting_key = ?', ['upi_id']);
  assert.notEqual(one, null);
  assert.equal(typeof (one as any).setting_value, 'string');
});

test('DB Adapter (SQLite mode): transaction commits successfully', async () => {
  const testKey = 'test_tx_key_' + Date.now();
  await dbAdapter.transaction(async (tx) => {
    await tx.execute(
      'INSERT INTO website_settings (setting_key, setting_value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
      [testKey, 'val_1', new Date().toISOString(), 'test']
    );
  });

  const check = await dbAdapter.queryOne('SELECT setting_value FROM website_settings WHERE setting_key = ?', [testKey]);
  assert.equal((check as any).setting_value, 'val_1');

  // cleanup
  await dbAdapter.execute('DELETE FROM website_settings WHERE setting_key = ?', [testKey]);
});

test('DB Adapter (SQLite mode): transaction rolls back on exception', async () => {
  const testKey = 'test_tx_rollback_' + Date.now();

  await assert.rejects(
    async () => {
      await dbAdapter.transaction(async (tx) => {
        await tx.execute(
          'INSERT INTO website_settings (setting_key, setting_value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
          [testKey, 'temp_val', new Date().toISOString(), 'test']
        );
        throw new Error('Simulated failure inside transaction');
      });
    },
    /Simulated failure inside transaction/
  );

  const check = await dbAdapter.queryOne('SELECT setting_value FROM website_settings WHERE setting_key = ?', [testKey]);
  assert.equal(check, null, 'Row must not exist after rollback');
});
