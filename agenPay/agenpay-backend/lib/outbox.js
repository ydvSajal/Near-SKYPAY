// Durable outbox: side effects (emails, Notion rows) run only from persisted jobs,
// are idempotent by key, retried with backoff, and never change financial truth (A03, A07, A20).
import nodemailer from 'nodemailer';
import { NotionService } from './NotionService.js';
import { refreshDashboard, clearDashboard } from './notionDashboard.js';
import { formatUnits } from './near/units.js';

const MAX_ATTEMPTS = 6;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Outbox {
  constructor({ prisma, near, env = process.env }) {
    this.prisma = prisma;
    this.near = near;
    this.env = env;
    this.baseUrl = (env.BASE_URL || `http://localhost:${env.PORT || 3001}`).replace(/[/]$/, '');
    this.appUrl = (env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].trim();
    const live = env.EMAIL_USER && env.EMAIL_PASS && env.EMAIL_USER !== 'test@example.com';
    this.mailer = live
      ? nodemailer.createTransport({ service: env.EMAIL_SERVICE || 'gmail', auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS.trim() } })
      : null;
    this.from = env.EMAIL_FROM || 'SkyPay <noreply@skypay.local>';
    this.payoutsReady = new Set(); // users whose Notion Payouts page + tables were checked this run
    this.payoutCols = new Set(); // Notion payout databases already given the Payee/Batch columns this run
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

  /** Create the Notion workspace, then backfill existing invoices. Retried by the outbox (backoff, 6 attempts).
   *  ponytail: a retry after a half-finished setup can leave a duplicate "SkyPay Workspace" page in Notion. */
  async notionSetup(userId, force = false) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.notionApiKey) return 'skipped';
    const svc = new NotionService(user.notionApiKey);
    if (!user.notionWorkspaceId || force) {
      const old = user.notionWorkspaceId;
      // force = redesign/rebuild: remove only the blocks SkyPay added (to Notion trash, recoverable)
      if (force) {
        await clearDashboard(svc.notion, this.prisma, userId);
        const pp = await this.prisma.notionDatabase.findFirst({ where: { userId, databaseType: 'PAYOUTS_PAGE', isActive: true } });
        if (pp) await svc.notion.pages.update({ page_id: pp.databaseId, archived: true }).catch(() => {}); // Notion trash, recoverable
      }
      this.payoutsReady.delete(userId);
      const { workspacePageId } = await svc.completeIntegration(userId, user.notionApiKey);
      // legacy layout had its own "SkyPay" child page: trash it. Never the shared page itself (old === new).
      if (force && old && old !== workspacePageId) await svc.notion.pages.update({ page_id: old, archived: true }).catch((e) => console.error('archive old workspace:', e.message));
    }
    const invoices = await this.prisma.invoice.findMany({ where: { userId }, select: { id: true } });
    // a fresh key per setup: a rebuilt workspace needs every row again
    const run = Date.now();
    for (const { id } of invoices) await this.enqueue(userId, 'notion_invoice', `notion_invoice:${id}:backfill:${run}`, { invoiceId: id });
    const [payees, payouts] = await Promise.all([
      this.prisma.payee.findMany({ where: { userId }, select: { id: true } }),
      this.prisma.paymentAttempt.findMany({ where: { userId, direction: 'OUT' }, select: { id: true } }),
    ]);
    for (const { id } of payees) await this.enqueue(userId, 'notion_payee', `notion_payee:${id}:backfill:${run}`, { payeeId: id });
    for (const { id } of payouts) await this.enqueue(userId, 'notion_payout', `notion_payout:${id}:backfill:${run}`, { attemptId: id });
    await this.enqueue(userId, 'notion_dashboard', `notion_dashboard:${userId}:setup:${run}`, {});
    return 'live';
  }

  async handle(job) {
    if (job.kind === 'notion_setup') return this.notionSetup(job.userId, !!job.payload?.force);
    if (job.kind === 'notion_dashboard') return this.syncDashboard(job.userId);
    if (job.kind === 'notion_payout') return this.syncPayout(job.payload.attemptId);
    if (job.kind === 'notion_payee') return this.syncPayee(job.payload.payeeId);
    if (job.kind === 'notion_batch') return this.syncRun(job.payload.batchId);
    if (job.kind === 'notion_payee_remove') return this.removePayeeRow(job.userId, job.payload.nearAccount);
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

  /** One inline-styled 600px layout (renders in Gmail/Outlook, no images). All dynamic text must already be escaped. */
  layout(title, body, footer) {
    return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e3e5e8;border-radius:10px">
<tr><td style="padding:20px 28px;border-bottom:1px solid #e3e5e8;font-size:18px;font-weight:700">SkyPay</td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 16px;font-size:20px">${title}</h1>${body}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e3e5e8;font-size:12px;color:#6b7280;line-height:1.5">${footer}</td></tr>
</table></td></tr></table></body></html>`;
  }

  button(href, label) {
    return `<p style="margin:24px 0"><a href="${href}" style="background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${label}</a></p>`;
  }

  footer(i) {
    const test = this.env.NEAR_USDC_IS_TEST_TOKEN === 'true' ? ' This is a testnet invoice paid with a test token that has no monetary value.' : '';
    return `Settles in ${esc(i.asset)} on NEAR (${esc(i.network)}).${test} SkyPay will never ask you to change a payout address by email.`;
  }

  invoiceMail(i) {
    const s = i.seller || {};
    const merchant = s.name || i.user.companyName || i.user.name || i.user.email;
    const due = i.dueDate.toISOString().slice(0, 10);
    const cell = 'padding:8px 0;border-bottom:1px solid #eef0f2;font-size:14px';
    const rows = (Array.isArray(i.lineItems) ? i.lineItems : []).map((li) => `<tr>
      <td style="${cell}">${esc(li.description)}</td><td style="${cell};text-align:right">${esc(li.quantity)}</td>
      <td style="${cell};text-align:right">${esc(formatUnits(li.unitAmount, i.decimals))}</td>
      <td style="${cell};text-align:right">${esc(formatUnits((BigInt(li.unitAmount) * BigInt(li.quantity)).toString(), i.decimals))}</td></tr>`).join('');
    const body = `<p style="margin:0 0 4px;color:#6b7280;font-size:13px">Invoice ${esc(i.number)} from</p>
      <p style="margin:0 0 ${s.address || s.taxId ? 2 : 16}px;font-size:16px;font-weight:600">${esc(merchant)}</p>
      ${s.address || s.taxId ? `<p style="margin:0 0 16px;font-size:12px;color:#6b7280">${esc([s.address, s.country, s.taxId && `Tax ID ${s.taxId}`].filter(Boolean).join(' · '))}</p>` : ''}
      ${i.description ? `<p style="margin:0 0 16px;font-size:14px">${esc(i.description)}</p>` : ''}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr style="font-size:12px;color:#6b7280;text-align:left">
        <th style="padding:6px 0">Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Amount</th></tr>${rows}</table>
      <p style="margin:16px 0 0;text-align:right;font-size:13px;color:#6b7280">Total due</p>
      <p style="margin:0;text-align:right;font-size:26px;font-weight:700">${esc(this.money(i))}</p>
      <p style="margin:8px 0 0;text-align:right;font-size:13px;color:#6b7280">Due ${due}</p>
      ${this.button(this.link(i), 'Pay invoice')}
      ${s.notes ? `<p style="margin:0 0 12px;font-size:13px;color:#374151">${esc(s.notes)}</p>` : ''}
      <p style="margin:0;font-size:12px;color:#6b7280">Button not working? Open ${esc(this.link(i))}</p>`;
    return [`Invoice ${i.number} from ${merchant}: ${this.money(i)} due ${due}`, this.layout(`Invoice ${esc(i.number)}`, body, this.footer(i))];
  }

  receiptMail(i) {
    const url = this.near.explorerTx(i.settledTxHash);
    const body = `<p style="margin:0 0 16px;font-size:14px">Payment received for invoice <b>${esc(i.number)}</b>. Thank you.</p>
      <table cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.8">
        <tr><td style="color:#6b7280;padding-right:16px">Amount</td><td><b>${esc(this.money(i, i.settledAmount))}</b></td></tr>
        <tr><td style="color:#6b7280;padding-right:16px">Settled</td><td>${i.settledAt.toISOString().replace('T', ' ').slice(0, 19)} UTC</td></tr>
        <tr><td style="color:#6b7280;padding-right:16px">Transaction</td><td><a href="${url}" style="word-break:break-all">${esc(i.settledTxHash)}</a></td></tr></table>
      ${this.button(this.link(i), 'View invoice')}`;
    return [`Receipt: invoice ${i.number} paid (${this.money(i, i.settledAmount)})`, this.layout('Payment received', body, this.footer(i))];
  }

  /** Refresh key figures and recent activity on the Notion dashboard (no-op when nothing changed or Notion is not set up). */
  async syncDashboard(userId) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.notionApiKey || !user.notionWorkspaceId) return 'skipped';
    const svc = new NotionService(user.notionApiKey);
    // workspaces built before payroll get the Payouts sub-page (and its two tables) on their next sync
    if (!this.payoutsReady.has(userId)) {
      await svc.ensurePayeesDatabase(userId, user.notionWorkspaceId);
      await svc.ensureRunsDatabase(userId, user.notionWorkspaceId);
      this.payoutsReady.add(userId);
    }
    await refreshDashboard(svc.notion, this.prisma, userId);
    return 'live';
  }

  /** Upsert one vault payout in the Notion "Supplier payments" table. Notion is a view; the DB stays the ledger. */
  async syncPayout(attemptId) {
    const a = await this.prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { user: true, batch: true } });
    if (!a) return 'skipped'; // payee/user deleted meanwhile
    const db = await this.prisma.notionDatabase.findFirst({ where: { userId: a.userId, databaseType: 'OUTGOING_PAYMENTS', isActive: true } });
    if (!a.user.notionApiKey || !db) {
      console.log(`🗃️ [fixture] Notion not connected; would upsert payout ${a.paymentId} (${a.status})`);
      return 'fixture';
    }
    const notion = new NotionService(a.user.notionApiKey);
    if (!this.payoutCols.has(db.databaseId)) { await notion.ensurePayoutColumns(db.databaseId); this.payoutCols.add(db.databaseId); }
    const payee = await this.prisma.payee.findFirst({ where: { userId: a.userId, nearAccount: a.recipient || '' } });
    await notion.upsertOutgoingPaymentRecord(db.databaseId, {
      paymentId: a.paymentId, amount: formatUnits(a.amount), network: a.network.replace(':', '-'), recipientAddress: a.recipient,
      recipientName: payee?.name || a.recipient, fromName: a.user.companyName || a.user.name || 'SkyPay',
      description: a.memo || '', batch: a.batch?.label || '', txHash: a.txHash || '',
      status: { settled: 'completed', failed: 'failed' }[a.status] || 'processing',
      executedAt: a.status === 'settled' ? a.updatedAt.toISOString() : null,
    });
    await this.syncDashboard(a.userId).catch((e) => console.error('notion dashboard refresh:', e.message));
    return 'live';
  }

  async syncPayee(payeeId) {
    const p = await this.prisma.payee.findUnique({ where: { id: payeeId }, include: { user: true } });
    if (!p) return 'skipped';
    if (!p.user.notionApiKey || !p.user.notionWorkspaceId) {
      console.log(`🗃️ [fixture] Notion not connected; would upsert payee ${p.name}`);
      return 'fixture';
    }
    const settled = await this.prisma.paymentAttempt.findMany({
      where: { userId: p.userId, direction: 'OUT', recipient: p.nearAccount, status: 'settled' }, orderBy: { updatedAt: 'desc' }, select: { amount: true, updatedAt: true },
    });
    const total = settled.reduce((a, x) => a + BigInt(x.amount), 0n);
    await new NotionService(p.user.notionApiKey).upsertPayeeRecord(p.userId, p.user.notionWorkspaceId, {
      ...p, totalPaid: Number(formatUnits(total.toString())), payouts: settled.length, lastPaid: settled[0]?.updatedAt.toISOString() || null,
    });
    await this.syncDashboard(p.userId).catch((e) => console.error('notion dashboard refresh:', e.message)); // also creates Payout runs table
    return 'live';
  }

  /** One row per payout run in Notion > Payouts > Payout runs; also refreshes each paid payee's totals. */
  async syncRun(batchId) {
    const b = await this.prisma.payoutBatch.findUnique({ where: { id: batchId }, include: { user: true, payments: true } });
    if (!b) return 'skipped';
    if (!b.user.notionApiKey || !b.user.notionWorkspaceId) {
      console.log(`🗃️ [fixture] Notion not connected; would upsert payout run "${b.label}" (${b.status})`);
      return 'fixture';
    }
    await new NotionService(b.user.notionApiKey).upsertRunRecord(b.userId, b.user.notionWorkspaceId, {
      id: b.id, label: b.label, date: b.createdAt.toISOString(), payments: b.payments.length,
      settled: b.payments.filter((p) => p.status === 'settled').length, total: Number(formatUnits(b.total)), status: b.status, source: b.source || '',
    });
    const payees = await this.prisma.payee.findMany({ where: { userId: b.userId, nearAccount: { in: [...new Set(b.payments.map((p) => p.recipient))] } }, select: { id: true } });
    for (const { id } of payees) await this.enqueue(b.userId, 'notion_payee', `notion_payee:${id}:run:${b.id}`, { payeeId: id });
    await this.syncDashboard(b.userId).catch((e) => console.error('notion dashboard refresh:', e.message));
    return 'live';
  }

  /** Archive the payee's Notion row (Notion trash, recoverable). */
  async removePayeeRow(userId, nearAccount) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.notionApiKey) return 'skipped';
    return (await new NotionService(user.notionApiKey).archivePayeeRecord(userId, nearAccount)) ? 'live' : 'skipped';
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
      x402PayLink: `${this.baseUrl}/x402pay/${i.id}`, paymentHash: i.settledTxHash || '',
    });
    if (r && r.success === false) throw new Error(r.error || 'notion upsert failed');
    await this.syncDashboard(i.userId).catch((e) => console.error('notion dashboard refresh:', e.message)); // never fails the row sync
    return 'live';
  }
}

export default Outbox;
