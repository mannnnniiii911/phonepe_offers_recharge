import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQrDataUri } from './routes/adminSettings.ts';

test('QR Validation: accepts valid JPEG data URI', () => {
  const dummyB64 = Buffer.from('fake image content').toString('base64');
  const validJpeg = `data:image/jpeg;base64,${dummyB64}`;
  const res = validateQrDataUri(validJpeg);
  assert.equal(res.ok, true);
});

test('QR Validation: accepts valid PNG data URI', () => {
  const dummyB64 = Buffer.from('png image content').toString('base64');
  const validPng = `data:image/png;base64,${dummyB64}`;
  const res = validateQrDataUri(validPng);
  assert.equal(res.ok, true);
});

test('QR Validation: accepts image/webp format', () => {
  const dummyB64 = Buffer.from('webp image content').toString('base64');
  const validWebp = `data:image/webp;base64,${dummyB64}`;
  const res = validateQrDataUri(validWebp);
  assert.equal(res.ok, true);
});

test('QR Validation: rejects non-data URIs (e.g. file paths or URLs)', () => {
  const resPath = validateQrDataUri('/assets/upi-qr.jpg');
  assert.equal(resPath.ok, false);
  assert.match((resPath as any).error, /Base64 data URI/);

  const resUrl = validateQrDataUri('https://example.com/qr.png');
  assert.equal(resUrl.ok, false);
});

test('QR Validation: rejects unsupported MIME types', () => {
  const dummyB64 = Buffer.from('gif').toString('base64');
  const resGif = validateQrDataUri(`data:image/gif;base64,${dummyB64}`);
  assert.equal(resGif.ok, false);
  assert.match((resGif as any).error, /Unsupported image format/);

  const resSvg = validateQrDataUri(`data:image/svg+xml;base64,${dummyB64}`);
  assert.equal(resSvg.ok, false);
});

test('QR Validation: rejects malformed Base64 data', () => {
  const res = validateQrDataUri('data:image/jpeg;base64,not-valid-base64!@#$%^');
  assert.equal(res.ok, false);
  assert.match((res as any).error, /malformed Base64/);
});

test('QR Validation: rejects images exceeding 5MB size limit', () => {
  // 5MB = 5 * 1024 * 1024 bytes = 5,242,880 bytes.
  // Base64 encoding expands size by ~4/3, so ~7,000,000 characters
  const largePayload = 'A'.repeat(7_000_000);
  const res = validateQrDataUri(`data:image/png;base64,${largePayload}`);
  assert.equal(res.ok, false);
  assert.match((res as any).error, /exceeds the maximum limit/);
});
