// Supplier bill inbox + batch aggregate recovery, against in-memory stubs (no DB, no chain).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SkyPay, paymentIdFor } from '../lib/skypay.js';
import { Bills } from '../lib/bills.js';

// tiny Prisma "where" matcher: equality, null, {in}, {not}, {gte}, {lt}, OR
function matches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return v.some((w) => matches(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      if ('gte' in v) return row[k] >= v.gte;
      if ('lt' in v) return row[k] < v.lt;
    }
    return row[k] === v;
  });
}
function table(rows, uniques = [], defaults = {}) {
  let n = 0;
  const c = (r) => (r ? structuredClone(r) : null); // Prisma returns copies, never live rows
  return {
    rows,
    findUnique: async ({ where }) => c(rows.find((r) => matches(r, where))),
    findFirst: async ({ where }) => c(rows.find((r) => matches(r, where))),
    findMany: async ({ where } = {}) => rows.filter((r) => matches(r, where)).map(c),
    create: async ({ data }) => {
      for (const u of uniques) if (rows.some((r) => u.every((f) => r[f] === data[f]))) throw Object.assign(new Error('unique'), { code: 'P2002' });
      const r = { id: `${uniques.length}r${n++}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data }; rows.push(r); return c(r);
    },
    update: async ({ where, data }) => c(Object.assign(rows.find((r) => r.id === where.id), data, { updatedAt: new Date() })),
    updateMany: async ({ where, data }) => {
      const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length };
    },
  };
}

function setup({ refuse = false, unknown = false } = {}) {
  const users = [{ id: 'u1', name: 'Agency', companyName: 'Agency Ltd', vaultAccountId: 'v.testnet', agentKeyEnc: 'k', agentAccountId: 'ag.testnet', billInboxToken: null },
    { id: 'u2', name: 'Other', vaultAccountId: 'v2.testnet', agentKeyEnc: 'k', billInboxToken: 'other-company-token-xyz' }];
  const payees = [
    { id: 'p1', userId: 'u1', name: 'Dana', email: 'dana@studio.dev', nearAccount: 'dana.testnet' },
    { id: 'p9', userId: 'u2', name: 'Eve', email: 'eve@x.dev', nearAccount: 'eve.testnet' },
  ];
  const sent = [];
  const prisma = {
    user: table(users),
    payee: table(payees),
    supplierBill: table([], [['userId', 'submitterEmail', 'invoiceNumber'], ['statusToken']], { tries: 0, paymentAttemptId: null, reviewNote: null }),
    paymentAttempt: table([], [['paymentId']]),
    payoutBatch: table([]),
    sponsorLedger: { create: async () => ({}) },
  };
  const near = {
    network: 'testnet',
    agentPay: async ({ recipient, amount, paymentId }) => {
      sent.push({ recipient, amount, paymentId });
      if (unknown) throw new Error('RPC timeout after submission');
      if (refuse) throw new Error('Contract panicked: over per-transaction limit');
      return { txHash: `tx-${sent.length}`, status: { SuccessValue: Buffer.from('"Settled"').toString('base64') } };
    },
    vaultPayment: async () => ({ recipient: 'dana.testnet', amount: '25000000', agent: 'ag.testnet', status: 'Settled' }),
  };
  const outbox = { enqueue: async () => {} };
  const skypay = new SkyPay({ prisma, near, outbox });
  const bills = new Bills({ prisma, skypay });
  return { prisma, skypay, bills, sent };
}

const form = (o = {}) => ({ name: 'Dana', email: 'Dana@Studio.dev', invoiceNumber: 'D-101', amount: '25', ...o });

test('known supplier: bill matches registry, owner pays once to the REGISTERED account', async () => {
  const { bills, sent } = setup();
  const t = await bills.inboxToken('u1');
  const b = await bills.submit(t, form({ payoutAccount: 'dana.testnet' }));
  assert.equal(b.payeeId, 'p1');
  assert.equal(b.status, 'needs_review');
  assert.deepEqual(b.flags, []);
  const out = await bills.pay('u1', b.id);
  assert.equal(out.bill.status, 'paid');
  assert.deepEqual(sent.map((s) => [s.recipient, s.amount]), [['dana.testnet', '25000000']]);
  // repeat click / retry: no second transfer
  const again = await bills.pay('u1', b.id);
  assert.equal(again.alreadyDispatched, true);
  assert.equal(sent.length, 1);
});

test('changed payout details are flagged and can never redirect funds', async () => {
  const { bills, sent } = setup();
  const t = await bills.inboxToken('u1');
  const b = await bills.submit(t, form({ payoutAccount: 'attacker.testnet' }));
  assert.deepEqual(b.flags, ['payout_changed']);
  assert.equal(b.status, 'flagged');
  await assert.rejects(bills.pay('u1', b.id), { status: 409 }); // needs explicit review
  await bills.pay('u1', b.id, { acknowledgeFlags: true });
  assert.equal(sent[0].recipient, 'dana.testnet'); // registry wins, typed address ignored
});

test('unknown supplier cannot be paid until the owner registers them', async () => {
  const { bills, prisma, sent } = setup();
  const t = await bills.inboxToken('u1');
  const b = await bills.submit(t, form({ email: 'new@vendor.dev', payoutAccount: 'new.testnet' }));
  assert.deepEqual(b.flags, ['unknown_supplier']);
  await assert.rejects(bills.pay('u1', b.id, { acknowledgeFlags: true }), { status: 409 });
  assert.equal(sent.length, 0);
  assert.equal((await prisma.supplierBill.findUnique({ where: { id: b.id } })).status, 'flagged'); // claim not left behind
  prisma.payee.rows.push({ id: 'p2', userId: 'u1', name: 'New', email: 'new@vendor.dev', nearAccount: 'new.testnet' });
  const out = await bills.pay('u1', b.id, { acknowledgeFlags: true });
  assert.equal(out.bill.status, 'paid');
  assert.equal(sent[0].recipient, 'new.testnet');
});

test('duplicates: same invoice number from same sender is refused; similar bill is flagged', async () => {
  const { bills } = setup();
  const t = await bills.inboxToken('u1');
  await bills.submit(t, form());
  await assert.rejects(bills.submit(t, form()), { status: 409 });
  const similar = await bills.submit(t, form({ invoiceNumber: 'D-102' })); // same supplier, same amount
  assert.ok(similar.flags.includes('possible_duplicate'));
});

test('company boundary: another company\'s supplier never matches; foreign owner cannot pay', async () => {
  const { bills } = setup();
  const b = await bills.submit('other-company-token-xyz', form({ email: 'dana@studio.dev' }));
  assert.equal(b.payeeId, null); // Dana is registered with u1, not u2
  await assert.rejects(bills.pay('u1', b.id), { status: 404 });
  await assert.rejects(bills.submit('no-such-token-abcdefgh', form()), { status: 404 });
});

test('on-chain refusal marks failed; retry uses a NEW payment id; unknown outcome is never resent', async () => {
  const s = setup({ refuse: true });
  const t = await s.bills.inboxToken('u1');
  const b = await s.bills.submit(t, form());
  const out = await s.bills.pay('u1', b.id);
  assert.equal(out.bill.status, 'failed');
  await s.bills.pay('u1', b.id);
  assert.equal(s.sent.length, 2);
  assert.notEqual(s.sent[0].paymentId, s.sent[1].paymentId);

  const u = setup({ unknown: true });
  const b2 = await u.bills.submit(await u.bills.inboxToken('u1'), form());
  assert.equal((await u.bills.pay('u1', b2.id)).bill.status, 'unknown');
  await u.bills.pay('u1', b2.id);
  assert.equal(u.sent.length, 1); // no resend
  // reconcile reads the vault and settles the bill
  await u.skypay.reconcile('u1', u.prisma.paymentAttempt.rows[0].id);
  assert.equal((await u.prisma.supplierBill.findUnique({ where: { id: b2.id } })).status, 'paid');
});

test('crash between claim and link: repair links a persisted attempt, or reopens when nothing was sent', async () => {
  const { bills, prisma } = setup();
  const t = await bills.inboxToken('u1');
  await bills.submit(t, form());
  await bills.submit(t, form({ invoiceNumber: 'D-200', amount: '7' }));
  const [a, c] = prisma.supplierBill.rows;
  const old = new Date(Date.now() - 10 * 60_000);
  Object.assign(a, { status: 'paying', tries: 1, updatedAt: old });
  Object.assign(c, { status: 'paying', tries: 1, updatedAt: old });
  prisma.paymentAttempt.rows.push({ id: 'pa1', paymentId: paymentIdFor('u1', `bill:${a.id}:0`), status: 'settled' });
  await bills.repairStuck(5 * 60_000);
  assert.equal(a.status, 'paid');
  assert.equal(a.paymentAttemptId, 'pa1');
  assert.equal(c.status, 'needs_review'); // nothing persisted for it: reopened, not paid
  assert.equal(c.paymentAttemptId, null);
});

test('repair reopens a bill whose request is still in flight: a second Pay can never send a second payment', async () => {
  const s = setup();
  const b = await s.bills.submit(await s.bills.inboxToken('u1'), form());
  // first Pay stalls right before persisting its attempt (e.g. slow DB)
  const realCreate = s.prisma.paymentAttempt.create;
  let release;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  s.prisma.paymentAttempt.create = async (args) => { if (calls++ === 0) await gate; return realCreate(args); };
  const first = s.bills.pay('u1', b.id);
  await new Promise((r) => setTimeout(r, 10));
  // it looks stale: the worker reopens the bill because no attempt row exists yet
  s.prisma.supplierBill.rows[0].updatedAt = new Date(Date.now() - 60 * 60_000);
  await s.bills.repairStuck(0);
  assert.equal(s.prisma.supplierBill.rows[0].status, 'needs_review');
  // owner clicks Pay again, then the stalled request resumes
  const second = await s.bills.pay('u1', b.id);
  release();
  const firstOut = await first;
  assert.equal(s.sent.length, 1, 'exactly one dispatch');
  assert.equal(second.payment.paymentId, firstOut.payment.paymentId, 'both requests resolve to the same payment');
  assert.equal(s.prisma.paymentAttempt.rows.length, 1);
  assert.equal(s.prisma.supplierBill.rows[0].status, 'paid');
});

test('public status shows only the contractor\'s own bill, no flags or registry data', async () => {
  const { bills } = setup();
  const b = await bills.submit(await bills.inboxToken('u1'), form({ payoutAccount: 'attacker.testnet' }));
  const s = await bills.publicStatus(b.statusToken);
  assert.equal(s.status, 'in_review');
  assert.equal(s.company, 'Agency Ltd');
  assert.ok(!('flags' in s) && !('payeeId' in s) && !JSON.stringify(s).includes('dana.testnet'));
  await assert.rejects(bills.publicStatus('bad'), { status: 404 });
});

test('input validation at the public boundary', async () => {
  const { bills } = setup();
  const t = await bills.inboxToken('u1');
  await assert.rejects(bills.submit(t, form({ email: 'nope' })), { status: 400 });
  await assert.rejects(bills.submit(t, form({ amount: '-1' })), { status: 400 });
  await assert.rejects(bills.submit(t, form({ amount: '0' })), { status: 400 });
  await assert.rejects(bills.submit(t, form({ invoiceNumber: '' })), { status: 400 });
  await assert.rejects(bills.submit(t, form({ payoutAccount: 'Not Valid!' })), { status: 400 });
});

test('batch aggregate recovery: missing lines can never read as done; settled lines after reconcile = done', async () => {
  const { skypay, prisma } = setup();
  prisma.payoutBatch.rows.push({ id: 'b1', userId: 'u1', status: 'queued', total: '30', payments: [] });
  prisma.payoutBatch.findFirst = async ({ where }) => {
    const b = prisma.payoutBatch.rows.find((x) => x.id === where.id && x.userId === where.userId);
    return b && { ...b, payments: prisma.paymentAttempt.rows.filter((p) => p.batchId === b.id) };
  };
  prisma.paymentAttempt.rows.push({ id: 'x1', batchId: 'b1', amount: '10', status: 'settled' });
  assert.equal((await skypay.refreshBatch('u1', 'b1')).status, 'partial'); // 10 of 30 dispatched
  prisma.paymentAttempt.rows.push({ id: 'x2', batchId: 'b1', amount: '20', status: 'processing' });
  assert.equal((await skypay.refreshBatch('u1', 'b1')).status, 'processing');
  prisma.paymentAttempt.rows[1].status = 'settled';
  assert.equal((await skypay.refreshBatch('u1', 'b1')).status, 'done');
});
