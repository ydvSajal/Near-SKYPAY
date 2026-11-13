// Run: npm test  (no network, no database)
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPaymentDelegate } from '../lib/near/relayGuard.js';
import { decodePaymentHeader, paymentRequirements } from '../lib/x402.js';

const ctx = { token: 'tusdc.testnet', payTo: 'acme.testnet', minAmount: '10000000', memos: ['INV-0001', 'inv_id_1'], currentBlockHeight: 1000 };
const delegate = (over = {}, action = {}) => ({
  senderId: 'payer.testnet', receiverId: 'tusdc.testnet', publicKey: 'ed25519:x', maxBlockHeight: 1100n,
  actions: [{ kind: 'functionCall', methodName: 'ft_transfer', args: { receiver_id: 'acme.testnet', amount: '10000000', memo: 'INV-0001' }, gas: 30_000_000_000_000n, deposit: 1n, ...action }],
  ...over,
});

test('x402: payment delegate accepted only for an exact-shape ft_transfer to the receiver', () => {
  assert.equal(checkPaymentDelegate(delegate(), ctx).ok, true);
  assert.equal(checkPaymentDelegate(delegate({}, { args: { receiver_id: 'acme.testnet', amount: '99999999', memo: 'inv_id_1' } }), ctx).ok, true); // overpay ok, invoice id memo also binds
  const refused = [
    delegate({ receiverId: 'other.testnet' }),                                                     // wrong token contract
    delegate({}, { methodName: 'mint' }),                                                          // other method
    delegate({}, { methodName: 'ft_transfer_call' }),
    delegate({}, { args: { receiver_id: 'evil.testnet', amount: '10000000' } }),                   // wrong receiver
    delegate({}, { args: { receiver_id: 'acme.testnet', amount: '9999999' } }),                    // underpay
    delegate({}, { args: { receiver_id: 'acme.testnet', amount: '-5' } }),
    delegate({}, { deposit: 0n }),
    delegate({}, { deposit: 10n ** 24n }),
    delegate({}, { gas: 10n ** 15n }),
    delegate({}, { args: { receiver_id: 'acme.testnet', amount: '10000000', memo: 'INV-0002' } }),    // another invoice's memo
    delegate({}, { args: { receiver_id: 'acme.testnet', amount: '10000000' } }),                       // no memo
    delegate({ maxBlockHeight: 999n }),                                                            // expired
    delegate({ maxBlockHeight: 4000n }),                                                           // too far
    delegate({ actions: [{ kind: 'other' }] }),
    delegate({ actions: [delegate().actions[0], delegate().actions[0]] }),
  ];
  refused.forEach((d, i) => assert.equal(checkPaymentDelegate(d, ctx).ok, false, `case ${i} must be refused`));
});

test('x402: 402 requirements describe the invoice exactly', () => {
  const inv = { id: 'inv1', number: 'INV-0001', amount: '10000000', decimals: 6, network: 'near:testnet', receiver: 'acme.testnet', assetContract: 'tusdc.testnet' };
  const r = paymentRequirements(inv, { baseUrl: 'http://api', assetName: 'tUSDC' });
  assert.deepEqual([r.scheme, r.network, r.maxAmountRequired, r.payTo, r.asset, r.resource], ['exact', 'near-testnet', '10000000', 'acme.testnet', 'tusdc.testnet', 'http://api/x402pay/inv1']);
  assert.equal(r.extra.facilitator, 'http://api/x402');
});

test('x402: X-PAYMENT header decoding', () => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  assert.equal(decodePaymentHeader(enc({ x402Version: 1, scheme: 'exact', network: 'near-testnet', payload: { txHash: 'x' } })).payload.txHash, 'x');
  assert.throws(() => decodePaymentHeader('not-base64-json!'), /base64 JSON/);
  assert.throws(() => decodePaymentHeader(enc({ x402Version: 2, scheme: 'exact', payload: {} })), /unsupported/);
  assert.throws(() => decodePaymentHeader(enc({ x402Version: 1, scheme: 'upto', payload: {} })), /unsupported/);
});
