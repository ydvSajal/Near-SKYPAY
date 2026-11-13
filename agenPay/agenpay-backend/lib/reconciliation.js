// Read-only recovery: restart scans persisted attempts; it never submits a payment.
export class ReconciliationWorker {
  constructor({ prisma, skypay }) { this.prisma = prisma; this.skypay = skypay; }
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
