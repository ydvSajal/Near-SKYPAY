// NEAR Intents 1Click adapter: DRY quotes only (routing + price check, no deposit address, no money moves).
// Intents has no testnet, so a testnet invoice can only be priced against mainnet USDC on NEAR.
// ponytail: dry quotes only; executable quotes (dry:false) + status polling + CheckoutSession rows need mainnet.
const BASE = (process.env.ONECLICK_API_URL || 'https://1click.chaindefuser.com/v0').replace(/[/]$/, '');
export const USDC_ON_NEAR = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const QUOTE_TTL_MS = 10 * 60_000;

const unavailable = (msg) => Object.assign(new Error(`Cross-chain quotes unavailable: ${msg}`), { status: 502 });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

async function call(path, init = {}, fetchImpl = fetch) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.ONECLICK_JWT) headers.authorization = `Bearer ${process.env.ONECLICK_JWT}`;
  let res;
  try {
    res = await fetchImpl(`${BASE}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw unavailable(e.name === 'TimeoutError' ? 'provider timed out' : 'provider unreachable');
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 400) throw bad(`Quote refused by 1Click: ${body.message || 'invalid request'}`);
  if (!res.ok) throw unavailable(body.message || `HTTP ${res.status}`);
  return body;
}

let cache = { at: 0, list: null };
/** Source assets a payer can choose: every 1Click asset that is NOT already on NEAR. Cached 10 min. */
export async function sourceAssets(fetchImpl = fetch) {
  if (cache.list && Date.now() - cache.at < 600_000) return cache.list;
  const all = await call('/tokens', {}, fetchImpl);
  const list = all
    .filter((t) => t.blockchain !== 'near' && t.assetId && Number.isInteger(t.decimals))
    .map(({ assetId, symbol, blockchain, decimals }) => ({ assetId, symbol, blockchain, decimals }))
    .sort((a, b) => a.blockchain.localeCompare(b.blockchain) || a.symbol.localeCompare(b.symbol));
  cache = { at: Date.now(), list };
  return list;
}

/** Build the 1Click request. Destination and amount come only from the server-owned invoice. */
export function buildQuoteRequest(invoice, { originAsset, refundTo }, { assets, now = Date.now() }) {
  if (invoice.status !== 'pending') throw Object.assign(new Error('invoice not payable'), { status: 409 });
  if (invoice.decimals !== 6) throw bad('invoice asset does not map to USDC (6 decimals)');
  if (!/^\d+$/.test(String(invoice.amount)) || BigInt(invoice.amount) <= 0n) throw bad('invalid invoice amount');
  const origin = assets.find((a) => a.assetId === originAsset);
  if (!origin) throw bad('unsupported source asset');
  const refund = String(refundTo || '').trim();
  if (refund.length < 20 || refund.length > 128 || /\s/.test(refund)) throw bad('a refund address on the source chain is required');
  const mainnet = invoice.network === 'near:mainnet';
  return {
    origin,
    mainnet,
    body: {
      dry: true,
      swapType: 'EXACT_OUTPUT', // merchant receives exactly the invoice total
      slippageTolerance: 100, // 1%, absorbed on the payer side for EXACT_OUTPUT
      originAsset: origin.assetId,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: USDC_ON_NEAR,
      amount: String(invoice.amount),
      refundTo: refund,
      refundType: 'ORIGIN_CHAIN',
      // A testnet account cannot receive mainnet USDC; the dry quote is priced to a placeholder mainnet account.
      recipient: mainnet ? invoice.receiver : process.env.INTENTS_QUOTE_RECIPIENT || 'intents.near',
      recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(now + QUOTE_TTL_MS).toISOString(),
      quoteWaitingTimeMs: 3000,
    },
  };
}

export async function dryQuote(invoice, input, fetchImpl = fetch) {
  const assets = await sourceAssets(fetchImpl);
  const { origin, mainnet, body } = buildQuoteRequest(invoice, input, { assets });
  const r = await call('/quote', { method: 'POST', body: JSON.stringify(body) }, fetchImpl);
  const q = r.quote || {};
  if (q.amountOut !== body.amount && q.minAmountOut !== body.amount) throw unavailable('quote does not deliver the invoice amount');
  return {
    mode: 'dry-quote',
    executable: false,
    note: mainnet
      ? 'Price preview from NEAR Intents 1Click. No deposit address was issued and no funds moved.'
      : 'Price preview against mainnet USDC on NEAR. This invoice is on testnet, where NEAR Intents does not run, so it cannot be paid cross-chain.',
    source: origin,
    destination: { assetId: USDC_ON_NEAR, symbol: 'USDC', blockchain: 'near', recipient: body.recipient },
    amountIn: q.amountIn, amountInFormatted: q.amountInFormatted, minAmountIn: q.minAmountIn, amountInUsd: q.amountInUsd,
    amountOut: q.amountOut, amountOutFormatted: q.amountOutFormatted, amountOutUsd: q.amountOutUsd,
    timeEstimateSec: q.timeEstimate, refundFee: q.refundFee,
    appFees: r.quoteRequest?.appFees || [],
    deadline: body.deadline, quotedAt: r.timestamp, correlationId: r.correlationId,
  };
}
