import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

// Seeds the first admin from env so credentials never live in source/git.
// Set ADMIN_EMAIL and ADMIN_PASSWORD in .env (and on the host) before running:
//   npm run admin:seed
async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('❌ Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('❌ ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  // Create-only: never overwrite an existing admin's password. Safe to run on
  // every deploy (build hook) without clobbering a password changed via the portal.
  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    console.log(`ℹ️  Admin already exists: ${email} (password left unchanged)`);
    return;
  }

  const hashed = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
  const admin = await prisma.admin.create({ data: { email, password: hashed } });
  console.log(`✅ Admin seeded: ${admin.email}`);
}

main()
  .catch((e) => {
    console.error('❌ Admin seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
