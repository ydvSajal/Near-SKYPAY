// Run: npm test  (no network: fetch is faked)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuoteRequest, dryQuote, USDC_ON_NEAR } from '../lib/intents.js';

const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const assets = [{ assetId: BASE_USDC, symbol: 'USDC', blockchain: 'base', decimals: 6 }];
const inv = { id: 'i1', status: 'pending', amount: '10000000', decimals: 6, network: 'near:testnet', receiver: 'acme.testnet' };
const input = { originAsset: BASE_USDC, refundTo: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D' };

test('A04: dry EXACT_OUTPUT quote; destination and amount come from the invoice only', () => {
  const { body } = buildQuoteRequest(inv, { ...input, amount: '1', recipient: 'evil.near' }, { assets, now: 0 });
  assert.equal(body.dry, true);
  assert.equal(body.swapType, 'EXACT_OUTPUT');
  assert.equal(body.amount, '10000000');
  assert.equal(body.destinationAsset, USDC_ON_NEAR);
  assert.notEqual(body.recipient, 'evil.near');
  assert.equal(body.deadline, new Date(600_000).toISOString());
  assert.equal(buildQuoteRequest({ ...inv, network: 'near:mainnet', receiver: 'acme.near' }, input, { assets }).body.recipient, 'acme.near');
});

test('A04/A05: unpayable invoices, unknown assets and missing refund addresses are refused', () => {
  const refused = [
    [{ ...inv, status: 'paid' }, input],
    [{ ...inv, decimals: 18 }, input],
    [inv, { ...input, originAsset: 'nep141:made-up.near' }],
    [inv, { ...input, refundTo: '' }],
    [inv, { ...input, refundTo: '0x 1' }],
  ];
  refused.forEach(([i, x], n) => assert.throws(() => buildQuoteRequest(i, x, { assets }), undefined, `case ${n}`));
});

test('A20: provider down or wrong amount is reported as unavailable, never as a quote', async () => {
  const fake = (quote) => async (url) => ({
    ok: true, status: 200,
    json: async () => (url.endsWith('/tokens') ? assets : { quote, timestamp: 't', correlationId: 'c', quoteRequest: { appFees: [] } }),
  });
  const ok = await dryQuote(inv, input, fake({ amountIn: '10103045', amountOut: '10000000' }));
  assert.equal(ok.executable, false);
  assert.equal(ok.amountIn, '10103045');
  await assert.rejects(dryQuote(inv, input, fake({ amountIn: '1', amountOut: '9000000', minAmountOut: '9000000' })), /unavailable/);
});
