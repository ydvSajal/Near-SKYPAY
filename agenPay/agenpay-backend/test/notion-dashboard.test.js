// Run: npm test  (no network, no database)
import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardStats } from '../lib/notionDashboard.js';

const d = (s) => new Date(s);
const prisma = {
  invoice: { findMany: async () => [
    { number: 'INV-0002', customerName: 'Acme', customerEmail: 'a@b.c', amount: '10000000', settledAmount: '10000000', decimals: 6, status: 'paid', createdAt: d('2026-11-13T12:00:00Z') },
    { number: 'INV-0001', customerName: null, customerEmail: 'x@y.z', amount: '1500000', decimals: 6, status: 'pending', createdAt: d('2026-11-13T10:00:00Z') },
  ] },
  paymentAttempt: { findMany: async () => [
    { recipient: 'pixel.testnet', amount: '20000000', status: 'settled', createdAt: d('2026-11-13T13:00:00Z') },
    { recipient: 'pixel.testnet', amount: '30000000', status: 'failed', createdAt: d('2026-11-13T14:00:00Z') },
  ] },
};

test('dashboard key figures come from the ledger; failed supplier payments are not "paid out"', async () => {
  const s = await dashboardStats(prisma, 'u1');
  assert.deepEqual(s.kpis.map((k) => k.value), ['10.00 USDC', '1.50 USDC', '20.00 USDC', '2']);
  assert.equal(s.kpis[0].sub, '1 paid invoice');
  assert.equal(s.recent[0], 'Supplier payment · pixel.testnet · 30.00 USDC · Failed'); // newest first
  assert.ok(s.recent.includes('INV-0001 · x@y.z · 1.50 USDC · Pending'));
});

test('empty workspace shows a placeholder, not an error', async () => {
  const s = await dashboardStats({ invoice: { findMany: async () => [] }, paymentAttempt: { findMany: async () => [] } }, 'u1');
  assert.deepEqual(s.recent, ['No activity yet.']);
  assert.equal(s.kpis[0].value, '0.00 USDC');
});
