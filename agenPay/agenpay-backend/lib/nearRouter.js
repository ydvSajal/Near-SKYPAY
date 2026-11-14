// HTTP routes for the NEAR workflow: company setup, sponsored relay, payees, vault payments,
// invoices (private + public checkout), and accountant exports. All private reads are scoped to req.user.id (A17).
import express from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { formatUnits, parseUnits } from './near/units.js';
import { invoicesCsv, paymentsCsv } from './csvExport.js';
import { dryQuote, sourceAssets } from './intents.js';
import { sellerOf } from './skypay.js';
import { Prisma } from '@prisma/client';

const YOCTO = 10n ** 24n;
const toNear = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(4); // display only
const PAYMENT_RECORD_BYTES = 400n; // generous per-payment storage estimate (record + map key)

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    if (!e.status) console.error('❌', req.method, req.originalUrl, e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'internal error' });
  });

export function createNearRouter({ prisma, near, skypay, authenticateToken }) {
  const r = express.Router();
  const publicLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
  const pollLimiter = rateLimit({ windowMs: 60_000, max: 90, standardHeaders: true, legacyHeaders: false }); // checkout page polls every 2 s
  const me = (req) => skypay.user(req.user.id);
  const x402Base = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/[/]$/, '');
  const isTestToken = process.env.NEAR_USDC_IS_TEST_TOKEN === 'true';

  // ------------------------------------------------------------ company setup
  r.get('/api/near/status', authenticateToken, wrap(async (req, res) => {
    const u = await me(req);
    const out = {
      configured: near.configured, network: near.network, token: near.token, isTestToken,
      tokenLabel: isTestToken ? 'tUSDC (testnet test token, no value)' : 'USDC',
      relayer: near.relayerId, company: u.nearAccountId, vault: u.vaultAccountId, agent: u.agentAccountId,
      ownerPublicKey: u.nearPublicKey,
      // interrupted setup: the owner key it was started with, so the UI can ask for that backup
      setupInProgress: u.provisionState ? { ownerPublicKey: u.provisionState.ownerPublicKey, done: u.provisionState.done || [] } : null,
    };
    const sponsor = near.configured ? await near.accountInfo(near.relayerId) : null;
    out.sponsor = sponsor ? { account: near.relayerId, balanceNear: toNear(sponsor.amount), low: BigInt(sponsor.amount) < 3n * YOCTO } : null;
    if (u.vaultAccountId) {
      const [bal, vault, agent, vaultAcct, agentKeys] = await Promise.all([
        near.ftBalance(u.nearAccountId), near.vaultState(u.vaultAccountId), near.vaultAgent(u.vaultAccountId, u.agentAccountId),
        near.accountInfo(u.vaultAccountId), near.accessKeys(u.agentAccountId).catch(() => null), // null = could not read
      ]);
      // gas allowance of the restricted agent key: adding NEAR to the agent account does NOT refill it
      const fc = agentKeys?.find((k) => k.permission?.FunctionCall)?.permission.FunctionCall;
      const allowance = fc?.allowance ?? null;
      // storage reserve: NEAR above what current state locks; each new payment record locks a little more
      const free = vaultAcct ? BigInt(vaultAcct.amount) - BigInt(vaultAcct.storage_usage) * 10n ** 19n : 0n;
      Object.assign(out, {
        companyBalance: bal, vaultAvailable: vault.available, vaultReserved: vault.reserved, agentPolicy: agent,
        agentKey: agentKeys === null ? undefined : { present: !!fc, allowanceNear: allowance === null ? null : toNear(allowance),
          low: allowance !== null && BigInt(allowance) < YOCTO / 50n, // < 0.02 NEAR ≈ a few dozen payments
          payMethods: fc?.method_names || [] },
        vaultStorage: { freeNear: toNear(free > 0n ? free : 0n), approxPaymentsLeft: (free > 0n ? free / (PAYMENT_RECORD_BYTES * 10n ** 19n) : 0n).toString() },
        links: { company: near.explorerAccount(u.nearAccountId), vault: near.explorerAccount(u.vaultAccountId), agent: near.explorerAccount(u.agentAccountId) },
      });
    }
    res.json(out);
  }));

  // Resumable: progress (incl. encrypted keys generated before each account exists) is saved after every step,
  // so a retry after a crash/timeout continues the same accounts. One setup per company at a time.
  const provisioning = new Set(); // ponytail: process-local lock; a DB advisory lock if the API ever runs >1 instance
  r.post('/api/near/provision', authenticateToken, wrap(async (req, res) => {
    const u = await me(req);
    if (u.nearAccountId) return res.status(409).json({ error: 'already provisioned', company: u.nearAccountId });
    const publicKey = String(req.body.publicKey || '');
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(publicKey)) return res.status(400).json({ error: 'ed25519 public key required' });
    if (provisioning.has(u.id)) return res.status(409).json({ error: 'setup already running; wait for it to finish' });
    provisioning.add(u.id);
    try {
      const state = u.provisionState || null;
      const base = (u.name || u.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'co';
      const slug = state?.slug || `${base}${crypto.randomBytes(2).toString('hex')}`;
      const p = await near.provision({
        slug, ownerPublicKey: publicKey, state,
        save: (s) => prisma.user.update({ where: { id: u.id }, data: { provisionState: s } }),
      });
      await prisma.user.update({
        where: { id: u.id },
        data: { nearAccountId: p.company, nearPublicKey: publicKey, vaultAccountId: p.vault, agentAccountId: p.agent, agentKeyEnc: p.agentKeyEnc, provisionState: Prisma.DbNull },
      });
      if (p.log.length) await prisma.sponsorLedger.createMany({ data: p.log.map((l) => ({ userId: u.id, kind: l.kind, detail: l.detail })) });
      res.json({ company: p.company, vault: p.vault, agent: p.agent, sponsored: p.log, resumed: !!state });
    } finally {
      provisioning.delete(u.id);
    }
  }));

  // Sponsored owner actions: browser signs a delegate action, relayer pays gas (A21, A22).
  r.post('/api/near/relay', authenticateToken, wrap(async (req, res) => {
    const u = await me(req);
    const out = await near.relay({ signedDelegateB64: String(req.body.signedDelegate || ''), user: u });
    await prisma.sponsorLedger.create({ data: { userId: u.id, kind: 'relay', detail: String(req.body.label || '').slice(0, 80), txHash: out.txHash } });
    const failure = out.status?.Failure;
    res.status(failure ? 422 : 200).json({ txHash: out.txHash, url: near.explorerTx(out.txHash), failure: failure || null });
  }));

  // Testnet-only convenience: mint test tokens into the company account so the owner can fund the vault.
  r.post('/api/near/test-faucet', authenticateToken, wrap(async (req, res) => {
    if (!isTestToken) return res.status(404).json({ error: 'not available with real USDC' });
    const u = await me(req);
    if (!u.nearAccountId) return res.status(409).json({ error: 'not provisioned' });
    const x = await near.relayer().callFunctionRaw({
      contractId: near.token, methodName: 'mint', args: { account_id: u.nearAccountId, amount: parseUnits('100') }, gas: 30_000_000_000_000n,
    });
    res.json({ minted: '100', txHash: x.transaction.hash, url: near.explorerTx(x.transaction.hash), label: 'TEST tokens, no value' });
  }));

  // ------------------------------------------------------------------ payees
  r.get('/api/payees', authenticateToken, wrap(async (req, res) => {
    const u = await me(req);
    const list = await prisma.payee.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
    const withChain = await Promise.all(list.map(async (p) => ({
      ...p, allowListedOnChain: u.vaultAccountId ? await near.view(u.vaultAccountId, 'is_payee', { payee: p.nearAccount }) : false,
    })));
    res.json({ payees: withChain });
  }));

  r.post('/api/payees', authenticateToken, wrap(async (req, res) => {
    res.json({ payee: await skypay.addPayee(req.user.id, req.body || {}) });
  }));

  r.patch('/api/payees/:id', authenticateToken, wrap(async (req, res) => {
    res.json({ payee: await skypay.updatePayee(req.user.id, req.params.id, req.body || {}) });
  }));

  r.delete('/api/payees/:id', authenticateToken, wrap(async (req, res) => {
    await skypay.removePayee(req.user.id, req.params.id);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------- vault payments
  const payView = (p) => ({ ...p, amountFormatted: formatUnits(p.amount), url: p.txHash ? near.explorerTx(p.txHash) : null });

  r.get('/api/vault/payments', authenticateToken, wrap(async (req, res) => {
    const list = await prisma.paymentAttempt.findMany({ where: { userId: req.user.id, direction: 'OUT' }, orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ payments: list.map(payView) });
  }));

  r.post('/api/vault/payout-batches', authenticateToken, wrap(async (req, res) => {
    const out = await skypay.payBatch(req.user.id, req.body || {});
    res.json({ batch: { ...out.batch, totalFormatted: formatUnits(out.batch.total) }, payments: out.payments.map(payView) });
  }));

  r.get('/api/vault/payout-batches', authenticateToken, wrap(async (req, res) => {
    const list = await prisma.payoutBatch.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 20, include: { payments: { orderBy: { createdAt: 'asc' } } } });
    res.json({ batches: list.map((b) => ({ ...b, totalFormatted: formatUnits(b.total), payments: b.payments.map(payView) })) });
  }));

  r.post('/api/vault/payments', authenticateToken, wrap(async (req, res) => {
    const a = await skypay.paySupplier(req.user.id, req.body || {});
    const payment = { ...a, url: a.txHash ? near.explorerTx(a.txHash) : null };
    if (a.status === 'failed') {
      return res.status(422).json({ error: `Refused by vault: ${String(a.error).replace(/^.*Contract panicked: /, '')}`, payment });
    }
    res.json({ payment });
  }));

  r.post('/api/vault/payments/:id/reconcile', authenticateToken, wrap(async (req, res) => {
    res.json({ payment: await skypay.reconcile(req.user.id, req.params.id) });
  }));

  // ---------------------------------------------------------------- invoices
  const view = (i) => ({
    ...i, amountFormatted: formatUnits(i.amount, i.decimals), settledFormatted: i.settledAmount ? formatUnits(i.settledAmount, i.decimals) : null,
    txUrl: i.settledTxHash ? near.explorerTx(i.settledTxHash) : null, x402Link: `${x402Base}/x402pay/${i.id}`,
  });

  r.get('/api/invoices', authenticateToken, wrap(async (req, res) => {
    const list = await prisma.invoice.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } });
    res.json({ invoices: list.map(view) });
  }));

  r.post('/api/invoices', authenticateToken, wrap(async (req, res) => {
    const inv = await skypay.createInvoice(req.user.id, req.body || {});
    res.status(201).json({ invoice: view(inv) });
  }));

  // public checkout data: no secrets, no other invoices, no customer list
  r.get('/api/public/invoices/:id', pollLimiter, wrap(async (req, res) => {
    const i = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { user: true } });
    if (!i) return res.status(404).json({ error: 'invoice not found' });
    const seller = i.seller || sellerOf(i.user); // invoices issued before profiles existed fall back to the live profile
    res.json({
      id: i.id, number: i.number, merchant: seller.name, seller, customerName: i.customerName, customerEmail: i.customerEmail,
      description: i.description, lineItems: i.lineItems.map((li) => ({ ...li, unitFormatted: formatUnits(li.unitAmount, i.decimals) })),
      amount: i.amount, amountFormatted: formatUnits(i.amount, i.decimals), asset: i.asset, assetContract: i.assetContract,
      decimals: i.decimals, network: i.network, receiver: i.receiver, dueDate: i.dueDate, createdAt: i.createdAt, status: i.status,
      settledAmount: i.settledAmount, settledAt: i.settledAt, settledTxHash: i.settledTxHash,
      txUrl: i.settledTxHash ? near.explorerTx(i.settledTxHash) : null, isTestToken, relayer: near.relayerId,
      x402Link: `${x402Base}/x402pay/${i.id}`,
    });
  }));

  r.post('/api/public/invoices/:id/confirm', publicLimiter, wrap(async (req, res) => {
    const out = await skypay.confirmInvoicePayment(req.params.id, req.body || {});
    res.json({ status: out.invoice.status, alreadyPaid: !!out.alreadyPaid, txUrl: out.invoice.settledTxHash ? near.explorerTx(out.invoice.settledTxHash) : null });
  }));

  // NEAR Intents 1Click: DRY quotes only. A price/route preview, never a deposit address or a settlement.
  r.get('/api/public/intents/assets', publicLimiter, wrap(async (_req, res) => {
    res.json({ assets: await sourceAssets() });
  }));

  r.post('/api/public/invoices/:id/intents-quote', publicLimiter, wrap(async (req, res) => {
    const i = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!i) return res.status(404).json({ error: 'invoice not found' });
    res.json({ quote: await dryQuote(i, { originAsset: req.body?.originAsset, refundTo: req.body?.refundTo }) });
  }));

  // TESTNET demo payer: a real testnet transfer of TEST tokens from SkyPay's demo wallet, then verified like any other payment.
  r.post('/api/public/invoices/:id/demo-pay', publicLimiter, wrap(async (req, res) => {
    if (!isTestToken) return res.status(404).json({ error: 'demo payer only exists on testnet with the test token' });
    const i = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!i || i.status !== 'pending') return res.status(409).json({ error: 'invoice not payable' });
    const payer = near.relayer();
    await payer.callFunctionRaw({ contractId: near.token, methodName: 'mint', args: { account_id: near.relayerId, amount: i.amount }, gas: 30_000_000_000_000n });
    const tx = await payer.callFunctionRaw({
      contractId: near.token, methodName: 'ft_transfer', args: { receiver_id: i.receiver, amount: i.amount, memo: i.number },
      deposit: 1n, gas: 30_000_000_000_000n,
    });
    const out = await skypay.confirmInvoicePayment(i.id, { txHash: tx.transaction.hash, senderAccountId: near.relayerId });
    res.json({ status: out.invoice.status, txHash: tx.transaction.hash, txUrl: near.explorerTx(tx.transaction.hash), payer: near.relayerId, simulatedPayer: true });
  }));

  // ----------------------------------------------------------------- exports
  r.get('/api/export/invoices.csv', authenticateToken, wrap(async (req, res) => {
    const list = await prisma.invoice.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'asc' } });
    res.type('text/csv').attachment('skypay-invoices.csv').send(invoicesCsv(list, (h) => near.explorerTx(h)));
  }));

  r.get('/api/export/payments.csv', authenticateToken, wrap(async (req, res) => {
    const list = await prisma.paymentAttempt.findMany({ where: { userId: req.user.id }, include: { invoice: true, batch: true }, orderBy: { createdAt: 'asc' } });
    res.type('text/csv').attachment('skypay-payments.csv').send(paymentsCsv(list, (h) => near.explorerTx(h)));
  }));

  return r;
}

export default createNearRouter;
