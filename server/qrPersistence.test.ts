import test from 'node:test';
import assert from 'node:assert/strict';
import { dbAdapter } from './dbAdapter.ts';
import { validateQrDataUri } from './routes/adminSettings.ts';
import { initDatabase } from './db.ts';

test('QR Persistence: validate custom UPI and QR data URI', () => {
  const sampleB64 = Buffer.from('my-persisted-qr-image-test').toString('base64');
  const qrDataUri = `data:image/png;base64,${sampleB64}`;
  const validation = validateQrDataUri(qrDataUri);
  assert.equal(validation.ok, true);
});

test('QR Persistence: save custom UPI/QR in database and retrieve via query', async () => {
  const sampleB64 = Buffer.from('my-persisted-qr-image-test').toString('base64');
  const customQr = `data:image/png;base64,${sampleB64}`;
  const customUpi = 'custommerchant@ybl';
  const now = new Date().toISOString();

  // Save settings
  await dbAdapter.execute(
    `INSERT INTO website_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES (?, ?, ?, 'admin_test')
     ON CONFLICT(setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
    ['upi_id', customUpi, now]
  );

  await dbAdapter.execute(
    `INSERT INTO website_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES (?, ?, ?, 'admin_test')
     ON CONFLICT(setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
    ['qr_code_url', customQr, now]
  );

  // Read back
  const upiRow = await dbAdapter.queryOne<{ setting_value: string }>(
    'SELECT setting_value FROM website_settings WHERE setting_key = ?',
    ['upi_id']
  );
  const qrRow = await dbAdapter.queryOne<{ setting_value: string }>(
    'SELECT setting_value FROM website_settings WHERE setting_key = ?',
    ['qr_code_url']
  );

  assert.equal(upiRow?.setting_value, customUpi);
  assert.equal(qrRow?.setting_value, customQr);
});

test('QR Persistence: server initDatabase() does NOT overwrite existing custom UPI/QR', async () => {
  const sampleB64 = Buffer.from('my-persisted-qr-image-test').toString('base64');
  const customQr = `data:image/png;base64,${sampleB64}`;
  const customUpi = 'custommerchant@ybl';

  // Simulate server restart by running initDatabase() again
  initDatabase();

  // Verify that custom values were NOT reverted to default 'q462939567@ybl' or '/assets/upi-qr.jpg'
  const upiRow = await dbAdapter.queryOne<{ setting_value: string }>(
    'SELECT setting_value FROM website_settings WHERE setting_key = ?',
    ['upi_id']
  );
  const qrRow = await dbAdapter.queryOne<{ setting_value: string }>(
    'SELECT setting_value FROM website_settings WHERE setting_key = ?',
    ['qr_code_url']
  );

  assert.equal(upiRow?.setting_value, customUpi, 'UPI ID must survive initDatabase without reverting');
  assert.equal(qrRow?.setting_value, customQr, 'QR code data URI must survive initDatabase without reverting');
});
