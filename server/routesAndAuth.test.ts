import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLoginRateLimit, recordFailedLogin, resetLoginRateLimit } from './auth.ts';
import { db } from './db.ts';

test('Auth Rate Limiting: records attempts and blocks after 5 tries', async () => {
  const testIp = '192.168.100.' + Math.floor(Math.random() * 200 + 10);

  // Initial check
  const init = await checkLoginRateLimit(testIp);
  assert.equal(init.allowed, true);

  // 4 failed attempts
  for (let i = 0; i < 4; i++) {
    await recordFailedLogin(testIp);
  }
  const check4 = await checkLoginRateLimit(testIp);
  assert.equal(check4.allowed, true);

  // 5th failed attempt triggers block
  await recordFailedLogin(testIp);
  const check5 = await checkLoginRateLimit(testIp);
  assert.equal(check5.allowed, false);
  assert.equal(typeof check5.retryAfterSeconds, 'number');
  assert.equal(check5.retryAfterSeconds! > 0, true);

  // Reset clears lock
  await resetLoginRateLimit(testIp);
  const checkReset = await checkLoginRateLimit(testIp);
  assert.equal(checkReset.allowed, true);
});

test('Orders: updates order status and verifies transitions', () => {
  const testOrderId = 'test-order-' + Date.now();
  const testOrderRef = 'REF-' + Date.now();
  const now = new Date().toISOString();

  // Insert mock order
  db.prepare(`
    INSERT INTO recharge_orders (
      id, order_ref, mobile_number_hash, masked_mobile, provider_id, provider_name,
      plan_price, payment_method, upi_id, payment_status, created_at, updated_at
    ) VALUES (?, ?, 'hash', 'XXXXXX1234', 'jio', 'Jio', 499, 'upi', 'test@upi', 'pending_verification', ?, ?)
  `).run(testOrderId, testOrderRef, now, now);

  const initial = db.prepare('SELECT payment_status FROM recharge_orders WHERE id = ?').get(testOrderId) as any;
  assert.equal(initial.payment_status, 'pending_verification');

  // Transition to paid
  db.prepare(`
    UPDATE recharge_orders SET payment_status = 'paid', admin_verified_by = 'admin', admin_verified_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, testOrderId);

  const paid = db.prepare('SELECT payment_status, admin_verified_by FROM recharge_orders WHERE id = ?').get(testOrderId) as any;
  assert.equal(paid.payment_status, 'paid');
  assert.equal(paid.admin_verified_by, 'admin');

  // Cleanup
  db.prepare('DELETE FROM recharge_orders WHERE id = ?').run(testOrderId);
});
