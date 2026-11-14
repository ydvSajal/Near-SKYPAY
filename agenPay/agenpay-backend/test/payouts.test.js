// Batch payouts and payee management, against in-memory stubs (no DB, no chain).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SkyPay } from '../lib/skypay.js';

function setup({ available = '100000000', refuse = [], dbDownAt = -1, unknown = [], sponsorDown = false } = {}) {
  const payees = [
    { id: 'p1', userId: 'u1', name: 'Acme', nearAccount: 'acme.testnet', email: null },
    { id: 'p2', userId: 'u1', name: 'Bolt', nearAccount: 'bolt.testnet', email: null },
    { id: 'px', userId: 'other', name: 'Foreign', nearAccount: 'foreign.testnet', email: null },
  ];
  const attempts = [], batches = [], jobs = [];
  const prisma = {
    user: { findUnique: async () => ({ id: 'u1', vaultAccountId: 'v.testnet', agentKeyEnc: 'k' }) },
    payee: {
      findMany: async ({ where }) => payees.filter((p) => p.userId === where.userId && where.id.in.includes(p.id)),
      findFirst: async ({ where }) => payees.find((p) => p.id === where.id && p.userId === where.userId) || null,
      update: async ({ where, data }) => Object.assign(payees.find((p) => p.id === where.id), data),
      delete: async ({ where }) => payees.splice(payees.findIndex((p) => p.id === where.id), 1),
    },
    paymentAttempt: {
      findUnique: async ({ where }) => attempts.find((a) => a.paymentId === where.paymentId) || null,
      create: async ({ data }) => {
        if (attempts.length === dbDownAt) throw new Error('db down');
        const a = { id: `a${attempts.length}`, ...data }; attempts.push(a); return a;
      },
      update: async ({ where, data }) => Object.assign(attempts.find((a) => a.id === where.id), data),
      findMany: async ({ where }) => attempts.filter((a) => a.batchId === where.batchId),
      findFirst: async ({ where }) => attempts.find((a) => a.userId === where.userId && (a.batchId ?? null) === where.batchId &&
        a.recipient === where.recipient && a.amount === where.amount && where.status.in.includes(a.status)) || null,
    },
    payoutBatch: {
      findFirst: async ({ where }) => batches.find((b) => b.userId === where.userId && b.kind === where.kind && b.label === where.label) || null,
      create: async ({ data }) => {
        if (data.id && batches.some(b => b.id === data.id)) throw Object.assign(new Error('unique id'), { code: 'P2002' });
        const b = { id: `b${batches.length}`, ...data }; batches.push(b); return b;
      },
      update: async ({ where, data }) => Object.assign(batches.find((b) => b.id === where.id), data),
    },
    sponsorLedger: { create: async () => { if (sponsorDown) throw Error('cost ledger unavailable'); return {}; } },
  };
  const near = {
    network: 'testnet',
    vaultState: async () => ({ available }),
    agentPay: async ({ recipient }) => {
      if (unknown.includes(recipient)) throw new Error('RPC timeout after submission');
      if (refuse.includes(recipient)) throw new Error('Contract panicked: over daily limit');
      return { txHash: `tx-${recipient}`, status: { SuccessValue: Buffer.from('"Settled"').toString('base64') } };
    },
  };
  const outbox = { enqueue: async (userId, kind, key, payload) => { jobs.push({ kind, key, payload }); } };
  return { sp: new SkyPay({ prisma, near, outbox }), attempts, batches, jobs };
}

const item = (payeeId, amount = '10') => ({ payeeId, amount, memo: 'inv' });

test('batch validation: empty, too large, foreign payee, bad amounts', async () => {
  const { sp } = setup();
  await assert.rejects(sp.payBatch('u1', { items: [] }), { status: 400 });
  await assert.rejects(sp.payBatch('u1', { items: Array(26).fill(item('p1')) }), { status: 400 });
  await assert.rejects(sp.payBatch('u1', { items: [item('px')] }), { status: 404 });
  await assert.rejects(sp.payBatch('u1', { items: [item('p1', 'abc')] }), { status: 400 });
  await assert.rejects(sp.payBatch('u1', { items: [item('p1', '0')] }), { status: 400 });
});

test('batch total above vault balance is refused before anything is paid', async () => {
  const { sp, attempts } = setup({ available: '15000000' }); // 15
  await assert.rejects(sp.payBatch('u1', { items: [item('p1', '10'), item('p2', '10')] }), { status: 422 });
  assert.equal(attempts.length, 0);
});

test('one refused item does not stop the batch: status partial, others settled', async () => {
  const { sp, jobs } = setup({ refuse: ['bolt.testnet'] });
  const out = await sp.payBatch('u1', { label: 'Nov suppliers', items: [item('p1'), item('p2'), item('p1', '5')] });
  assert.deepEqual(out.payments.map((a) => a.status), ['settled', 'failed', 'settled']);
  assert.equal(out.batch.status, 'partial');
  assert.equal(out.batch.label, 'Nov suppliers');
  assert.ok(out.payments.every((a) => a.batchId === out.batch.id));
  assert.equal(jobs.filter((j) => j.kind === 'notion_payout').length, 3); // every payout reaches Notion
});

test('all settled = done, all refused = failed', async () => {
  assert.equal((await setup().sp.payBatch('u1', { items: [item('p1')] })).batch.status, 'done');
  assert.equal((await setup({ refuse: ['acme.testnet'] }).sp.payBatch('u1', { items: [item('p1')] })).batch.status, 'failed');
});

test('updatePayee validates and only touches own payees', async () => {
  const { sp } = setup();
  assert.equal((await sp.updatePayee('u1', 'p1', { name: ' Acme Ltd ', notes: 'net 30' })).name, 'Acme Ltd');
  await assert.rejects(sp.updatePayee('u1', 'p1', { name: '  ' }), { status: 400 });
  await assert.rejects(sp.updatePayee('u1', 'p1', { email: 'nope' }), { status: 400 });
  await assert.rejects(sp.updatePayee('u1', 'px', { name: 'x' }), { status: 404 });
});

test('unexpected error mid-batch: batch is never left queued', async () => {
  const { sp, batches } = setup({ dbDownAt: 1 }); // first item pays, second hits a DB error
  await assert.rejects(sp.payBatch('u1', { items: [item('p1'), item('p2')] }), /db down/);
  assert.equal(batches[0].status, 'partial');
  const none = setup({ dbDownAt: 0 });
  await assert.rejects(none.sp.payBatch('u1', { items: [item('p1')] }), /db down/);
  assert.equal(none.batches[0].status, 'failed');
});

test('a retry under a new key cannot duplicate an unresolved single payment; a settled one does not block', async () => {
  const { sp, attempts } = setup({ unknown: ['acme.testnet'] });
  assert.equal((await sp.paySupplier('u1', { payeeId: 'p1', amount: '10', memo: 'inv', idempotencyKey: 'click-1' })).status, 'unknown');
  await assert.rejects(sp.paySupplier('u1', { payeeId: 'p1', amount: '10', memo: 'inv', idempotencyKey: 'click-2' }), { status: 409 });
  assert.equal(attempts.length, 1);
  attempts[0].status = 'settled'; // reconciliation resolved it
  assert.equal((await sp.paySupplier('u1', { payeeId: 'p2', amount: '10', memo: 'inv', idempotencyKey: 'other' })).status, 'settled');
  const ok = setup();
  await ok.sp.paySupplier('u1', { payeeId: 'p1', amount: '10', memo: 'inv', idempotencyKey: 'a' });
  assert.equal((await ok.sp.paySupplier('u1', { payeeId: 'p1', amount: '10', memo: 'inv', idempotencyKey: 'b' })).status, 'settled'); // deliberate second payment
});

test('crash after an unknown line keeps the batch processing, never failed', async () => {
  const { sp, batches } = setup({ unknown: ['acme.testnet'], dbDownAt: 1 }); // line 1 outcome unknown, line 2 hits a DB error
  await assert.rejects(sp.payBatch('u1', { items: [item('p1'), item('p2')] }), /db down/);
  assert.equal(batches[0].status, 'processing');
});

test('removing a payee queues the Notion row removal with the account', async () => {
  const { sp, jobs } = setup();
  await sp.removePayee('u1', 'p1');
  assert.deepEqual(jobs.find((j) => j.kind === 'notion_payee_remove').payload, { nearAccount: 'acme.testnet' });
  await assert.rejects(sp.removePayee('u1', 'px'), { status: 404 });
});

test('payroll: same run name cannot be paid twice; default name is the month', async () => {
  const { sp, batches } = setup();
  const first = await sp.payBatch('u1', { kind: 'payroll', items: [item('p1')] });
  assert.match(first.batch.label, /^Payroll \d{4}-\d{2}$/);
  assert.equal(first.batch.kind, 'payroll');
  await assert.rejects(sp.payBatch('u1', { kind: 'payroll', items: [item('p1')] }), { status: 409 });
  await sp.payBatch('u1', { kind: 'payroll', label: 'Bonus Nov', items: [item('p1')] }); // different name is allowed
  batches[0].status = 'failed'; // a reused name must never create fresh payment IDs
  await assert.rejects(sp.payBatch('u1', { kind: 'payroll', items: [item('p1')] }), { status: 409 });
  assert.equal((await sp.payBatch('u1', { items: [item('p1')] })).batch.kind, 'payout'); // supplier batches have no such guard
});

test('employee fields: kind, role, pay validated and stored in base units', async () => {
  const { sp } = setup();
  const e = await sp.updatePayee('u1', 'p1', { kind: 'employee', role: 'Designer', salary: '1200.5' });
  assert.deepEqual([e.kind, e.role, e.salary], ['employee', 'Designer', '1200500000']);
  await assert.rejects(sp.updatePayee('u1', 'p1', { kind: 'boss' }), { status: 400 });
  await assert.rejects(sp.updatePayee('u1', 'p1', { salary: 'lots' }), { status: 400 });
  await assert.rejects(sp.updatePayee('u1', 'p1', { salary: '0' }), { status: 400 });
  assert.equal((await sp.updatePayee('u1', 'p1', { salary: '' })).salary, null);
});


test('payroll race: one durable name reserves only one run before any dispatch', async () => {
  const { sp, batches, attempts } = setup();
  const run = { kind: 'payroll', label: 'Race payroll', items: [item('p1')] };
  const results = await Promise.allSettled([sp.payBatch('u1', run), sp.payBatch('u1', run)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal(batches.length, 1);
  assert.equal(attempts.length, 1);
});

test('unknown payroll outcome stays processing and blocks another run of the same name', async () => {
  const { sp, attempts } = setup({ unknown: ['acme.testnet'] });
  const run = { kind: 'payroll', label: 'Uncertain payroll', items: [item('p1')] };
  const out = await sp.payBatch('u1', run);
  assert.equal(out.payments[0].status, 'unknown');
  assert.equal(out.batch.status, 'processing');
  await assert.rejects(sp.payBatch('u1', run), { status: 409 });
  assert.equal(attempts.length, 1);
});

test('cost ledger failure cannot undo settled payment status or remove transaction evidence', async () => {
  const { sp } = setup({ sponsorDown: true });
  const result = await sp.paySupplier('u1', { payeeId: 'p1', amount: '1', idempotencyKey: 'cost-failure' });
  assert.equal(result.status, 'settled');
  assert.equal(result.txHash, 'tx-acme.testnet');
});
