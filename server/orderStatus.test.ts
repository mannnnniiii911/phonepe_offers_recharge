import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_PAYMENT_STATUSES,
  NON_TERMINAL_STATUSES,
  TERMINAL_STATUSES,
  isValidOrderStatus,
  DEFAULT_ORDER_STATUS,
} from './orderStatus.ts';

test('Order Status Vocabulary: contains all 6 supported statuses', () => {
  assert.deepEqual([...ORDER_PAYMENT_STATUSES].sort(), [
    'cancelled',
    'failed',
    'paid',
    'pending',
    'pending_verification',
    'submitted_for_review',
  ]);
});

test('Order Status Vocabulary: validates supported statuses correctly', () => {
  for (const status of ORDER_PAYMENT_STATUSES) {
    assert.equal(isValidOrderStatus(status), true, `Expected ${status} to be valid`);
  }
  assert.equal(isValidOrderStatus('verified_paid'), false);
  assert.equal(isValidOrderStatus('rejected'), false);
  assert.equal(isValidOrderStatus('unknown'), false);
  assert.equal(isValidOrderStatus(null), false);
  assert.equal(isValidOrderStatus(undefined), false);
});

test('Order Status Vocabulary: categorizes terminal and non-terminal correctly', () => {
  assert.deepEqual([...TERMINAL_STATUSES].sort(), ['cancelled', 'failed', 'paid']);
  assert.deepEqual([...NON_TERMINAL_STATUSES].sort(), ['pending', 'pending_verification', 'submitted_for_review']);
  assert.equal(DEFAULT_ORDER_STATUS, 'pending_verification');
});
