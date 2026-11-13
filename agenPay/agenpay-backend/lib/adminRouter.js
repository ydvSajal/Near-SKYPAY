import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

// Admin portal API. Mounted at /api/admin. All routes except /login require a
// valid admin JWT (type: 'admin'), which is distinct from the user JWT so a
// normal user token can never reach these endpoints.
const prisma = new PrismaClient();
const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

const authenticateAdmin = async (req, res, next) => {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Admin token required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ error: 'Not an admin token' });

    const admin = await prisma.admin.findUnique({
      where: { id: decoded.adminId },
      select: { id: true, email: true },
    });
    if (!admin) return res.status(401).json({ error: 'Admin no longer exists' });

    req.admin = admin;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired admin token' });
  }
};

// --- Auth ---
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const admin = await prisma.admin.findUnique({ where: { email } });
    // Same response whether the email is unknown or the password is wrong.
    if (!admin || !(await bcrypt.compare(password, admin.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { adminId: admin.id, type: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ success: true, token, admin: { id: admin.id, email: admin.email } });
  } catch (error) {
    console.error('❌ Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticateAdmin, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// --- Users ---
router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, name: true, nearAccountId: true, notionWorkspaceId: true, createdAt: true,
        _count: { select: { invoices: true, paymentAttempts: true } },
      },
    });
    res.json({ success: true, users });
  } catch (error) {
    console.error('❌ Admin list users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

router.delete('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    console.error('❌ Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// --- System config (key/value). Note: agent reads live keys from env, not here. ---
router.get('/config', authenticateAdmin, async (req, res) => {
  try {
    const config = await prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
    res.json({ success: true, config });
  } catch (error) {
    console.error('❌ Admin list config error:', error);
    res.status(500).json({ error: 'Failed to list config' });
  }
});

router.put('/config/:key', authenticateAdmin, async (req, res) => {
  try {
    const { value, description } = req.body || {};
    if (typeof value !== 'string') return res.status(400).json({ error: 'value (string) required' });

    const entry = await prisma.systemConfig.upsert({
      where: { key: req.params.key },
      update: { value, description },
      create: { key: req.params.key, value, description },
    });
    res.json({ success: true, config: entry });
  } catch (error) {
    console.error('❌ Admin upsert config error:', error);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

router.delete('/config/:key', authenticateAdmin, async (req, res) => {
  try {
    await prisma.systemConfig.delete({ where: { key: req.params.key } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Config key not found' });
    console.error('❌ Admin delete config error:', error);
    res.status(500).json({ error: 'Failed to delete config' });
  }
});

// --- Admins ---
router.get('/admins', authenticateAdmin, async (req, res) => {
  try {
    const admins = await prisma.admin.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, createdAt: true },
    });
    res.json({ success: true, admins });
  } catch (error) {
    console.error('❌ Admin list admins error:', error);
    res.status(500).json({ error: 'Failed to list admins' });
  }
});

router.post('/admins', authenticateAdmin, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const exists = await prisma.admin.findUnique({ where: { email } });
    if (exists) return res.status(400).json({ error: 'Admin already exists' });

    const hashed = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const admin = await prisma.admin.create({
      data: { email, password: hashed },
      select: { id: true, email: true, createdAt: true },
    });
    res.status(201).json({ success: true, admin });
  } catch (error) {
    console.error('❌ Admin create admin error:', error);
    res.status(500).json({ error: 'Failed to create admin' });
  }
});

router.delete('/admins/:id', authenticateAdmin, async (req, res) => {
  try {
    // Never let the portal delete its last admin (would lock everyone out).
    const count = await prisma.admin.count();
    if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });

    await prisma.admin.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Admin not found' });
    console.error('❌ Admin delete admin error:', error);
    res.status(500).json({ error: 'Failed to delete admin' });
  }
});

export default router;
