// x402 on NEAR, self-hosted facilitator. No third party, no API key.
//  GET  /x402pay/:invoiceId  -> 402 + payment requirements (humans with a browser are sent to the checkout page)
//        retry with `X-PAYMENT` -> verify + settle + 200 with receipt and `X-PAYMENT-RESPONSE`
//  GET  /x402/supported, POST /x402/verify, POST /x402/settle  -> standard facilitator API
// Scheme "exact" on network "near-testnet" is SkyPay's own NEAR mapping (not an official x402 network).
// Two payload shapes:
//   { signedDelegate }       payer signs one ft_transfer (NEP-366); SkyPay's sponsor submits it, payer pays no gas
//   { txHash, sender }       payer already sent the transfer; we only read the chain
// Settlement truth is always chain data via SkyPay.confirmInvoicePayment (token events, receiver, amount, once).
import express from 'express';

export const X402_VERSION = 1;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

export function decodePaymentHeader(h) {
  let p;
  try {
    p = JSON.parse(Buffer.from(String(h), 'base64').toString('utf8'));
  } catch {
    throw Object.assign(new Error('X-PAYMENT is not base64 JSON'), { status: 400 });
  }
  if (p?.x402Version !== X402_VERSION || p.scheme !== 'exact' || !p.payload || typeof p.payload !== 'object') {
    throw Object.assign(new Error('unsupported X-PAYMENT (need x402Version 1, scheme exact, payload)'), { status: 400 });
  }
  return p;
}

/** Pure: the `accepts` entry for an invoice. */
export function paymentRequirements(inv, { baseUrl, assetName = 'USDC' }) {
  return {
    scheme: 'exact', network: `near-${inv.network.replace(/^near:/, '')}`, maxAmountRequired: inv.amount,
    resource: `${baseUrl}/x402pay/${inv.id}`, description: `Invoice ${inv.number}`, mimeType: 'application/json',
    payTo: inv.receiver, maxTimeoutSeconds: 300, asset: inv.assetContract,
    extra: { name: assetName, decimals: inv.decimals, invoiceId: inv.id, facilitator: `${baseUrl}/x402` },
  };
}

export function createX402Router({ prisma, near, skypay, baseUrl, appUrl }) {
  const r = express.Router();
  const base = String(baseUrl || '').replace(/\/$/, '');
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'x402 error' });
    if (!e.status) console.error('x402:', e);
  });
  const network = `near-${near.network}`;
  const reqs = (inv) => paymentRequirements(inv, { baseUrl: base, assetName: near.token?.includes('tusdc') ? 'tUSDC' : 'USDC' });

  /** Verify without settling. Returns {isValid, invalidReason?, payer?, parsed}. */
  async function verify(inv, payment) {
    if (payment.network !== network) return { isValid: false, invalidReason: `network must be ${network}` };
    const p = payment.payload;
    try {
      if (p.signedDelegate) {
        const parsed = await near.checkPaymentDelegateB64(p.signedDelegate, { payTo: inv.receiver, minAmount: inv.amount });
        return { isValid: true, payer: parsed.d.senderId, parsed };
      }
      if (p.txHash) {
        const v = await near.verifyTokenReceipt({ txHash: p.txHash, senderHint: p.sender, receiver: inv.receiver, minAmount: inv.amount });
        return v.ok ? { isValid: true, payer: v.from } : { isValid: false, invalidReason: v.reason };
      }
    } catch (e) {
      return { isValid: false, invalidReason: e.message };
    }
    return { isValid: false, invalidReason: 'payload needs signedDelegate or txHash' };
  }

  /** Settle: submit (if delegate) then close the invoice from chain data. */
  async function settle(inv, payment, rateKey) {
    const v = await verify(inv, payment);
    if (!v.isValid) return { success: false, errorReason: v.invalidReason, network };
    const p = payment.payload;
    let txHash = p.txHash, sender = p.sender;
    if (p.signedDelegate) {
      const sent = await near.relayPayment({ ...v.parsed, signedDelegateB64: p.signedDelegate, rateKey });
      if (sent.status?.Failure) return { success: false, errorReason: 'transfer failed on-chain', transaction: sent.txHash, network };
      txHash = sent.txHash; sender = near.relayerId; // the sponsor signs the outer transaction
    }
    try {
      const out = await skypay.confirmInvoicePayment(inv.id, { txHash, senderAccountId: sender });
      return { success: true, transaction: out.invoice.settledTxHash || txHash, network, payer: v.payer, invoice: out.invoice };
    } catch (e) {
      return { success: false, errorReason: e.message, transaction: txHash, network };
    }
  }

  const invoice = (id) => prisma.invoice.findUnique({ where: { id: String(id) } });

  // ---- resource: the pay link
  r.get('/x402pay/:id', wrap(async (req, res) => {
    const inv = await invoice(req.params.id);
    if (!inv) return res.status(404).json({ error: 'invoice not found' });
    const header = req.get('x-payment');
    if (!header && inv.status === 'pending' && req.accepts(['json', 'html']) === 'html') {
      return res.redirect(302, `${appUrl}/invoice/${inv.id}`); // a person in a browser gets the checkout page
    }
    const receipt = (extra) => ({ invoiceId: inv.id, number: inv.number, status: inv.status, amount: inv.amount, asset: inv.assetContract, ...extra });
    if (inv.status === 'paid') {
      res.set('X-PAYMENT-RESPONSE', b64({ success: true, transaction: inv.settledTxHash, network }));
      return res.json(receipt({ transaction: inv.settledTxHash, txUrl: near.explorerTx(inv.settledTxHash), alreadyPaid: true }));
    }
    const challenge = (error) => res.status(402).json({ x402Version: X402_VERSION, error, accepts: inv.status === 'pending' ? [reqs(inv)] : [] });
    if (inv.status !== 'pending') return challenge(`invoice is ${inv.status}`);
    if (!header) return challenge('X-PAYMENT header is required');

    let payment;
    try { payment = decodePaymentHeader(header); } catch (e) { return challenge(e.message); }
    const out = await settle(inv, payment, req.ip);
    if (!out.success) return challenge(out.errorReason);
    res.set('X-PAYMENT-RESPONSE', b64({ success: true, transaction: out.transaction, network, payer: out.payer }));
    res.json(receipt({ status: out.invoice.status, transaction: out.transaction, txUrl: near.explorerTx(out.transaction), payer: out.payer }));
  }));

  // ---- facilitator API (same shapes as x402 facilitators)
  r.get('/x402/supported', (req, res) => res.json({ kinds: [{ x402Version: X402_VERSION, scheme: 'exact', network }] }));

  const fromBody = async (body) => {
    const id = body?.paymentRequirements?.extra?.invoiceId;
    const inv = id ? await invoice(id) : null;
    if (!inv || inv.status !== 'pending') throw Object.assign(new Error('unknown or non-pending invoice'), { status: 404 });
    const rq = body.paymentRequirements;
    if (rq.payTo !== inv.receiver || rq.asset !== inv.assetContract || String(rq.maxAmountRequired) !== inv.amount) {
      throw Object.assign(new Error('paymentRequirements do not match the invoice'), { status: 422 });
    }
    return { inv, payment: body.paymentPayload || {} };
  };

  r.post('/x402/verify', wrap(async (req, res) => {
    const { inv, payment } = await fromBody(req.body);
    const v = await verify(inv, payment);
    res.json({ isValid: v.isValid, invalidReason: v.invalidReason, payer: v.payer });
  }));

  r.post('/x402/settle', wrap(async (req, res) => {
    const { inv, payment } = await fromBody(req.body);
    const out = await settle(inv, payment, req.ip);
    const { invoice: _omit, ...pub } = out;
    res.status(out.success ? 200 : 422).json(pub);
  }));

  return r;
}
