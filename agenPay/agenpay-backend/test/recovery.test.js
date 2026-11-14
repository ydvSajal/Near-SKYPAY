import test from 'node:test';
import assert from 'node:assert/strict';
import { SkyPay } from '../lib/skypay.js';
import { Outbox } from '../lib/outbox.js';
import { ReconciliationWorker } from '../lib/reconciliation.js';
import { csvCell } from '../lib/csvExport.js';

function ledger({ failJob = false } = {}) {
  let db = { invoices: [], attempts: [], jobs: [] };
  const user = { id: 'u', email: 'owner@example.com', nearAccountId: 'co.testnet' };
  const invoice = {
    count: async () => db.invoices.length,
    findUnique: async ({ where }) => db.invoices.find(i => where.id ? i.id === where.id : i.settledTxHash === where.settledTxHash),
    create: async ({ data }) => { const i = { id: 'i', status: 'pending', ...data }; db.invoices.push(i); return i; },
    updateMany: async ({ where, data }) => { const i = db.invoices.find(i => i.id === where.id && i.status === where.status); if (!i) return { count: 0 }; Object.assign(i, data); return { count: 1 }; },
  };
  const prisma = { user: { findUnique: async () => user }, invoice,
    paymentAttempt: { create: async ({ data }) => { db.attempts.push(data); } },
    outboxJob: { upsert: async ({ create }) => { if (failJob) throw Error('queue unavailable'); if (!db.jobs.some(j => j.idempotencyKey === create.idempotencyKey)) db.jobs.push(create); } },
    $transaction: async f => { const before = structuredClone(db); try { return await f(prisma); } catch (e) { db = before; throw e; } },
  };
  const near = { token: 'usdc.testnet', network: 'testnet', verifyTokenReceipt: async () => ({ ok: true, received: '10000000' }) };
  return { sp: new SkyPay({ prisma, near, outbox: { enqueue() { throw Error('must enqueue inside transaction'); } } }), prisma, near, db: () => db };
}
const input = { customerEmail: 'client@example.com', lineItems: [{ description: 'Design', unitPrice: '10', quantity: 1 }] };
const hash = 'A'.repeat(44);

test('invoice commits exact amount and delivery jobs together; queue failure rolls back', async () => {
  const x = ledger();
  assert.equal((await x.sp.createInvoice('u', input)).amount, '10000000');
  assert.deepEqual(x.db().jobs.map(j => j.kind), ['invoice_email', 'notion_invoice']);
  const bad = ledger({ failJob: true });
  await assert.rejects(bad.sp.createInvoice('u', input), /queue unavailable/);
  assert.equal(bad.db().invoices.length, 0);
});

test('verified settlement and receipt jobs commit once; retry creates no financial duplicate', async () => {
  const x = ledger(); await x.sp.createInvoice('u', input);
  await x.sp.confirmInvoicePayment('i', { txHash: hash });
  await x.sp.confirmInvoicePayment('i', { txHash: hash });
  assert.equal(x.db().invoices[0].status, 'paid');
  assert.equal(x.db().attempts.length, 1);
  assert.equal(x.db().jobs.filter(j => j.kind === 'receipt_email').length, 1);
});

test('wrong active network/token cannot settle an old invoice', async () => {
  const x = ledger(); await x.sp.createInvoice('u', input); x.near.token = 'other.testnet';
  await assert.rejects(x.sp.confirmInvoicePayment('i', { txHash: hash }), { status: 409 });
  assert.equal(x.db().invoices[0].status, 'pending');
});

test('payment retries reject changed memo as well as changed amount', async () => {
  const a = { recipient: 'supplier.testnet', amount: '1000000', requestHash: JSON.stringify({ memo: 'original' }) };
  const sp = new SkyPay({ prisma: {
    user: { findUnique: async () => ({ vaultAccountId: 'v', agentKeyEnc: 'k' }) },
    payee: { findFirst: async () => ({ nearAccount: 'supplier.testnet' }) },
    paymentAttempt: { findUnique: async () => a },
  }, near: {} });
  assert.equal(await sp.paySupplier('u', { amount: '1', memo: 'original', idempotencyKey: 'k' }), a);
  await assert.rejects(sp.paySupplier('u', { amount: '1', memo: 'changed', idempotencyKey: 'k' }), { status: 409 });
});

test('recovery keeps absent payments unknown and rejects mismatched chain evidence', async () => {
  const a = { id: 'a', paymentId: 'p', status: 'unknown', recipient: 'supplier.testnet', amount: '5' };
  let evidence = null;
  const sp = new SkyPay({ prisma: {
    user: { findUnique: async () => ({ vaultAccountId: 'v', agentAccountId: 'agent.testnet' }) },
    paymentAttempt: {
      findFirst: async ({ where }) => where.userId === 'u' ? a : null,
      update: async ({ data }) => Object.assign(a, data),
    },
  }, near: { vaultPayment: async () => evidence }, outbox: { enqueue: async () => {} } });
  assert.equal((await sp.reconcile('u', 'a')).status, 'unknown');
  await assert.rejects(sp.reconcile('other', 'a'), { status: 404 });
  evidence = { recipient: 'attacker.testnet', amount: '5', agent: 'agent.testnet', status: 'Settled' };
  await assert.rejects(sp.reconcile('u', 'a'), /does not match/);
  evidence.recipient = a.recipient;
  assert.equal((await sp.reconcile('u', 'a')).status, 'settled');
});

test('restart worker reconciles persisted attempts and never dispatches', async () => {
  const calls = [];
  const worker = new ReconciliationWorker({ prisma: {
    paymentAttempt: { findMany: async () => [{ id: 'a', userId: 'u' }] },
    payoutBatch: { findMany: async () => [{ id: 'b', userId: 'u' }] },
  },
  skypay: { reconcile: async (...args) => calls.push(args), refreshBatch: async (...args) => calls.push(['batch', ...args]), paySupplier: () => assert.fail('resend') } });
  assert.equal(await worker.runOnce(), 1);
  assert.deepEqual(calls, [['u', 'a'], ['batch', 'u', 'b']]); // stale runs are recomputed, nothing is dispatched
});

test('expired outbox claims are quarantined, never resent after ambiguous acceptance', async () => {
  const changes = [];
  const ob = new Outbox({ prisma: { outboxJob: {
    updateMany: async x => { changes.push(x); return { count: 1 }; },
    findMany: async () => [],
  } }, near: {}, env: {} });
  assert.equal(await ob.runOnce(), 0);
  assert.equal(changes[0].where.status, 'running');
  assert.equal(changes[0].data.status, 'unknown');
});

test('CSV neutralizes formulas behind whitespace and newline control characters', () => {
  for (const s of [' =1+1', '\n@SUM(A1)', '\u0001+1', '\ttext']) assert.ok(csvCell(s).includes("'"));
});


test('generic execution or callback error after dispatch remains unknown', async () => {
  let a;
  const sp = new SkyPay({ prisma: {
    user: { findUnique: async () => ({ vaultAccountId: 'v', agentKeyEnc: 'k' }) },
    payee: { findFirst: async () => ({ nearAccount: 'supplier.testnet' }) },
    paymentAttempt: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => (a = { id: 'a', ...data }),
      update: async ({ data }) => Object.assign(a, data),
    },
  }, near: { network: 'testnet', agentPay: async () => { throw Error('FunctionCallError: callback on_paid failed'); } },
  outbox: { enqueue: async () => {} } });
  assert.equal((await sp.paySupplier('u', { amount: '1', memo: 'test' })).status, 'unknown');
});

test('Notion monitor: a row whose Notion update failed is not invoiced twice on the next poll', async () => {
  const { AgenPayAgent } = await import('../lib/AgentPayAgent.js');
  const invoices = [];
  const skypay = {
    prisma: { invoice: { findFirst: async ({ where }) => invoices.find((i) => i.userId === where.userId && i.seller?.sourceRef === where.seller.equals) || null } },
    createInvoice: async (userId, input) => { const i = { id: `i${invoices.length}`, userId, seller: { sourceRef: input.sourceRef } }; invoices.push(i); return i; },
  };
  const self = {
    userId: 'u1', sharedServices: { skypay },
    notion: { pages: { update: async () => { throw new Error('Notion unavailable'); } } },
    getNotionProperty: () => null,
  };
  const page = { id: 'row-1', properties: { Amount: { number: 10 }, 'Recipient Email': { email: 'c@example.com' } } };
  await AgenPayAgent.prototype.processNotionEntry.call(self, page, {});
  await AgenPayAgent.prototype.processNotionEntry.call(self, page, {});
  assert.equal(invoices.length, 1);
});
