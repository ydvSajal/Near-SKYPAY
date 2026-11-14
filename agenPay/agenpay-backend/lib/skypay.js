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
        const inv = await this.prisma.$transaction(async (tx) => {
          const created = await tx.invoice.create({
            data: {
              userId, number, customerEmail: email, customerName: input.customerName?.slice(0, 120) || null,
              description: input.description?.slice(0, 500) || null, lineItems: items, amount,
              asset: 'USDC', assetContract: this.near.token, decimals: 6, network: `near:${this.near.network}`,
              receiver: u.nearAccountId, dueDate: due,
              // ponytail: source ref (e.g. a Notion row) rides in the seller snapshot to avoid a schema migration; stripped from public views
              seller: input.sourceRef ? { ...sellerOf(u), sourceRef: String(input.sourceRef).slice(0, 120) } : sellerOf(u),
            },
          });
          await financialJobs(tx, userId, created.id, 'pending');
          return created;
        });
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

    if (inv.assetContract !== this.near.token || inv.network !== `near:${this.near.network}`) {
      throw httpErr(409, 'invoice settlement configuration differs from the active network/token');
    }
    let v;
    try {
      v = await this.near.verifyTokenReceipt({ txHash, senderHint: senderAccountId, receiver: inv.receiver, minAmount: inv.amount, memos: invoiceMemos(inv) });
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
      await financialJobs(tx, inv.userId, inv.id, 'paid');
      return tx.invoice.findUnique({ where: { id: inv.id } });
    });
    if (!result) return { invoice: await this.prisma.invoice.findUnique({ where: { id: inv.id } }), alreadyPaid: true };
    return { invoice: result, overpaid: BigInt(v.received) > BigInt(inv.amount) };
  }

  // --------------------------------------------------------------- payees
  /** Only the authenticated owner registers payout destinations. Prompts and emails cannot (A02, A18). */
  async addPayee(userId, { name, email, nearAccount, notes, kind, role, salary }) {
    const acct = String(nearAccount || '').trim().toLowerCase();
    if (!NEAR_ACCOUNT.test(acct)) throw httpErr(400, 'invalid NEAR account id');
    email = String(email || '').trim().toLowerCase() || null; // billing email: supplier bills are matched on it
    if (email && !EMAIL.test(email)) throw httpErr(400, 'invalid email');
    if (!(await this.near.accountExists(acct))) throw httpErr(400, `${acct} does not exist on NEAR ${this.near.network}`);
    await this.near.registerOnToken(acct); // sponsor-paid NEP-145 registration so it can receive USDC
    const payee = await this.prisma.payee.upsert({
      where: { userId_nearAccount: { userId, nearAccount: acct } },
      create: { userId, name: String(name || acct).slice(0, 120), email, nearAccount: acct, notes: notes ? String(notes).slice(0, 500) : null, ...staffFields({ kind, role, salary }) },
      update: { name: String(name || acct).slice(0, 120), email, ...(notes ? { notes: String(notes).slice(0, 500) } : {}), ...staffFields({ kind, role, salary }) },
    });
    await this.outbox.enqueue(userId, 'notion_payee', `notion_payee:${payee.id}:${Date.now()}`, { payeeId: payee.id }).catch(() => {});
    return payee;
  }

  /** Rename / change contact or notes. The NEAR account is fixed: a new address is a new payee. */
  async updatePayee(userId, id, { name, email, notes, kind, role, salary }) {
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
    Object.assign(data, staffFields({ kind, role, salary }));
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
  async payBatch(userId, { label, items, source, kind }) {
    if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BATCH) throw httpErr(400, `a batch needs 1 to ${MAX_BATCH} payments`);
    const runKind = kind === 'payroll' ? 'payroll' : 'payout';
    const runLabel = String(label || '').trim().slice(0, 80) || (runKind === 'payroll' ? payrollLabel() : `Batch ${new Date().toISOString().slice(0, 10)}`);
    if (runKind === 'payroll') {
      // A payroll name is a durable one-shot identifier, including failed/uncertain runs.
      const prev = await this.prisma.payoutBatch.findFirst({ where: { userId, kind: 'payroll', label: runLabel } });
      if (prev) throw httpErr(409, `payroll "${runLabel}" was already run (${prev.status}). Use a different name to pay again on purpose.`);
    }
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

    // The primary-key constraint also serializes racing requests across processes.
    // No schema migration is needed; the earlier lookup protects legacy random-ID runs.
    const payrollId = runKind === 'payroll'
      ? `payroll_${crypto.createHash('sha256').update(JSON.stringify([userId, runLabel])).digest('hex')}` : null;
    let batch;
    try {
      batch = await this.prisma.payoutBatch.create({
        data: { ...(payrollId ? { id: payrollId } : {}), userId, label: runLabel, kind: runKind,
          total: total.toString(), status: 'queued', source: source ? String(source).slice(0, 120) : null },
      });
    } catch (e) {
      if (payrollId && e.code === 'P2002') throw httpErr(409, 'payroll name already used; reconcile the existing run before any new payment');
      throw e;
    }
    const results = [];
    const finish = () => {
      if (results.some(a => !['settled', 'failed'].includes(a.status))) return 'processing';
      const n = results.filter(a => a.status === 'settled').length;
      return n === parsed.length ? 'done' : n === 0 ? 'failed' : 'partial';
    };
    try {
      for (const [i, it] of parsed.entries()) {
        results.push(await this.paySupplier(userId, { payeeId: it.payeeId, amount: it.amount, memo: it.memo, idempotencyKey: `batch:${batch.id}:${i}`, batchId: batch.id }));
      }
    } catch (e) {
      // Unexpected error (e.g. DB down) mid-batch: never leave the batch "queued", and never call it failed
      // while any line's outcome is uncertain (the line that threw may already have been dispatched).
      // Persisted lines are the truth; if they cannot be read, stay "processing" for the reconciliation worker.
      const lines = await this.prisma.paymentAttempt.findMany({ where: { batchId: batch.id } }).catch(() => null);
      const uncertain = !lines || [...results, ...lines].some((a) => !['settled', 'failed'].includes(a.status));
      const settled = (lines || []).filter((a) => a.status === 'settled').length;
      const status = uncertain ? 'processing' : settled === 0 ? 'failed' : 'partial';
      await this.prisma.payoutBatch.update({ where: { id: batch.id }, data: { status } }).catch(() => {});
      throw e;
    }
    const status = finish();
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
    const paymentId = paymentIdFor(userId, idempotencyKey || crypto.randomUUID());

    const same = (existing) => {
      if (existing.recipient !== payee.nearAccount || existing.amount !== base ||
          JSON.parse(existing.requestHash || '{}').memo !== String(memo || '')) throw httpErr(409, 'idempotency key reused with a different payment');
      return existing;
    };
    const existing = await this.prisma.paymentAttempt.findUnique({ where: { paymentId } });
    if (existing) return same(existing);
    if (!batchId) {
      // A retry under a NEW key (page reload, agent re-asked later) must not send a second copy of a payment whose
      // outcome is still unknown. Settled/failed ones do not block: paying the same supplier again is then deliberate.
      // ponytail: read-then-create, not a lock; two simultaneous new keys can still both pass (the vault limits bound it).
      const pending = await this.prisma.paymentAttempt.findFirst({
        where: { userId, direction: 'OUT', batchId: null, recipient: payee.nearAccount, amount: base, status: { in: ['submitted', 'unknown', 'processing'] } },
      });
      if (pending && (pending.memo || '') === String(memo || '').slice(0, 120)) {
        throw httpErr(409, `an identical payment to ${payee.name} is still unresolved (${pending.status}); reconcile it before paying again`);
      }
    }
    const expiresAtMs = Date.now() + 15 * 60_000;
    let attempt;
    try {
      attempt = await this.prisma.paymentAttempt.create({
        data: {
          userId, direction: 'OUT', paymentId, recipient: payee.nearAccount, amount: base, network: `near:${this.near.network}`,
          status: 'submitted', requestHash: JSON.stringify({ memo: String(memo || ''), expiresAtMs }),
          memo: memo ? String(memo).slice(0, 120) : null, batchId: batchId || null,
        },
      });
    } catch (e) {
      // A concurrent request with the same key created the row first: it owns the dispatch, we never send.
      if (e.code === 'P2002') return same(await this.prisma.paymentAttempt.findUnique({ where: { paymentId } }));
      throw e;
    }
    try {
      const r = await this.near.agentPay({
        user: u, paymentId, recipient: payee.nearAccount, amount: base, invoiceRef: paymentId, expiresAtMs,
      });
      const { status, error } = parseOutcome(r.status);
      attempt = await this.prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status, error, txHash: r.txHash } });
      // Cost reporting must not downgrade a verified payment or erase its tx hash.
      await this.prisma.sponsorLedger.create({ data: { userId, kind: 'agent_pay', detail: paymentId, txHash: r.txHash } })
        .catch((e) => console.error('sponsor ledger:', paymentId, e.message));
    } catch (e) {
      // Contract refusals arrive as thrown execution errors; transport errors leave the outcome unknown.
      // Only a direct panic is classified as a refusal. Generic execution/callback
      // failures can occur AFTER token delivery and must remain unresolved.
      const refused = /Contract panicked|Smart contract panicked/i.test(String(e.message)) &&
        !/on_paid|callback/i.test(String(e.message));
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
    if (['settled', 'failed', 'refunded'].includes(a.status)) return a;
    const onChain = await this.near.vaultPayment(u.vaultAccountId, a.paymentId);
    // Absence at one block is not proof of failure: a submitted transaction may still execute.
    if (onChain && (onChain.recipient !== a.recipient || String(onChain.amount) !== a.amount || onChain.agent !== u.agentAccountId)) {
      throw httpErr(422, 'vault payment does not match the persisted attempt');
    }
    const status = !onChain ? a.status : ({ Reserved: 'processing', Settled: 'settled', Failed: 'failed' }[onChain.status] || a.status);
    const out = await this.prisma.paymentAttempt.update({ where: { id: a.id }, data: { status } });
    await this.outbox.enqueue(userId, 'notion_payout', `notion_payout:${a.id}:${status}`, { attemptId: a.id }).catch(() => {});
    if (a.batchId) await this.refreshBatch(userId, a.batchId);
    await this.syncBill(a.id);
    return out;
  }

  /**
   * Recompute a run's aggregate status from its persisted lines (after reconcile or a crash).
   * Lines are counted against the batch total: if the persisted lines do not add up to it, some items
   * were never dispatched, so the run can be at most "partial" and is never reported as done.
   */
  async refreshBatch(userId, batchId) {
    const b = await this.prisma.payoutBatch.findFirst({ where: { id: batchId, userId }, include: { payments: true } });
    if (!b) return null;
    const lines = b.payments || [];
    const sum = lines.reduce((s, p) => s + BigInt(p.amount), 0n);
    const missing = sum < BigInt(b.total);
    let status;
    if (lines.some((p) => !['settled', 'failed'].includes(p.status))) status = 'processing';
    else {
      const n = lines.filter((p) => p.status === 'settled').length;
      status = n === 0 ? 'failed' : (n === lines.length && !missing ? 'done' : 'partial');
    }
    if (status === b.status) return b;
    const out = await this.prisma.payoutBatch.update({ where: { id: b.id }, data: { status } });
    await this.outbox.enqueue(userId, 'notion_batch', `notion_batch:${b.id}:${status}`, { batchId: b.id }).catch(() => {});
    return out;
  }

  /** Keep a supplier bill's status in step with its vault payment (no-op for payments that are not bills). */
  async syncBill(attemptId) {
    if (!this.prisma.supplierBill) return;
    const bill = await this.prisma.supplierBill.findFirst({ where: { paymentAttemptId: attemptId } });
    if (!bill) return;
    const a = await this.prisma.paymentAttempt.findUnique({ where: { id: attemptId } });
    const status = billStatusOf(a);
    if (status !== bill.status) await this.prisma.supplierBill.update({ where: { id: bill.id }, data: { status } });
  }
}

/** These jobs commit with the financial record, closing the crash window before enqueue. */
async function financialJobs(tx, userId, invoiceId, status) {
  const kinds = status === 'paid' ? ['receipt_email', 'notion_invoice'] : ['invoice_email', 'notion_invoice'];
  for (const kind of kinds) {
    const idempotencyKey = kind === 'notion_invoice' ? `${kind}:${invoiceId}:${status}` : `${kind}:${invoiceId}`;
    await tx.outboxJob.upsert({ where: { idempotencyKey }, update: {},
      create: { userId, kind, idempotencyKey, payload: { invoiceId } } });
  }
}

/** Memos that bind a token transfer to this invoice: its number (wallet, demo payer) or id (x402). */
export const invoiceMemos = (inv) => [inv.number, inv.id];

/** Validated employee fields; only the keys that were provided. */
function staffFields({ kind, role, salary }) {
  const out = {};
  if (kind !== undefined) {
    if (!['employee', 'supplier'].includes(kind)) throw httpErr(400, 'kind must be employee or supplier');
    out.kind = kind;
  }
  if (role !== undefined) out.role = String(role || '').trim().slice(0, 80) || null;
  if (salary !== undefined) {
    if (salary === null || salary === '') out.salary = null;
    else {
      let base;
      try { base = parseUnits(String(salary)); } catch { throw httpErr(400, `invalid pay amount "${salary}"`); }
      if (BigInt(base) <= 0n) throw httpErr(400, 'pay amount must be greater than zero');
      out.salary = base;
    }
  }
  return out;
}

/** Default payroll run name, e.g. "Payroll 2026-11". */
export const payrollLabel = (d = new Date()) => `Payroll ${d.toISOString().slice(0, 7)}`;

/** Seller block printed on an invoice, frozen at issue time. */
export function sellerOf(u) {
  return {
    name: u.companyName || u.name || u.email.split('@')[0], address: u.companyAddress || null, country: u.country || null,
    taxId: u.taxId || null, email: u.email, notes: u.invoiceNotes || null,
  };
}

/** Map a NEAR final execution status to our attempt status. */
export function parseOutcome(status) {
  if (status?.Failure) return { status: 'unknown', error: JSON.stringify(status.Failure).slice(0, 300) };
  if (status?.SuccessValue !== undefined) {
    let v = '';
    try { v = JSON.parse(Buffer.from(status.SuccessValue, 'base64').toString()); } catch { /* empty */ }
    return { status: v === 'Settled' ? 'settled' : v === 'Failed' ? 'failed' : 'processing', error: v === 'Failed' ? 'token transfer failed; reservation released' : null };
  }
  return { status: 'unknown', error: null };
}

/** Vault payment id for an idempotency key (32 hex chars, so the on-chain reference stays short). */
export const paymentIdFor = (userId, key) => `out_${crypto.createHash('sha256').update(`${userId}|${key}`).digest('hex').slice(0, 32)}`;

/** Supplier bill status derived from its vault payment. An unknown outcome is never shown as paid or failed. */
export function billStatusOf(a) {
  if (!a) return 'paying';
  return { settled: 'paid', failed: 'failed', unknown: 'unknown' }[a.status] || 'paying';
}

export function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

export default SkyPay;
