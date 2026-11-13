// Live NEAR Intents 1Click DRY quotes for a 10 USDC invoice (no keys, no money moves).
// Run: node scripts/intents-quote.mjs > ../../evidence/intents-dry-quote.txt
import { dryQuote } from '../lib/intents.js';

const invoice = { id: 'demo', status: 'pending', amount: '10000000', decimals: 6, network: 'near:testnet', receiver: 'demo.testnet' };
const routes = [
  ['Base USDC', 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', '0x2527D02599Ba641c19FEa793cD0F167589a0f10D'],
  ['Arbitrum USDC', 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', '0x2527D02599Ba641c19FEa793cD0F167589a0f10D'],
  ['Ethereum ETH', 'nep141:eth.omft.near', '0x2527D02599Ba641c19FEa793cD0F167589a0f10D'],
  ['Solana SOL', 'nep141:sol.omft.near', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'],
];

console.log(`# NEAR Intents 1Click dry quotes, ${new Date().toISOString()}`);
console.log('# Invoice total: 10 USDC on NEAR (EXACT_OUTPUT). dry=true: no deposit address issued, no funds moved.');
console.log('# Refund addresses are public example addresses used only to satisfy request validation.\n');
for (const [label, originAsset, refundTo] of routes) {
  try {
    const q = await dryQuote(invoice, { originAsset, refundTo });
    console.log(`${label.padEnd(14)} send ${q.amountInFormatted} ${q.source.symbol} (min ${q.minAmountIn} base units, ~$${Number(q.amountInUsd).toFixed(4)})`
      + ` -> receive ${q.amountOutFormatted} USDC on NEAR | ~${q.timeEstimateSec}s | refundFee ${q.refundFee}`
      + ` | appFees ${JSON.stringify(q.appFees.map((f) => f.fee))} bps | correlationId ${q.correlationId}`);
  } catch (e) {
    console.log(`${label.padEnd(14)} ${e.message}`);
  }
}
