// Run: node --test ibkr-close-worthiness/test/close-worthiness.test.js
const test = require('node:test');
const assert = require('node:assert');
const { closeWorthiness, nyDateTime } = require('../close-worthiness.js');

const DAY = 24 * 60 * 60 * 1000;

test('expiry is 16:00 New York time, across DST', () => {
  assert.strictEqual(nyDateTime('2026-09-30', 16, 0), Date.UTC(2026, 8, 30, 20, 0)); // EDT
  assert.strictEqual(nyDateTime('2026-12-18', 16, 0), Date.UTC(2026, 11, 18, 21, 0)); // EST
});

// Sold for 1.00 five days before expiry, now two days before (40% of time left).
const expiryTime = nyDateTime('2026-09-30', 16, 0);
const base = {
  openPremium: 1.00, strike: 100, contracts: 1, feePerShare: 0.02,
  expiryTime, openTime: expiryTime - 5 * DAY, now: expiryTime - 2 * DAY
};

test('threshold = premium x time left - fees', () => {
  const r = closeWorthiness({ ...base, currentPrice: 0.3 });
  assert.ok(Math.abs(r.timeLeft - 0.4) < 1e-9);
  assert.ok(Math.abs(r.thresholdPrice - (1.00 * 0.4 - 0.02)) < 1e-9);
});

test('price well below threshold -> close', () => {
  const r = closeWorthiness({ ...base, currentPrice: 0.3 });
  assert.strictEqual(r.status, 'close');
  assert.ok(Math.abs(r.ratio - (0.32 / 1.00) / 0.4) < 1e-9);
  assert.ok(Math.abs(r.lockedProfit - 70) < 1e-9);
  assert.ok(Math.abs(r.leftOnTable - 30) < 1e-9);
  assert.ok(r.remainingYield < r.openYield);
});

test('price exactly at threshold -> ratio 1, borderline', () => {
  const r = closeWorthiness({ ...base, currentPrice: 1.00 * 0.4 - 0.02 });
  assert.ok(Math.abs(r.ratio - 1) < 1e-9);
  assert.strictEqual(r.status, 'borderline');
});

test('price above threshold -> hold', () => {
  assert.strictEqual(closeWorthiness({ ...base, currentPrice: 0.6 }).status, 'hold');
});

test('price at or above the premium received -> losing (case B)', () => {
  assert.strictEqual(closeWorthiness({ ...base, currentPrice: 1.5 }).status, 'losing');
});

test('no price yet still gives the threshold', () => {
  const r = closeWorthiness({ ...base, currentPrice: null });
  assert.strictEqual(r.status, 'no-price');
  assert.ok(r.thresholdPrice > 0);
});

test('after expiry -> expired; bad input -> invalid', () => {
  assert.strictEqual(closeWorthiness({ ...base, currentPrice: 0.1, now: expiryTime + 1 }).status, 'expired');
  assert.strictEqual(closeWorthiness({ ...base, currentPrice: 0.1, openPremium: 0 }).status, 'invalid');
  assert.strictEqual(closeWorthiness({ ...base, currentPrice: 0.1, openTime: expiryTime + DAY }).status, 'invalid');
});
