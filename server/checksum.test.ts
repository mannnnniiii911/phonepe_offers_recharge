import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeValue,
  canonicalizeRow,
  computeTableChecksum,
} from './migrateToSupabase.ts';

test('Canonicalize Value: numeric values (number vs string)', () => {
  // SQLite returns number 499, PostgreSQL/PostgREST returns string "499.00"
  const sqliteVal = canonicalizeValue(499, 'numeric');
  const postgrestVal = canonicalizeValue('499.00', 'numeric');
  assert.equal(sqliteVal, 499);
  assert.equal(postgrestVal, 499);
  assert.equal(sqliteVal, postgrestVal);

  // Preserve fractional decimals e.g. 499.50 vs 499.5
  assert.equal(canonicalizeValue('499.50', 'numeric'), 499.5);
  assert.equal(canonicalizeValue(499.5, 'numeric'), 499.5);
});

test('Canonicalize Value: boolean values (0/1 vs true/false)', () => {
  assert.equal(canonicalizeValue(1, 'boolean'), true);
  assert.equal(canonicalizeValue(0, 'boolean'), false);
  assert.equal(canonicalizeValue(true, 'boolean'), true);
  assert.equal(canonicalizeValue(false, 'boolean'), false);
  assert.equal(canonicalizeValue('true', 'boolean'), true);
  assert.equal(canonicalizeValue('false', 'boolean'), false);
});

test('Canonicalize Value: timestamp normalization', () => {
  // SQLite ISO with .000Z vs PostgREST +00:00 vs Z
  const t1 = canonicalizeValue('2026-10-11T05:00:46.000Z', 'timestamp');
  const t2 = canonicalizeValue('2026-10-11T05:00:46+00:00', 'timestamp');
  const t3 = canonicalizeValue('2026-10-11T05:00:46Z', 'timestamp');

  assert.equal(t1, '2026-10-11T05:00:46.000Z');
  assert.equal(t2, '2026-10-11T05:00:46.000Z');
  assert.equal(t3, '2026-10-11T05:00:46.000Z');
});

test('Canonicalize Row: redacts sensitive fields and sorts keys deterministically', () => {
  const rowA = {
    id: 'user-1',
    username: 'admin',
    password_hash: '$2a$10$verysecretpasswordhash',
    email: 'admin@phonepe.local',
  };
  const rowB = {
    email: 'admin@phonepe.local',
    id: 'user-1',
    password_hash: '$2a$10$differentsecretforhashcheck', // sensitive fields redacted
    username: 'admin',
  };

  const allKeys = ['id', 'username', 'email', 'password_hash'];
  const canonA = canonicalizeRow(rowA, 'admin_users', allKeys);
  const canonB = canonicalizeRow(rowB, 'admin_users', allKeys);

  // Both should have '__REDACTED__' for password_hash
  assert.equal(canonA.password_hash, '__REDACTED__');
  assert.equal(canonB.password_hash, '__REDACTED__');
  assert.deepEqual(Object.keys(canonA), ['email', 'id', 'password_hash', 'username']);
  assert.deepEqual(canonA, canonB);
});

test('Compute Table Checksum: returns EMPTY_TABLE for empty array', () => {
  assert.equal(computeTableChecksum([], 'recharge_plans', ['id', 'price']), 'EMPTY_TABLE');
});

test('Compute Table Checksum: deterministic across row order and representation for network_providers', () => {
  const sqliteRows = [
    { id: 'jio', name: 'Jio', is_active: 1, created_at: '2026-10-11T05:00:46.000Z' },
    { id: 'airtel', name: 'Airtel', is_active: 1, created_at: '2026-10-11T05:00:46.000Z' },
  ];
  const postgrestRows = [
    { id: 'airtel', name: 'Airtel', is_active: true, created_at: '2026-10-11T05:00:46+00:00' },
    { id: 'jio', name: 'Jio', is_active: true, created_at: '2026-10-11T05:00:46Z' },
  ];

  const cols = ['id', 'name', 'is_active', 'created_at'];
  const hash1 = computeTableChecksum(sqliteRows, 'network_providers', cols);
  const hash2 = computeTableChecksum(postgrestRows, 'network_providers', cols);

  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 64); // sha256 hex length
  assert.equal(hash1, hash2, 'Checksums between SQLite and PostgREST normalized records must match identically');
});

test('Compute Table Checksum: deterministic across row order and representation for recharge_plans', () => {
  const sqliteRows = [
    { id: 'plan-2', price: 299, original_price: 1499, created_at: '2026-10-11T05:00:46.000Z' },
    { id: 'plan-1', price: 499, original_price: 3999, created_at: '2026-10-11T05:00:46.000Z' },
  ];
  const postgrestRows = [
    { id: 'plan-1', price: '499.00', original_price: '3999.00', created_at: '2026-10-11T05:00:46+00:00' },
    { id: 'plan-2', price: '299.00', original_price: '1499.00', created_at: '2026-10-11T05:00:46Z' },
  ];

  const cols = ['id', 'price', 'original_price', 'created_at'];
  const hash1 = computeTableChecksum(sqliteRows, 'recharge_plans', cols);
  const hash2 = computeTableChecksum(postgrestRows, 'recharge_plans', cols);

  assert.equal(hash1, hash2, 'Recharge plans checksums must match identically');
});
