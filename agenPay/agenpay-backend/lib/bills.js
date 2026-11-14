// Supplier bill inbox: contractors submit bills through a company-specific link; the owner reviews and pays
// through the existing NEAR vault. Trust rules:
//  - a submission can never choose where money goes: the payout account comes from the owner's Payee registry;
//  - the contractor's typed payout account is only compared with the registry and flagged when it differs;
//  - one bill -> at most one vault payment id per dispatch; a retry is allowed only after a definite on-chain refusal;
//  - an unknown outcome is reconciled from the vault (ReconciliationWorker), never resent.
// Owner review is an application-level control. The vault itself enforces allow-list, limits, expiry and replay,
// not per-bill approval (see SECURITY.md).
import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { parseUnits, formatUnits } from './near/units.js';
import { httpErr, billStatusOf, paymentIdFor } from './skypay.js';

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const OPEN = ['needs_review', 'flagged'];
const DUP_WINDOW_MS = 30 * 86_400_000;
const token = () => crypto.randomBytes(18).toString('base64url');

export class Bills {
  constructor({ prisma, skypay }) {
    this.prisma = prisma;
    this.skypay = skypay;
  }

  /** Owner's inbox link token, created on first use. */
  async inboxToken(userId, { rotate = false } = {}) {
    const u = await this.skypay.user(userId);
    if (u.billInboxToken && !rotate) return u.billInboxToken;
    const t = token();
    await this.prisma.user.update({ where: { id: userId }, data: { billInboxToken: t } });
    return t;
  }

  async companyByToken(t) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(t || ''))) throw httpErr(404, 'inbox not found');
    const u = await this.prisma.user.findUnique({ where: { billInboxToken: t } });
    if (!u) throw httpErr(404, 'inbox not found');
    return u;
  }

  /** Match a submitter to the owner's registry: by email first, then by the account they typed. */
  async match(userId, email, claimed) {
    const payees = await this.prisma.payee.findMany({ where: { userId } });
    return payees.find((p) => p.email && p.email.toLowerCase() === email) ||
      (claimed ? payees.find((p) => p.nearAccount === claimed) : null) || null;
  }

  async flagsFor(userId, payee, { claimed, amount, invoiceNumber }) {
    const flags = [];
    if (!payee) flags.push('unknown_supplier');
    if (payee && claimed && claimed !== payee.nearAccount) flags.push('payout_changed');
    if (payee) {
      const since = new Date(Date.now() - DUP_WINDOW_MS);
      const same = await this.prisma.supplierBill.findFirst({
        where: { userId, payeeId: payee.id, createdAt: { gte: since }, status: { not: 'rejected' },
          OR: [{ invoiceNumber }, { amount }] },
      });
      if (same) flags.push('possible_duplicate');
    }
    return flags;
  }

  /** Public submission. Returns only what the contractor needs (status token). */
  async submit(inboxToken, input) {
    const u = await this.companyByToken(inboxToken);
    const name = String(input.name || '').trim().slice(0, 120);
    const email = String(input.email || '').trim().toLowerCase();
    const invoiceNumber = String(input.invoiceNumber || '').trim().slice(0, 40);
    const claimed = String(input.payoutAccount || '').trim().toLowerCase() || null;
    if (!name) throw httpErr(400, 'name required');
    if (!EMAIL.test(email)) throw httpErr(400, 'valid email required');
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._/#-]{0,39}$/.test(invoiceNumber)) throw httpErr(400, 'invoice number required (letters, digits, - _ . / #)');
    if (claimed && !NEAR_ACCOUNT.test(claimed)) throw httpErr(400, 'payout account is not a valid NEAR account id');
    let amount;
    try { amount = parseUnits(String(input.amount)); } catch { throw httpErr(400, 'invalid amount'); }
    if (BigInt(amount) <= 0n) throw httpErr(400, 'amount must be greater than zero');
    let dueDate = null;
    if (input.dueDate) {
      dueDate = new Date(input.dueDate);
      if (Number.isNaN(dueDate.getTime())) throw httpErr(400, 'invalid due date');
    }
    const payee = await this.match(u.id, email, claimed);
    const flags = await this.flagsFor(u.id, payee, { claimed, amount, invoiceNumber });
    try {
      const bill = await this.prisma.supplierBill.create({
        data: {
          userId: u.id, payeeId: payee?.id || null, submitterName: name, submitterEmail: email, claimedAccount: claimed,
          invoiceNumber, description: input.description ? String(input.description).slice(0, 500) : null,
          amount, dueDate, flags, status: flags.length ? 'flagged' : 'needs_review', statusToken: token(),
        },
      });
      return bill;
    } catch (e) {
      if (e.code === 'P2002') throw httpErr(409, `bill ${invoiceNumber} was already submitted from ${email}`);
      throw e;
    }
  }

  async list(userId) {
    const bills = await this.prisma.supplierBill.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const payees = await this.prisma.payee.findMany({ where: { userId } });
    const attempts = await this.prisma.paymentAttempt.findMany({
      where: { userId, id: { in: bills.map((b) => b.paymentAttemptId).filter(Boolean) } },
    });
    return bills.map((b) => ({ ...b, payee: payees.find((p) => p.id === b.payeeId) || null,
      payment: attempts.find((a) => a.id === b.paymentAttemptId) || null }));
  }

  /**
   * Owner pays a bill through the vault. The recipient is the registered payee's account.
   * Flagged bills need an explicit acknowledgement. A status claim (updateMany) makes concurrent clicks pay once.
   */
  async pay(userId, id, { acknowledgeFlags = false } = {}) {
    const bill = await this.prisma.supplierBill.findFirst({ where: { id, userId } });
    if (!bill) throw httpErr(404, 'bill not found');
    if (['paying', 'paid', 'unknown'].includes(bill.status)) {
      const payment = bill.paymentAttemptId ? await this.prisma.paymentAttempt.findUnique({ where: { id: bill.paymentAttemptId } }) : null;
      return { bill, payment, alreadyDispatched: true };
    }
    if (![...OPEN, 'failed'].includes(bill.status)) throw httpErr(409, `bill is ${bill.status}`);
    // re-match: the owner may have registered the supplier after the bill arrived
    const payee = bill.payeeId
      ? await this.prisma.payee.findFirst({ where: { id: bill.payeeId, userId } })
      : await this.match(userId, bill.submitterEmail, bill.claimedAccount);
    if (!payee) throw httpErr(409, 'supplier is not registered: add them under Suppliers with this billing email and their verified NEAR account first');
    const flags = Array.isArray(bill.flags) ? bill.flags.filter((f) => f !== 'unknown_supplier') : [];
    if (bill.claimedAccount && bill.claimedAccount !== payee.nearAccount && !flags.includes('payout_changed')) flags.push('payout_changed');
    if (flags.length && !acknowledgeFlags) throw httpErr(409, `review flags first: ${flags.join(', ')}`);

    const claim = await this.prisma.supplierBill.updateMany({
      where: { id: bill.id, status: bill.status, tries: bill.tries },
      data: { status: 'paying', payeeId: payee.id, tries: bill.tries + 1 },
    });
    if (!claim.count) throw httpErr(409, 'bill is already being paid');
    let attempt;
    try {
      attempt = await this.skypay.paySupplier(userId, {
        payeeId: payee.id, amount: formatUnits(bill.amount), memo: `Bill ${bill.invoiceNumber} (${bill.submitterName})`.slice(0, 120),
        idempotencyKey: `bill:${bill.id}:${bill.tries}`,
      });
    } catch (e) {
      // nothing was dispatched (validation/provisioning error before the attempt row): release the claim
      await this.prisma.supplierBill.update({ where: { id: bill.id }, data: { status: bill.status, tries: bill.tries } });
      throw e;
    }
    const out = await this.prisma.supplierBill.update({
      where: { id: bill.id }, data: { paymentAttemptId: attempt.id, status: billStatusOf(attempt) },
    });
    return { bill: out, payment: attempt };
  }

  /**
   * Crash repair for a bill claimed as "paying" whose payment link was never written.
   * The vault payment id is deterministic, and paySupplier persists its attempt BEFORE dispatch, so:
   * attempt row exists -> link it (reconcile handles its outcome); no row -> nothing was sent, reopen the bill.
   */
  async repairStuck(olderThanMs = 2 * 60_000) {
    const stuck = await this.prisma.supplierBill.findMany({
      where: { status: 'paying', paymentAttemptId: null, updatedAt: { lt: new Date(Date.now() - olderThanMs) } }, take: 50,
    });
    for (const b of stuck) {
      const a = await this.prisma.paymentAttempt.findUnique({ where: { paymentId: paymentIdFor(b.userId, `bill:${b.id}:${b.tries - 1}`) } });
      if (a) await this.prisma.supplierBill.update({ where: { id: b.id }, data: { paymentAttemptId: a.id, status: billStatusOf(a) } });
      else {
        const flags = Array.isArray(b.flags) ? b.flags : [];
        await this.prisma.supplierBill.update({ where: { id: b.id }, data: { status: flags.length ? 'flagged' : 'needs_review' } });
      }
    }
    return stuck.length;
  }

  async reject(userId, id, note) {
    const bill = await this.prisma.supplierBill.findFirst({ where: { id, userId } });
    if (!bill) throw httpErr(404, 'bill not found');
    const upd = await this.prisma.supplierBill.updateMany({
      where: { id, status: { in: [...OPEN, 'failed'] } },
      data: { status: 'rejected', reviewNote: note ? String(note).slice(0, 300) : null },
    });
    if (!upd.count) throw httpErr(409, `bill is ${bill.status}`);
    return this.prisma.supplierBill.findUnique({ where: { id } });
  }

  /** Contractor status page: their own bill only, no flags, no registry data. */
  async publicStatus(statusToken) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(statusToken || ''))) throw httpErr(404, 'bill not found');
    const b = await this.prisma.supplierBill.findUnique({ where: { statusToken } });
    if (!b) throw httpErr(404, 'bill not found');
    b.user = await this.prisma.user.findUnique({ where: { id: b.userId } });
    const a = b.paymentAttemptId ? await this.prisma.paymentAttempt.findUnique({ where: { id: b.paymentAttemptId } }) : null;
    const pub = { needs_review: 'in_review', flagged: 'in_review' }[b.status] || b.status;
    return {
      company: b.user.companyName || b.user.name || 'Company', invoiceNumber: b.invoiceNumber, amount: b.amount,
      description: b.description, dueDate: b.dueDate, submittedAt: b.createdAt, status: pub,
      paidAt: pub === 'paid' ? a?.updatedAt : null, txHash: pub === 'paid' ? a?.txHash : null,
      note: b.status === 'rejected' ? b.reviewNote : null,
    };
  }
}

export function createBillsRouter({ bills, near, authenticateToken }) {
  const r = express.Router();
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
    if (!e.status) console.error('❌', req.method, req.originalUrl, e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'internal error' });
  });
  const submitLimiter = rateLimit({ windowMs: 60 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
  const readLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
  const fmt = (b) => ({ ...b, amountFormatted: formatUnits(b.amount) });
  const tx = (h) => (h ? near.explorerTx(h) : null);

  r.get('/api/bills/inbox-link', authenticateToken, wrap(async (req, res) => {
    res.json({ token: await bills.inboxToken(req.user.id), path: `/bills/submit/${await bills.inboxToken(req.user.id)}` });
  }));
  r.post('/api/bills/inbox-link/rotate', authenticateToken, wrap(async (req, res) => {
    const t = await bills.inboxToken(req.user.id, { rotate: true });
    res.json({ token: t, path: `/bills/submit/${t}` });
  }));
  r.get('/api/bills', authenticateToken, wrap(async (req, res) => {
    const list = await bills.list(req.user.id);
    res.json({ bills: list.map((b) => ({ ...fmt(b), txUrl: tx(b.payment?.txHash) })) });
  }));
  r.post('/api/bills/:id/pay', authenticateToken, wrap(async (req, res) => {
    const out = await bills.pay(req.user.id, req.params.id, { acknowledgeFlags: req.body?.acknowledgeFlags === true });
    const status = out.payment?.status === 'failed' ? 422 : 200;
    res.status(status).json({ bill: fmt(out.bill), payment: out.payment, txUrl: tx(out.payment?.txHash), alreadyDispatched: !!out.alreadyDispatched,
      ...(status === 422 ? { error: `Refused by vault: ${String(out.payment.error).replace(/^.*Contract panicked: /, '')}` } : {}) });
  }));
  r.post('/api/bills/:id/reject', authenticateToken, wrap(async (req, res) => {
    res.json({ bill: fmt(await bills.reject(req.user.id, req.params.id, req.body?.note)) });
  }));

  r.get('/api/public/bill-inbox/:token', readLimiter, wrap(async (req, res) => {
    const u = await bills.companyByToken(req.params.token);
    res.json({ company: u.companyName || u.name || 'Company', network: near.network });
  }));
  r.post('/api/public/bill-inbox/:token', submitLimiter, wrap(async (req, res) => {
    const b = await bills.submit(req.params.token, req.body || {});
    res.status(201).json({ statusToken: b.statusToken, statusPath: `/bills/status/${b.statusToken}` });
  }));
  r.get('/api/public/bills/:statusToken', readLimiter, wrap(async (req, res) => {
    const s = await bills.publicStatus(req.params.statusToken);
    res.json({ ...s, amountFormatted: formatUnits(s.amount), txUrl: tx(s.txHash), network: near.network });
  }));
  return r;
}

export default Bills;
