// Read-only recovery: restart scans persisted attempts; it never submits a payment.
const STALE_BATCH_MS = 10 * 60_000; // a synchronous run (max 25 items) is long finished by then

export class ReconciliationWorker {
  constructor({ prisma, skypay, bills }) { this.prisma = prisma; this.skypay = skypay; this.bills = bills; }
  async runOnce() {
    if (this.running) return 0;
    this.running = true;
    try {
      const attempts = await this.prisma.paymentAttempt.findMany({
        where: { direction: 'OUT', status: { in: ['submitted', 'processing', 'unknown'] } },
        orderBy: { updatedAt: 'asc' }, take: 50,
      });
      for (const a of attempts) {
        try { await this.skypay.reconcile(a.userId, a.id); }
        catch (e) { console.error('reconciliation:', a.id, e.message); }
      }
      // Runs interrupted by a crash stay "queued"/"processing": recompute from their persisted lines.
      const batches = await this.prisma.payoutBatch.findMany({
        where: { status: { in: ['queued', 'processing'] }, createdAt: { lt: new Date(Date.now() - STALE_BATCH_MS) } }, take: 20,
      });
      for (const b of batches) {
        try { await this.skypay.refreshBatch(b.userId, b.id); }
        catch (e) { console.error('reconciliation batch:', b.id, e.message); }
      }
      if (this.bills) await this.bills.repairStuck().catch((e) => console.error('reconciliation bills:', e.message));
      return attempts.length;
    } finally { this.running = false; }
  }
  start(intervalMs = 30_000) {
    if (this.timer) return;
    this.runOnce().catch((e) => console.error('reconciliation:', e.message));
    this.timer = setInterval(() => this.runOnce().catch((e) => console.error('reconciliation:', e.message)), intervalMs);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}
