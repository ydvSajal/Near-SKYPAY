// SkyPay business rules shared by HTTP routes and agent tools.
// Every function takes an authenticated userId; nothing here trusts model output as authorization.
import crypto from 'node:crypto';
import { parseUnits, sumLineItems, isBaseUnits } from './near/units.js';

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
export const MAX_BATCH = 25;
const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export class SkyPay {
  constructor({ prisma, near, outbox }) {
    this.prisma = prisma;
    this.near = near;
    this.outbox = outbox;
  }

  async user(userId) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw httpErr(401, 'unknown user');
    return u;
  }

  // ------------------------------------------------------------- invoices
  /**
   * @param input { customerEmail, customerName?, description?, dueDate (ISO), lineItems:[{description, quantity, unitPrice:"12.50"}] }
   */
  async createInvoice(userId, input) {
    const u = await this.user(userId);
    if (!u.nearAccountId) throw httpErr(409, 'Set up the company NEAR account first (Vault tab).');
    const email = String(input.customerEmail || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw httpErr(400, 'valid customerEmail required');
    const items = (input.lineItems || []).map((li) => ({
      description: String(li.description || '').slice(0, 200) || 'Service',
      quantity: Number(li.quantity ?? 1),
      unitAmount: li.unitAmount && isBaseUnits(String(li.unitAmount)) ? String(li.unitAmount) : parseUnits(String(li.unitPrice)),
    }));
    if (!items.length || items.length > 50) throw httpErr(400, '1-50 line items required');
    const amount = sumLineItems(items);
    if (BigInt(amount) <= 0n) throw httpErr(400, 'total must be positive');
    const due = input.dueDate ? new Date(input.dueDate) : new Date(Date.now() + 14 * 86_400_000);
    if (Number.isNaN(due.getTime())) throw httpErr(400, 'invalid dueDate');

    // number allocation is retried on the (userId, number) unique constraint
    for (let attempt = 0; attempt < 5; attempt++) {
      const count = await this.prisma.invoice.count({ where: { userId } });
      const number = `INV-${String(count + 1 + attempt).padStart(4, '0')}`;
      try {
        const inv = await this.prisma.invoice.create({
          data: {
            userId, number, customerEmail: email, customerName: input.customerName?.slice(0, 120) || null,
            description: input.description?.slice(0, 500) || null, lineItems: items, amount,
            asset: 'USDC', assetContract: this.near.token, decimals: 6, network: `near:${this.near.network}`,
            receiver: u.nearAccountId, dueDate: due, seller: sellerOf(u),
          },
        });
        await this.outbox.enqueue(userId, 'invoice_email', `invoice_email:${inv.id}`, { invoiceId: inv.id });
        await this.outbox.enqueue(userId, 'notion_invoice', `notion_invoice:${inv.id}:pending`, { invoiceId: inv.id });
        return inv;
      } catch (e) {
        if (e.code !== 'P2002') throw e;
      }
    }
    throw httpErr(500, 'could not allocate invoice number');
  }

  /**
   * Verify a NEAR transaction against the invoice and close it exactly once (A05, A06).
   * The caller's claim is never trusted: amount, token, receiver and success come from chain data.
   */
  async confirmInvoicePayment(invoiceId, { txHash, senderAccountId }) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(String(txHash || ''))) throw httpErr(400, 'invalid transaction hash');
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw httpErr(404, 'invoice not found');
    if (inv.status === 'paid') {
      return { invoice: inv, alreadyPaid: true, sameTx: inv.settledTxHash === txHash };
    }
    if (inv.status !== 'pending') throw httpErr(409, `invoice is ${inv.status}`);
    const used = await this.prisma.invoice.findUnique({ where: { settledTxHash: txHash } });
    if (used) throw httpErr(409, 'this transaction already settled another invoice');

    let v;
    try {
      v = await this.near.verifyTokenReceipt({ txHash, senderHint: senderAccountId, receiver: inv.receiver, minAmount: inv.amount });
    } catch (e) {
      throw httpErr(422, `could not verify transaction on NEAR: ${e.message}`);
    }
    if (!v.ok) throw httpErr(422, `payment not accepted: ${v.reason}${v.received ? ` (received ${v.received})` : ''}`);

    const result = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.invoice.updateMany({
        where: { id: inv.id, status: 'pending' },
        data: { status: 'paid', settledAmount: v.received, settledTxHash: txHash, settledAt: new Date() },
      });
      if (!upd.count) return null; // someone else settled it concurrently
      await tx.paymentAttempt.create({
        data: {
          userId: inv.userId, direction: 'IN', invoiceId: inv.id, paymentId: `in:${txHash}`, recipient: inv.receiver,
          amount: v.received, network: inv.network, status: 'settled', txHash,
        },
      });
      return tx.invoice.findUnique({ where: { id: inv.id } });
    });
    if (!result) return { invoice: await this.prisma.invoice.findUnique({ where: { id: inv.id } }), alreadyPaid: true };
    await this.outbox.enqueue(inv.userId, 'receipt_email', `receipt_email:${inv.id}`, { invoiceId: inv.id });
    await this.outbox.enqueue(inv.userId, 'notion_invoice', `notion_invoice:${inv.id}:paid`, { invoiceId: inv.id });
    return { invoice: result, overpaid: BigInt(v.received) > BigInt(inv.amount) };
  }

  // --------------------------------------------------------------- payees
  /** Only the authenticated owner registers payout destinations. Prompts and emails cannot (A02, A18). */
  async addPayee(userId, { name, email, nearAccount, notes }) {
    const acct = String(nearAccount || '').trim().toLowerCase();
    if (!NEAR_ACCOUNT.test(acct)) throw httpErr(400, 'invalid NEAR account id');
    if (!(await this.near.accountExists(acct))) throw httpErr(400, `${acct} does not exist on NEAR ${this.near.network}`);
    await this.near.registerOnToken(acct); // sponsor-paid NEP-145 registration so it can receive USDC
    const payee = await this.prisma.payee.upsert({
      where: { userId_nearAccount: { userId, nearAccount: acct } },
      create: { userId, name: String(name || acct).slice(0, 120), email: email || null, nearAccount: acct, notes: notes ? String(notes).slice(0, 500) : null },
      update: { name: String(name || acct).slice(0, 120), email: email || null, ...(notes ? { notes: String(notes).slice(0, 500) } : {}) },
    });
    await this.outbox.enqueue(userId, 'notion_payee', `notion_payee:${payee.id}:${Date.now()}`, { payeeId: payee.id }).catch(() => {});
    return payee;
  }

  /** Rename / change contact or notes. The NEAR account is fixed: a new address is a new payee. */
  async updatePayee(userId, id, { name, email, notes }) {
    const p = await this.prisma.payee.findFirst({ where: { id, userId } });
    if (!p) throw httpErr(404, 'payee not found');
    const data = {};
    if (name !== undefined) {
      if (!String(name).trim()) throw httpErr(400, 'name cannot be empty');
      data.name = String(name).trim().slice(0, 120);
    }
    if (email !== undefined) {
      const e = String(email || '').trim().toLowerCase();
      if (e && !EMAIL.test(e)) throw httpErr(400, 'invalid email');
      data.email = e || null;
    }
    if (notes !== undefined) data.notes = String(notes || '').trim().slice(0, 500) || null;
    const out = await this.prisma.payee.update({ where: { id }, data });
    await this.outbox.enqueue(userId, 'notion_payee', `notion_payee:${id}:${Date.now()}`, { payeeId: id }).catch(() => {});
    return out;
  }

  /** Removes the payee from SkyPay only; the on-chain allow-list entry is owner-signed and stays until revoked in the vault. */
  async removePayee(userId, id) {
    const p = await this.prisma.payee.findFirst({ where: { id, userId } });
    if (!p) throw httpErr(404, 'payee not found');
    await this.prisma.payee.delete({ where: { id } });
    // the row is gone, so the job carries the account it must remove from Notion
    await this.outbox.enqueue(userId, 'notion_payee_remove', `notion_payee_remove:${id}`, { nearAccount: p.nearAccount }).catch(() => {});
    return p;
  }

  /**
   * Pay several approved payees in one go. Items run one after another (same agent key, so no nonce clashes);
   * a refused item does not stop the rest. Every item is its own idempotent vault payment.
   * ponytail: synchronous, capped at 25 items (~2-4 s each); move to an outbox job if payroll grows past that.
   */
  async payBatch(userId, { label, items, source }) {
    if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BATCH) throw httpErr(400, `a batch needs 1 to ${MAX_BATCH} payments`);
    const u = await this.user(userId);
    if (!u.vaultAccountId || !u.agentKeyEnc) throw httpErr(409, 'vault not provisioned');
    const ids = [...new Set(items.map((i) => i.payeeId))];
    const payees = await this.prisma.payee.findMany({ where: { userId, id: { in: ids } } });
    if (payees.length !== ids.length) throw httpErr(404, 'payee not registered by the owner');
    const parsed = items.map((i) => {
      let base;
      try { base = parseUnits(String(i.amount)); } catch { throw httpErr(400, `invalid amount "${i.amount}"`); }
      if (BigInt(base) <= 0n) throw httpErr(400, 'amounts must be greater than zero');
      return { payeeId: i.payeeId, amount: String(i.amount), memo: i.memo, base };
    });
    const total = parsed.reduce((a, i) => a + BigInt(i.base), 0n);
    const vault = await this.near.vaultState(u.vaultAccountId);
    if (total > BigInt(vault.available)) throw httpErr(422, 'batch total is more than the vault has available');

    const batch = await this.prisma.payoutBatch.create({
      data: { userId, label: String(label || '').trim().slice(0, 80) || `Batch ${new Date().toISOString().slice(0, 10)}`, total: total.toString(), status: 'queued', source: source ? String(source).slice(0, 120) : null },
    });
    const results = [];
    const finish = (n) => (n === parsed.length ? 'done' : n === 0 ? 'failed' : 'partial');
    try {
      for (const [i, it] of parsed.entries()) {
        results.push(await this.paySupplier(userId, { payeeId: it.payeeId, amount: it.amount, memo: it.memo, idempotencyKey: `batch:${batch.id}:${i}`, batchId: batch.id }));
      }
    } catch (e) {
      // unexpected error (e.g. DB down) mid-batch: never leave the batch "queued"; unpaid items count as not settled
      const settled = results.filter((a) => a.status === 'settled').length;
      await this.prisma.payoutBatch.update({ where: { id: batch.id }, data: { status: settled === 0 ? 'failed' : 'partial' } }).catch(() => {});
      throw e;
    }
    const status = finish(results.filter((a) => a.status === 'settled').length);
    const done = await this.prisma.payoutBatch.update({ where: { id: batch.id }, data: { status } });
    await this.outbox.enqueue(userId, 'notion_batch', `notion_batch:${batch.id}:${status}`, { batchId: batch.id }).catch(() => {});
    return { batch: done, payments: results };
  }

  async findPayee(userId, nameOrAccount) {
    const q = String(nameOrAccount || '').trim();
    const list = await this.prisma.payee.findMany({ where: { userId } });
    return list.find((p) => p.nearAccount === q.toLowerCase()) || list.find((p) => p.name.toLowerCase() === q.toLowerCase()) || null;
  }

  // ------------------------------------------------------- vault payments
  /**
   * Agent-executed supplier payment. Attempt row is persisted BEFORE dispatch; the vault contract is the authority.
   * Same idempotencyKey -> same attempt, never a second transfer (A11, A15).
   */
  async paySupplier(userId, { payeeId, amount, memo, idempotencyKey, batchId }) {
    const u = await this.user(userId);
    if (!u.vaultAccountId || !u.agentKeyEnc) throw httpErr(409, 'vault not provisioned');
    const payee = await this.prisma.payee.findFirst({ where: { id: payeeId, userId } });
    if (!payee) throw httpErr(404, 'payee not registered by the owner');
    const base = parseUnits(String(amount));
    const paymentId = `out_${crypto.createHash('sha256').update(`${userId}|${idempotencyKey || crypto.randomUUID()}`).digest('hex').slice(0, 32)}`;

    const existing = await this.prisma.paymentAttempt.findUnique({ where: { paymentId } });
    if (existing) {
      if (existing.recipient !== payee.nearAccount || existing.amount !== base) throw httpErr(409, 'idempotency key reused with a different payment');
      return existing;
    }
    const expiresAtMs = Date.now() + 15 * 60_000;
    let attempt = await this.prisma.paymentAttempt.create({
      data: {
        userId, direction: 'OUT', paymentId, recipient: payee.nearAccount, amount: base, network: `near:${this.near.network}`,
        status: 'submitted', requestHash: JSON.stringify({ memo: memo || '', expiresAtMs }),
        memo: memo ? String(memo).slice(0, 120) : null, batchId: batchId || null,
      },
    });
    try {
      const r = await this.near.agentPay({
        user: u, paymentId, recipient: payee.nearAccount, amount: base, invoiceRef: String(memo || '').slice(0, 64), expiresAtMs,
      });
      const { status, error } = parseOutcome(r.status);
      attempt = await this.prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status, error, txHash: r.txHash } });
      await this.prisma.sponsorLedger.create({ data: { userId, kind: 'agent_pay', detail: paymentId, txHash: r.txHash } });
    } catch (e) {
      // Contract refusals arrive as thrown execution errors; transport errors leave the outcome unknown.
      const refused = /Contract panicked|Smart contract panicked|FunctionCallError|ExecutionError/i.test(String(e.message));
      attempt = await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: refused ? 'failed' : 'unknown', error: String(e.message).slice(0, 300), txHash: e.txHash || null },
      });
    }
    await this.outbox.enqueue(userId, 'notion_payout', `notion_payout:${attempt.id}:${attempt.status}`, { attemptId: attempt.id }).catch(() => {});
    return attempt;
  }

  /** Re-read the vault for an unresolved attempt. Never resends (A15). */
  async reconcile(userId, attemptId) {
    const u = await this.user(userId);
    const a = await this.prisma.paymentAttempt.findFirst({ where: { id: attemptId, userId, direction: 'OUT' } });
    if (!a) throw httpErr(404, 'payment not found');
    const onChain = await this.near.vaultPayment(u.vaultAccountId, a.paymentId);
    const status = !onChain ? (a.status === 'unknown' ? 'failed' : a.status) : { Reserved: 'processing', Settled: 'settled', Failed: 'failed' }[onChain.status];
    const out = await this.prisma.paymentAttempt.update({ where: { id: a.id }, data: { status } });
    await this.outbox.enqueue(userId, 'notion_payout', `notion_payout:${a.id}:${status}`, { attemptId: a.id }).catch(() => {});
    return out;
  }
}

/** Seller block printed on an invoice, frozen at issue time. */
export function sellerOf(u) {
  return {
    name: u.companyName || u.name || u.email.split('@')[0], address: u.companyAddress || null, country: u.country || null,
    taxId: u.taxId || null, email: u.email, notes: u.invoiceNotes || null,
  };
}

/** Map a NEAR final execution status to our attempt status. */
export function parseOutcome(status) {
  if (status?.Failure) return { status: 'failed', error: JSON.stringify(status.Failure).slice(0, 300) };
  if (status?.SuccessValue !== undefined) {
    let v = '';
    try { v = JSON.parse(Buffer.from(status.SuccessValue, 'base64').toString()); } catch { /* empty */ }
    return { status: v === 'Settled' ? 'settled' : v === 'Failed' ? 'failed' : 'processing', error: v === 'Failed' ? 'token transfer failed; reservation released' : null };
  }
  return { status: 'unknown', error: null };
}

export function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

export default SkyPay;
