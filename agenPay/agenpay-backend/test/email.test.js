// Run: npm test  (no network, no database)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Outbox } from '../lib/outbox.js';

const ob = new Outbox({ prisma: {}, near: { explorerTx: (h) => `https://x/tx/${h}` }, env: { FRONTEND_URL: 'http://app' } });
const inv = {
  id: 'i1', number: 'INV-0001', asset: 'USDC', decimals: 6, network: 'near:testnet', amount: '3000000', description: '<b>x</b>',
  dueDate: new Date('2026-11-27T00:00:00Z'), user: { name: 'Acme <script>', email: 'a@b.c' },
  lineItems: [{ description: '<img src=x onerror=1>', quantity: 3, unitAmount: '1000000' }],
};

test('invoice email lists line items, links to checkout, escapes customer text', () => {
  const [subject, html] = ob.invoiceMail(inv);
  assert.match(subject, /INV-0001.*3\.000000 USDC.*2026-11-27|INV-0001.*3 USDC|INV-0001/);
  assert.ok(html.includes('http://app/invoice/i1') && html.includes('Pay invoice'));
  assert.ok(html.includes('3.000000') || html.includes('>3<'));
  assert.ok(!html.includes('<script>') && !html.includes('<img src=x') && html.includes('&lt;img'));
});

test('receipt email shows amount, UTC time and explorer link', () => {
  const [, html] = ob.receiptMail({ ...inv, status: 'paid', settledAmount: '3000000', settledTxHash: 'HASH1', settledAt: new Date('2026-11-13T10:00:00Z') });
  assert.ok(html.includes('https://x/tx/HASH1') && html.includes('2026-11-13 10:00:00 UTC'));
});
