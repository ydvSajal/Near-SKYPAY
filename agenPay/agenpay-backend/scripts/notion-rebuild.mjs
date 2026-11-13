// Queue a forced Notion workspace rebuild (new layout) for one account: node scripts/notion-rebuild.mjs <email>
// The running backend picks the job up; blocks SkyPay added before go to Notion trash (recoverable), the user's own blocks stay.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const u = await prisma.user.findUnique({ where: { email: process.argv[2] } });
if (!u) throw new Error('no such user');
await prisma.outboxJob.create({
  data: { userId: u.id, kind: 'notion_setup', idempotencyKey: `notion_setup:${u.id}:force:${Date.now()}`, payload: { userId: u.id, force: true } },
});
console.log('queued forced rebuild');
await prisma.$disconnect();
