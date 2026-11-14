// Run: npm test   (node:test, no network, no database)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits, formatUnits, sumLineItems } from '../lib/near/units.js';
import { csvCell, invoicesCsv } from '../lib/csvExport.js';
import { checkDelegate } from '../lib/near/relayGuard.js';
import { NearService } from '../lib/near/NearService.js';
import { parseOutcome } from '../lib/skypay.js';

test('money: integer base units, no float drift', () => {
  assert.equal(parseUnits('0.1'), '100000');
  assert.equal(parseUnits('12.345678'), '12345678');
  assert.equal(formatUnits('100000'), '0.1');
  assert.equal(sumLineItems([{ quantity: 3, unitAmount: parseUnits('0.1') }]), '300000'); // 0.1*3 != 0.30000000000000004
  assert.throws(() => parseUnits('1.0000001'), /decimal places/);
  assert.throws(() => parseUnits('-5'), /invalid/);
  assert.throws(() => parseUnits('1e3'), /invalid/);
});

test('A24: CSV neutralises spreadsheet formulas and quotes properly', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
  assert.equal(csvCell('+1-555'), "'+1-555");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('Acme, Inc.'), '"Acme, Inc."');
  assert.equal(csvCell('plain'), 'plain');
});

test('A23: invoice CSV has fixed decimals, UTC times, tx link', () => {
  const csv = invoicesCsv([{
    id: 'c1', number: 'INV-0001', customerName: '=cmd', customerEmail: 'a@b.co', description: 'Design',
    createdAt: new Date('2026-11-13T10:00:00Z'), dueDate: new Date('2026-11-27T00:00:00Z'), asset: 'USDC', amount: '10000000',
    decimals: 6, status: 'paid', assetContract: 'usdc.testnet', network: 'near:testnet', receiver: 'acme.testnet',
    settledAmount: '10000000', settledAt: new Date('2026-11-13T11:00:00Z'), settledTxHash: 'HASH1',
  }], (h) => `https://x/txns/${h}`);
  const [head, row] = csv.trim().split('\r\n');
  assert.match(head, /^invoice_id,invoice_number/);
  assert.match(row, /,'=cmd,/);
  assert.match(row, /,10\.000000,paid,/);
  assert.match(row, /2026-11-13T11:00:00\.000Z,HASH1,https:\/\/x\/txns\/HASH1$/);
});

const ctx = { userAccount: 'acme.r.testnet', userPublicKey: 'ed25519:OWNER', vault: 'v-acme.r.testnet', token: 'usdc.testnet', currentBlockHeight: 1000 };
const fc = (receiverId, methodName, args, deposit = 0n, extra = {}) => ({
  senderId: 'acme.r.testnet', receiverId, publicKey: 'ed25519:OWNER', maxBlockHeight: 1100n,
  actions: [{ kind: 'functionCall', methodName, args, gas: 30_000_000_000_000n, deposit }], ...extra,
});

test('A21/A22: relay sponsors only the owner policy and own-vault funding', () => {
  assert.ok(checkDelegate(fc(ctx.vault, 'set_agent', { agent: 'agent.testnet', per_tx_limit: '10', daily_limit: '20', expires_at_ms: 1800000000000 }), ctx).ok);
  assert.ok(checkDelegate(fc(ctx.token, 'ft_transfer_call', { receiver_id: ctx.vault, amount: '5', msg: 'fund' }, 1n), ctx).ok);

  const refused = (d, re) => { const v = checkDelegate(d, ctx); assert.equal(v.ok, false); assert.match(v.reason, re); };
  refused(fc(ctx.vault, 'pay', {}), /not sponsored/);
  refused(fc(ctx.token, 'ft_transfer', { receiver_id: 'mallory.testnet', amount: '5' }, 1n), /not sponsored/);
  refused(fc(ctx.token, 'ft_transfer_call', { receiver_id: 'mallory.testnet', amount: '5', msg: 'fund' }, 1n), /own|vault/);
  refused(fc('random.testnet', 'set_agent', {}), /approved SkyPay contract/);
  refused(fc(ctx.vault, 'withdraw', { amount: '1' }, 5n), /no deposit/);
  refused(fc(ctx.vault, 'set_agent', {}, 0n, { senderId: 'other.testnet' }), /sender/);
  refused(fc(ctx.vault, 'set_agent', {}, 0n, { publicKey: 'ed25519:STOLEN' }), /owner key/);
  refused(fc(ctx.vault, 'set_agent', {}, 0n, { maxBlockHeight: 999n }), /expired/);
  refused({ ...fc(ctx.vault, 'set_agent', {}), actions: [{ kind: 'other' }] }, /only function calls/);
  refused({ ...fc(ctx.vault, 'set_agent', {}), actions: [fc(ctx.vault, 'set_agent', {}).actions[0], fc(ctx.vault, 'set_agent', {}).actions[0]] }, /exactly one/);
});

const ev = (executor, data, failure) => ({
  outcome: { executor_id: executor, status: failure ? { Failure: {} } : { SuccessValue: '' },
    logs: [`EVENT_JSON:${JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data })}`] },
});

test('A06/A05: settlement verified from token events, not client claims', () => {
  const opts = { token: 'usdc.testnet', receiver: 'acme.testnet', minAmount: '10000000', memos: ['INV-0001'] };
  const ok = { status: { SuccessValue: '' }, receipts_outcome: [ev('usdc.testnet', [{ old_owner_id: 'c.testnet', new_owner_id: 'acme.testnet', amount: '10000000', memo: 'INV-0001' }])] };
  assert.equal(NearService.evaluateReceipt(ok, opts).ok, true);

  const under = { ...ok, receipts_outcome: [ev('usdc.testnet', [{ old_owner_id: 'c', new_owner_id: 'acme.testnet', amount: '9999999', memo: 'INV-0001' }])] };
  assert.match(NearService.evaluateReceipt(under, opts).reason, /below/);

  const fakeToken = { ...ok, receipts_outcome: [ev('fake-usdc.testnet', [{ old_owner_id: 'c', new_owner_id: 'acme.testnet', amount: '10000000', memo: 'INV-0001' }])] };
  assert.equal(NearService.evaluateReceipt(fakeToken, opts).ok, false);

  const wrongReceiver = { ...ok, receipts_outcome: [ev('usdc.testnet', [{ old_owner_id: 'c', new_owner_id: 'mallory.testnet', amount: '10000000', memo: 'INV-0001' }])] };
  assert.equal(NearService.evaluateReceipt(wrongReceiver, opts).ok, false);

  const failed = { status: { Failure: {} }, receipts_outcome: ok.receipts_outcome };
  assert.equal(NearService.evaluateReceipt(failed, opts).ok, false);
});

test('vault outcome mapping', () => {
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64');
  assert.equal(parseOutcome({ SuccessValue: b64('Settled') }).status, 'settled');
  assert.equal(parseOutcome({ SuccessValue: b64('Failed') }).status, 'failed');
  assert.equal(parseOutcome({ Failure: { ActionError: {} } }).status, 'unknown');
  assert.equal(parseOutcome(undefined).status, 'unknown');
});


test('sponsor validates owner method arguments before spending gas', () => {
  for (const [method, args] of [
    ['set_agent', { agent: 'a' }], ['withdraw', { amount: '-1' }],
    ['withdraw', { amount: (1n << 128n).toString() }], ['add_payee', { payee: 'INVALID!' }],
    ['revoke_agent', { agent: 'agent.testnet', extra: true }],
  ]) assert.equal(checkDelegate(fc(ctx.vault, method, args), ctx).ok, false);
  assert.equal(checkDelegate(fc(ctx.vault, 'withdraw', { amount: '10' }), ctx).ok, true);
});

test('settlement rejects pending top-level and token receipt outcomes', () => {
  const opts = { token: 'usdc.testnet', receiver: 'co.testnet', minAmount: '1', memos: ['INV-0001'] };
  const receipt = ev('usdc.testnet', [{ old_owner_id: 'client.testnet', new_owner_id: 'co.testnet', amount: '1', memo: 'INV-0001' }]);
  assert.equal(NearService.evaluateReceipt({ status: { SuccessReceiptId: 'pending' }, receipts_outcome: [receipt] }, opts).ok, false);
  receipt.outcome.status = { SuccessReceiptId: 'pending' };
  assert.equal(NearService.evaluateReceipt({ status: { SuccessValue: '' }, receipts_outcome: [receipt] }, opts).ok, false);
});

test('settlement is bound to one invoice: memo must match, other memos never add up', () => {
  const opts = { token: 'usdc.testnet', receiver: 'acme.testnet', minAmount: '10000000', memos: ['INV-0001', 'inv_id_1'] };
  const tx = (...data) => ({ status: { SuccessValue: '' }, receipts_outcome: [ev('usdc.testnet', data)] });
  const t = (amount, memo) => ({ old_owner_id: 'c.testnet', new_owner_id: 'acme.testnet', amount, ...(memo ? { memo } : {}) });
  assert.equal(NearService.evaluateReceipt(tx(t('10000000', 'INV-0001')), opts).ok, true);
  assert.equal(NearService.evaluateReceipt(tx(t('10000000', 'inv_id_1')), opts).ok, true); // x402 uses the invoice id
  const other = NearService.evaluateReceipt(tx(t('10000000', 'INV-0002')), opts);
  assert.equal(other.ok, false); assert.match(other.reason, /not tagged with this invoice/);
  assert.equal(NearService.evaluateReceipt(tx(t('10000000')), opts).ok, false); // no memo
  // 6 for this invoice + 6 for another must not add up to pay a 10 invoice
  assert.match(NearService.evaluateReceipt(tx(t('6000000', 'INV-0001'), t('6000000', 'INV-0002')), opts).reason, /below/);
  assert.equal(NearService.evaluateReceipt(tx(t('10000000', 'INV-0001')), { ...opts, memos: undefined }).ok, false); // binding cannot be skipped
});

test('settlement counts only what the receiver kept: ft_transfer_call refunds and burns are subtracted', () => {
  const opts = { token: 'usdc.testnet', receiver: 'acme.testnet', minAmount: '10000000', memos: ['INV-0001'] };
  const pay = { old_owner_id: 'c.testnet', new_owner_id: 'acme.testnet', amount: '10000000', memo: 'INV-0001' };
  const refund = (amount) => ({ old_owner_id: 'acme.testnet', new_owner_id: 'c.testnet', amount, memo: 'refund' });
  const burnEv = (amount) => ({ outcome: { executor_id: 'usdc.testnet', status: { SuccessValue: '' },
    logs: [`EVENT_JSON:${JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_burn', data: [{ owner_id: 'acme.testnet', amount }] })}`] } });
  // transfer-call chain: transfer receipt, receiver's (failed) ft_on_transfer, then ft_resolve_transfer refund
  const chain = (...tail) => ({ status: { SuccessValue: '' }, receipts_outcome: [
    ev('usdc.testnet', [pay]),
    { outcome: { executor_id: 'acme.testnet', status: { Failure: {} }, logs: [] } },
    ...tail,
  ] });

  const full = NearService.evaluateReceipt(chain(ev('usdc.testnet', [refund('10000000')])), opts);
  assert.equal(full.ok, false); assert.match(full.reason, /refunded/);

  const partial = NearService.evaluateReceipt(chain(ev('usdc.testnet', [refund('4000000')])), opts);
  assert.equal(partial.ok, false); assert.match(partial.reason, /below/); assert.equal(partial.received, '6000000');

  const burned = NearService.evaluateReceipt(chain(burnEv('10000000')), opts);
  assert.equal(burned.ok, false);

  // transfer-call where the receiver keeps everything (resolve emits no refund event) still settles
  assert.equal(NearService.evaluateReceipt(chain(), opts).ok, true);
  // overpayment with a small refund still covers the invoice
  const over = { ...pay, amount: '12000000' };
  const r = NearService.evaluateReceipt({ status: { SuccessValue: '' }, receipts_outcome: [ev('usdc.testnet', [over]), ev('usdc.testnet', [refund('2000000')])] }, opts);
  assert.equal(r.ok, true); assert.equal(r.received, '10000000');
});
