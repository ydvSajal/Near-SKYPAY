// Durable outbox: side effects (emails, Notion rows) run only from persisted jobs,
// are idempotent by key, retried with backoff, and never change financial truth (A03, A07, A20).
import nodemailer from 'nodemailer';
import { NotionService } from './NotionService.js';
import { formatUnits } from './near/units.js';

const MAX_ATTEMPTS = 6;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Outbox {
  constructor({ prisma, near, env = process.env }) {
    this.prisma = prisma;
    this.near = near;
    this.env = env;
    this.appUrl = (env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].trim();
    const live = env.EMAIL_USER && env.EMAIL_PASS && env.EMAIL_USER !== 'test@example.com';
    this.mailer = live
      ? nodemailer.createTransport({ service: env.EMAIL_SERVICE || 'gmail', auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS.trim() } })
      : null;
    this.from = env.EMAIL_FROM || 'SkyPay <noreply@skypay.local>';
  }

  /** Enqueue once; a repeated call with the same key is a no-op. */
  async enqueue(userId, kind, idempotencyKey, payload) {
    try {
      return await this.prisma.outboxJob.create({ data: { userId, kind, idempotencyKey, payload } });
    } catch (e) {
      if (e.code === 'P2002') return this.prisma.outboxJob.findUnique({ where: { idempotencyKey } });
      throw e;
    }
  }

  start(intervalMs = 10_000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.runOnce().catch((e) => console.error('outbox:', e.message)), intervalMs);
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce() {
    const jobs = await this.prisma.outboxJob.findMany({
      where: { status: 'pending', runAfter: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 20,
    });
    for (const job of jobs) {
      // claim: only one worker may move a job out of pending
      const claimed = await this.prisma.outboxJob.updateMany({
        where: { id: job.id, status: 'pending' }, data: { status: 'running', attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      try {
        const mode = await this.handle(job);
        await this.prisma.outboxJob.update({ where: { id: job.id }, data: { status: 'done', mode, lastError: null } });
      } catch (e) {
        const attempts = job.attempts + 1;
        await this.prisma.outboxJob.update({
          where: { id: job.id },
          data: {
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', lastError: String(e.message).slice(0, 500),
            runAfter: new Date(Date.now() + 2 ** attempts * 5_000),
          },
        });
      }
    }
    return jobs.length;
  }

  async handle(job) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: job.payload.invoiceId }, include: { user: true } });
    if (!invoice) throw new Error('invoice missing');
    if (job.kind === 'invoice_email') return this.sendMail(invoice.customerEmail, ...this.invoiceMail(invoice));
    if (job.kind === 'receipt_email') {
      if (invoice.status !== 'paid') throw new Error('receipt requested for unpaid invoice'); // never before verified settlement
      return this.sendMail(invoice.customerEmail, ...this.receiptMail(invoice));
    }
    if (job.kind === 'notion_invoice') return this.syncNotion(invoice);
    throw new Error(`unknown job kind ${job.kind}`);
  }

  async sendMail(to, subject, html) {
    if (!this.mailer) {
      console.log(`📧 [fixture] would email ${to}: ${subject}`);
      return 'fixture';
    }
    await this.mailer.sendMail({ from: this.from, to, subject, html });
    return 'live'; // accepted by the provider; delivery/read is not proven
  }

  link(invoice) {
    return `${this.appUrl}/invoice/${invoice.id}`;
  }
  money(invoice, v = invoice.amount) {
    return `${formatUnits(v, invoice.decimals)} ${invoice.asset}`;
  }

  invoiceMail(i) {
    const company = esc(i.user.name || i.user.email);
    return [
      `Invoice ${i.number} from ${i.user.name || i.user.email}: ${this.money(i)} due ${i.dueDate.toISOString().slice(0, 10)}`,
      `<p>${company} sent you invoice <b>${esc(i.number)}</b> for <b>${esc(this.money(i))}</b>, due ${i.dueDate.toISOString().slice(0, 10)}.</p>
       <p>${esc(i.description || '')}</p>
       <p><a href="${this.link(i)}">View and pay the invoice</a></p>
       <p style="color:#666;font-size:12px">Settles in ${esc(i.asset)} on NEAR (${esc(i.network)}). SkyPay will never ask you to change a payout address by email.</p>`,
    ];
  }

  receiptMail(i) {
    const url = this.near.explorerTx(i.settledTxHash);
    return [
      `Receipt: invoice ${i.number} paid (${this.money(i, i.settledAmount)})`,
      `<p>Payment received for invoice <b>${esc(i.number)}</b>.</p>
       <p>Amount: <b>${esc(this.money(i, i.settledAmount))}</b><br>Settled: ${i.settledAt.toISOString()}<br>
       Transaction: <a href="${url}">${esc(i.settledTxHash)}</a></p>
       <p><a href="${this.link(i)}">Invoice ${esc(i.number)}</a></p>`,
    ];
  }

  /** Upsert the invoice row in the company's Notion (keyed by invoice id). Notion is a view, never the ledger. */
  async syncNotion(i) {
    const db = await this.prisma.notionDatabase.findFirst({ where: { userId: i.userId, databaseType: 'INCOMING_PAYMENTS', isActive: true } });
    if (!i.user.notionApiKey || !db) {
      console.log(`🗃️ [fixture] Notion not connected; would upsert invoice ${i.number} (${i.status})`);
      return 'fixture';
    }
    const notion = new NotionService(i.user.notionApiKey);
    const r = await notion.updateOrCreateIncomingPaymentRecord(db.databaseId, {
      requestId: i.id, amount: Number(formatUnits(i.amount, i.decimals)), currency: i.asset, network: i.network,
      recipientEmail: i.customerEmail, recipientName: i.customerName, description: `${i.number} ${i.description || ''}`.trim(),
      transactionType: 'invoice', status: i.status === 'paid' ? 'payment_received' : 'processing',
      x402PayLink: this.link(i), paymentHash: i.settledTxHash || '',
    });
    if (r && r.success === false) throw new Error(r.error || 'notion upsert failed');
    return 'live';
  }
}

export default Outbox;
