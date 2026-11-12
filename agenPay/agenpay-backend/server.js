#!/usr/bin/env node

/**
 * AgenPay Multi-User API Server
 * Express.js server with authentication, Notion integration, Privy wallets, and AI agents
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
import { randomBytes } from 'crypto';
import { recoverMessageAddress } from 'viem';
import { PrismaClient } from '@prisma/client';
import AgenPayAgent from './lib/AgentPayAgent.js';
import NotionService from './lib/NotionService.js';
import WalletService from './lib/WalletService.js';
import X402PayService from './lib/X402PayService.js';
import SchedulingService from './lib/SchedulingService.js';
import adminRouter from './lib/adminRouter.js';
import { NearService } from './lib/near/NearService.js';
import { Outbox } from './lib/outbox.js';
import { SkyPay } from './lib/skypay.js';
import { createNearRouter } from './lib/nearRouter.js';

// Load environment variables
config();

// Fail fast: signing tokens with an undefined secret must never happen.
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

// Initialize services
const app = express();
// Behind Railway/Vercel proxy: needed so rate limiting sees real client IPs.
app.set('trust proxy', 1);
const prisma = new PrismaClient();
const walletService = new WalletService();
const x402PayService = new X402PayService();
const schedulingService = new SchedulingService();
const nearService = new NearService(process.env);
const outbox = new Outbox({ prisma, near: nearService });
const skypay = new SkyPay({ prisma, near: nearService, outbox });

// Store active agents for each user
const activeAgents = new Map();

// 🔧 Middleware (must be registered before mounting any routes, including X402Pay)
app.use(helmet());
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
// app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Tighter limit on credential endpoints: blunts brute-force and enumeration.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' },
});
app.use('/api/auth/', authLimiter);

// Public payment pages: cap unauthenticated hits (on-chain verification is slow/expensive).
const paymentPageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/x402pay/', paymentPageLimiter);

// 🛡️ Admin portal API (own auth; type:'admin' JWT, separate from user tokens)
app.use('/api/admin', adminRouter);

// 🔧 Setup X402Pay routes (mounted after security middleware so it's covered by helmet/CORS)
console.log('🔧 Setting up X402 payment routes...');
app.use('/', x402PayService.app); // Mount X402Pay routes to main app

// 🛡️ Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, notionApiKey: true, walletAddress: true, externalWalletAddress: true, walletProvider: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// ⛓️ NEAR workflow: company vault, sponsored relay, invoices, checkout, exports
app.use(createNearRouter({ prisma, near: nearService, skypay, authenticateToken }));

// 🏠 Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      database: 'connected',
      wallet: walletService.initialized ? 'live' : 'mock',
    },
  });
});

// � Check workspace setup status (requires auth; caller can only check own status)
app.get('/api/workspace-status/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.id !== userId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notionWorkspaceId: true, notionApiKey: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Check if workspace is fully set up
    const workspaceReady = !!user.notionWorkspaceId && !!user.notionApiKey;

    res.json({
      success: true,
      workspaceReady,
      data: {
        notionConnected: !!user.notionApiKey,
        workspaceCreated: !!user.notionWorkspaceId
      }
    });
  } catch (error) {
    console.error('Error checking workspace status:', error);
    res.status(500).json({ success: false, error: 'Failed to check workspace status' });
  }
});

// �📝 User Registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || email.split('@')[0],
      },
    });

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    console.log(`✅ User registered: ${email}`);
    
    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// 🔐 User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    console.log(`✅ User logged in: ${email}`);
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        hasNotionIntegration: !!user.notionApiKey,
        hasWallet: !!user.walletAddress,
      },
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// 🗃️ Get Notion OAuth URL
app.get('/api/notion/auth-url', authenticateToken, async (req, res) => {
  try {
    const authUrl = NotionService.generateOAuthUrl(req.user.id);
    res.json({
      success: true,
      authUrl
    });
  } catch (error) {
    console.error('❌ Notion auth URL error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 🔗 Handle Notion OAuth Callback
app.get('/api/notion/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  console.log(`\n🔔 === NOTION CALLBACK HIT ===`);
  console.log(`   Query params: code=${req.query.code ? req.query.code.substring(0, 8) + '...' : 'MISSING'}, state=${req.query.state || 'MISSING'}`);
  console.log(`   Frontend URL for redirect: ${frontendUrl}`);

  try {
    const { code, state } = req.query;

    if (!code || !state) {
      console.log('❌ Missing code or state, redirecting with error');
      return res.redirect(`${frontendUrl}/auth/notion-callback?error=missing_code_or_state`);
    }

    // Step 1: Exchange code for access token
    console.log('📡 Step 1: Exchanging code for access token...');
    let oauthResult;
    try {
      oauthResult = await NotionService.handleOAuthCallback(code, state);
      console.log(`✅ Step 1 complete: Got access token for user ${oauthResult.userId}`);
    } catch (tokenError) {
      console.error('❌ Step 1 FAILED - Token exchange error:', tokenError.message);
      return res.redirect(`${frontendUrl}/auth/notion-callback?error=${encodeURIComponent('Token exchange failed: ' + tokenError.message)}`);
    }

    // Step 2: Save token to user
    console.log('💾 Step 2: Saving token to database...');
    try {
      await prisma.user.update({
        where: { id: oauthResult.userId },
        data: { notionApiKey: oauthResult.accessToken },
      });
      console.log(`✅ Step 2 complete: Token saved for user ${oauthResult.userId}`);
    } catch (dbError) {
      console.error('❌ Step 2 FAILED - Database error:', dbError.message);
      return res.redirect(`${frontendUrl}/auth/notion-callback?error=${encodeURIComponent('Database error: ' + dbError.message)}`);
    }

    // Step 2.5: Generate a fresh JWT token for the user to re-authenticate on frontend
    const user = await prisma.user.findUnique({
      where: { id: oauthResult.userId },
      select: { id: true, email: true, name: true }
    });
    
    const authToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    console.log(`🔑 Generated fresh auth token for user ${user.email}`);

    // Step 3: Redirect to loading page with auth token (frontend will poll for completion)
    const loadingUrl = `${frontendUrl}/auth/notion-callback?processing=true&userId=${oauthResult.userId}&token=${authToken}`;
    console.log(`🔀 Step 3: Redirecting to loading page with auth token`);
    res.redirect(loadingUrl);

    // Step 4: Complete workspace setup in background (non-blocking)
    setImmediate(async () => {
      try {
        console.log('🏗️ Step 4: Starting background workspace setup...');
        const notionService = new NotionService(oauthResult.accessToken);
        await notionService.completeIntegration(oauthResult.userId, oauthResult.accessToken);
        console.log(`✅ Step 4 complete: Workspace setup done for user ${oauthResult.userId}`);
      } catch (setupError) {
        console.error(`⚠️ Step 4 FAILED (non-critical):`, setupError.message);
      }
    });
  } catch (error) {
    console.error('❌ Notion OAuth callback UNEXPECTED error:', error);
    if (!res.headersSent) {
      res.redirect(`${frontendUrl}/auth/notion-callback?error=${encodeURIComponent(error.message || 'OAuth failed')}`);
    }
  }
});



// 💳 Create Wallet
app.post('/api/wallet/create', authenticateToken, async (req, res) => {
  try {
    const { network = 'sei-testnet' } = req.body;

    // Check if user already has wallet
    const hasWallet = await walletService.hasWallet(req.user.id);
    if (hasWallet) {
      return res.status(400).json({ error: 'User already has a wallet' });
    }

    // Validate network
    const supportedNetworks = walletService.getSupportedNetworks();
    const isValidNetwork = supportedNetworks.some(n => n.id === network);
    if (!isValidNetwork) {
      return res.status(400).json({ 
        error: 'Invalid network', 
        supportedNetworks: supportedNetworks.map(n => n.id) 
      });
    }

    // Create new wallet
    const walletResult = await walletService.createWallet(req.user.id, network);

    console.log(`✅ Wallet created for user ${req.user.email} on ${network}`);
    
    res.status(201).json({
      success: true,
      data: walletResult,
      message: 'Wallet created successfully'
    });
  } catch (error) {
    console.error('❌ Wallet creation error:', error);
    res.status(500).json({ error: 'Wallet creation failed' });
  }
});

// 💰 Get Wallet Info
app.get('/api/wallet', authenticateToken, async (req, res) => {
  try {
    const walletInfo = await walletService.getWallet(req.user.id);
    res.json({
      success: true,
      data: walletInfo
    });
  } catch (error) {
    console.error('❌ Get wallet error:', error);
    res.status(404).json({ 
      success: false,
      error: 'Wallet not found' 
    });
  }
});

// 🔗 Connect external (self-custody) wallet — step 1: issue a nonce to sign
const buildConnectMessage = (nonce) =>
  `Sign this message to link your wallet to SKYPay.\n\nThis request will not trigger a blockchain transaction or cost any gas.\n\nNonce: ${nonce}`;

app.get('/api/wallet/connect/nonce', authenticateToken, async (req, res) => {
  try {
    const nonce = randomBytes(16).toString('hex');
    await prisma.user.update({
      where: { id: req.user.id },
      data: { walletNonce: nonce },
    });
    res.json({ success: true, nonce, message: buildConnectMessage(nonce) });
  } catch (error) {
    console.error('❌ Connect nonce error:', error);
    res.status(500).json({ success: false, error: 'Failed to issue nonce' });
  }
});

// 🔗 Connect external wallet — step 2: verify the signature proves address ownership
app.post('/api/wallet/connect/verify', authenticateToken, async (req, res) => {
  try {
    const { address, signature, provider } = req.body;

    if (!address || !signature) {
      return res.status(400).json({ success: false, error: 'address and signature are required' });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { walletNonce: true },
    });
    if (!user?.walletNonce) {
      return res.status(400).json({ success: false, error: 'No pending connect request. Request a nonce first.' });
    }

    // Recover the signer and confirm it matches the claimed address (EOA / EIP-191).
    let recovered;
    try {
      recovered = await recoverMessageAddress({
        message: buildConnectMessage(user.walletNonce),
        signature,
      });
    } catch {
      return res.status(400).json({ success: false, error: 'Signature could not be verified' });
    }

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ success: false, error: 'Signature does not match address' });
    }

    // Consume the nonce so the signature can't be replayed, and persist the wallet.
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        externalWalletAddress: address.toLowerCase(),
        walletProvider: typeof provider === 'string' ? provider.slice(0, 40) : null,
        walletNonce: null,
      },
    });

    console.log(`🔗 External wallet linked for ${req.user.email}: ${address}`);
    res.json({ success: true, data: { externalWalletAddress: address.toLowerCase(), walletProvider: provider || null } });
  } catch (error) {
    console.error('❌ Connect verify error:', error);
    res.status(500).json({ success: false, error: 'Failed to verify wallet' });
  }
});

// 🔗 Disconnect external wallet
app.post('/api/wallet/disconnect', authenticateToken, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { externalWalletAddress: null, walletProvider: null },
    });
    res.json({ success: true, message: 'External wallet disconnected' });
  } catch (error) {
    console.error('❌ Wallet disconnect error:', error);
    res.status(500).json({ success: false, error: 'Failed to disconnect wallet' });
  }
});

// 🚰 Request Testnet Tokens
app.post('/api/wallet/faucet', authenticateToken, async (req, res) => {
  try {
    const { network = 'sei-testnet' } = req.body;

    // Check if wallet exists
    if (!req.user.walletAddress) {
      return res.status(400).json({ 
        success: false,
        error: 'No wallet found. Please create a wallet first.',
      });
    }

    // Validate network (only testnet networks support faucet)
    const supportedNetworks = walletService.getSupportedNetworks();
    const targetNetwork = supportedNetworks.find(n => n.id === network);
    
    if (!targetNetwork) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid network', 
        supportedNetworks: supportedNetworks.map(n => n.id) 
      });
    }

    if (!targetNetwork.isTestnet) {
      return res.status(400).json({ 
        success: false,
        error: 'Faucet only available for testnet networks',
        testnetNetworks: supportedNetworks.filter(n => n.isTestnet).map(n => n.id)
      });
    }

    console.log(`🚰 Requesting testnet tokens for user ${req.user.email} (${req.user.walletAddress}) on ${network}`);
    const faucetResult = await walletService.requestTestnetTokens(req.user.id, network);
    
    console.log(`✅ Testnet tokens requested for user ${req.user.email} on ${network}:`, faucetResult);
    res.json({
      success: true,
      data: faucetResult,
      message: 'Testnet tokens requested successfully'
    });
  } catch (error) {
    console.error('❌ Faucet error:', error.message);
    console.error('❌ Faucet error stack:', error.stack);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Faucet request failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 🌐 Get Supported Networks
app.get('/api/wallet/networks', authenticateToken, async (req, res) => {
  try {
    const networks = walletService.getSupportedNetworks();
    res.json({
      success: true,
      networks,
    });
  } catch (error) {
    console.error('❌ Get networks error:', error);
    res.status(500).json({ error: 'Failed to get supported networks' });
  }
});

// 🪙 Get Supported Tokens
app.get('/api/wallet/tokens', authenticateToken, async (req, res) => {
  try {
    const { network = 'sei-testnet' } = req.query;
    
    const supportedNetworks = walletService.getSupportedNetworks();
    const isValidNetwork = supportedNetworks.some(n => n.id === network);
    if (!isValidNetwork) {
      return res.status(400).json({ 
        error: 'Invalid network', 
        supportedNetworks: supportedNetworks.map(n => n.id) 
      });
    }

    const tokens = walletService.getSupportedTokens(network);
    res.json({
      success: true,
      network,
      tokens,
    });
  } catch (error) {
    console.error('❌ Get tokens error:', error);
    res.status(500).json({ error: 'Failed to get supported tokens' });
  }
});

// 📊 Wallet Status & Privy Info
app.get('/api/wallet/status', authenticateToken, async (req, res) => {
  try {
    const privyStatus = walletService.getStatus();
    const hasWallet = await walletService.hasWallet(req.user.id);
    
    let walletInfo = null;
    if (hasWallet) {
      try {
        walletInfo = await walletService.getWallet(req.user.id);
      } catch (error) {
        console.warn('⚠️ Could not get wallet info:', error.message);
      }
    }

    res.json({
      success: true,
      privy: privyStatus,
      hasWallet,
      wallet: walletInfo,
    });
  } catch (error) {
    console.error('❌ Get wallet status error:', error);
    res.status(500).json({ error: 'Failed to get wallet status' });
  }
});

// 📊 Dashboard Analytics
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    // Get wallet analytics (handle gracefully if no wallet exists yet)
    let walletAnalytics = null;
    try {
      walletAnalytics = await walletService.getWalletAnalytics(req.user.id);
    } catch (walletErr) {
      console.warn('⚠️ Wallet analytics not available:', walletErr.message);
    }
    
    // Get agent status (check if running in memory + database status)
    const isAgentRunning = activeAgents.has(req.user.id);
    const agent = await prisma.agent.findUnique({
      where: { userId: req.user.id },
    });

    // Get recent transactions with proper formatting
    const dbTransactions = await prisma.transaction.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Format transactions for frontend
    const transactions = dbTransactions.map(tx => ({
      id: tx.id,
      type: tx.type.toLowerCase(), // INCOMING -> incoming, OUTGOING -> outgoing
      amount: tx.amount.toString(),
      currency: tx.currency,
      status: tx.status.toLowerCase(), // COMPLETED -> completed
      createdAt: tx.createdAt.toISOString(),
      description: tx.description || `${tx.type} payment`,
      toAddress: tx.toAddress,
      fromAddress: tx.fromAddress,
      txHash: tx.txHash
    }));

    // Get Notion analytics if available
    let notionAnalytics = null;
    if (req.user.notionApiKey) {
      try {
        const notionService = new NotionService(req.user.notionApiKey);
        notionAnalytics = await notionService.getPaymentAnalytics(req.user.id);
      } catch (error) {
        console.warn('⚠️ Notion analytics failed:', error.message);
      }
    }

    // Calculate analytics from real transaction data
    const analytics = {
      totalSent: transactions.filter(tx => tx.type === 'outgoing' && tx.status === 'completed')
        .reduce((sum, tx) => sum + parseFloat(tx.amount), 0),
      totalReceived: transactions.filter(tx => tx.type === 'incoming' && tx.status === 'completed')
        .reduce((sum, tx) => sum + parseFloat(tx.amount), 0),
      totalTransactions: transactions.length,
      successRate: transactions.length > 0 
        ? (transactions.filter(tx => tx.status === 'completed').length / transactions.length) * 100 
        : 0
    };

    // Connected (self-custody) wallet — read-only balance from chain RPC
    let externalWallet = null;
    if (req.user.externalWalletAddress) {
      let balance = null;
      try {
        balance = await walletService.getBlockchainBalance(req.user.externalWalletAddress, 'sei-testnet');
      } catch (balErr) {
        console.warn('⚠️ External wallet balance fetch failed:', balErr.message);
      }
      externalWallet = {
        address: req.user.externalWalletAddress,
        provider: req.user.walletProvider,
        balance,
      };
    }

    const dashboard = {
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        hasNotionIntegration: !!req.user.notionApiKey,
        hasWallet: !!req.user.walletAddress,
        externalWalletAddress: req.user.externalWalletAddress,
        walletProvider: req.user.walletProvider,
      },
      wallet: walletAnalytics,
      externalWallet,
      agent: {
        isRunning: isAgentRunning, // ✅ Fixed: Use isRunning instead of status
        status: isAgentRunning ? 'RUNNING' : 'STOPPED',
        lastActivity: agent?.lastActivity,
        totalProcessed: agent?.totalProcessed || 0,
        totalSent: agent?.totalSent || 0,
        totalReceived: agent?.totalReceived || 0,
        totalAmountSent: agent?.totalAmountSent || 0,
        totalAmountReceived: agent?.totalAmountReceived || 0,
        threadId: `user-${req.user.id}-chat-session` // For conversation continuity
      },
      transactions,
      analytics, // ✅ Added: Real analytics calculated from transactions
      notion: notionAnalytics,
    };

    res.json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    console.error('❌ Dashboard error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Dashboard data retrieval failed' 
    });
  }
});

// 🤖 Start Agent
app.post('/api/agent/start', authenticateToken, async (req, res) => {
  try {
    const { intervalMinutes = 10 } = req.body;

    // Check if agent already running
    if (activeAgents.has(req.user.id)) {
      return res.status(400).json({ error: 'Agent already running' });
    }

    // Create and start agent with shared services
    const userConfig = {
      notionApiKey: req.user.notionApiKey,
    };

    const sharedServices = {
      x402PayService: x402PayService,  // Pass the shared X402PayService instance
      skypay,
    };

    const agent = new AgenPayAgent(req.user.id, userConfig, sharedServices);
    await agent.ensureInitialized();
    await agent.startMonitoring(intervalMinutes);

    // Store active agent
    activeAgents.set(req.user.id, agent);

    console.log(`✅ Agent started for user ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'Agent started successfully',
      intervalMinutes,
    });
  } catch (error) {
    console.error('❌ Agent start error:', error);
    res.status(500).json({ error: 'Failed to start agent' });
  }
});

// 🛑 Stop Agent
app.post('/api/agent/stop', authenticateToken, async (req, res) => {
  try {
    const agent = activeAgents.get(req.user.id);
    
    if (!agent) {
      return res.status(400).json({ error: 'Agent not running' });
    }

    await agent.stopMonitoring();
    activeAgents.delete(req.user.id);

    console.log(`✅ Agent stopped for user ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'Agent stopped successfully',
    });
  } catch (error) {
    console.error('❌ Agent stop error:', error);
    res.status(500).json({ error: 'Failed to stop agent' });
  }
});

// 💬 Process Payment (Chat with Agent)
app.post('/api/agent/process', authenticateToken, async (req, res) => {
  try {
    const { message, threadId } = req.body;
    const messageText = typeof message === 'string' ? message : String(message || '');

    if (!messageText) {
      return res.status(400).json({ 
        success: false,
        error: 'Message required' 
      });
    }

    console.log(`💬 Processing message for user ${req.user.email}: "${messageText.substring(0, 50)}..."`);

    // Get or create agent
    let agent = activeAgents.get(req.user.id);
    
    if (!agent) {
      console.log(`🔧 Creating new agent for user ${req.user.email}`);
      const userConfig = {
        notionApiKey: req.user.notionApiKey,
      };
      
      const sharedServices = {
        x402PayService: x402PayService,  // Pass the shared X402PayService instance
        skypay,
      };
      
      try {
        agent = new AgenPayAgent(req.user.id, userConfig, sharedServices);
        await agent.ensureInitialized();
        activeAgents.set(req.user.id, agent);
        console.log(`✅ Agent created for user ${req.user.email}`);
      } catch (agentError) {
        console.error(`❌ Error creating agent for user ${req.user.email}:`, agentError.message);
        return res.status(500).json({ 
          success: false,
          error: 'Failed to initialize payment agent. Please try again.',
          details: process.env.NODE_ENV === 'development' ? agentError.message : undefined
        });
      }
    }

    // Process payment request
    console.log(`🔄 Processing payment with agent for user ${req.user.email}`);
    const result = await agent.processPayment(messageText, threadId);

    // Extract the AI's response from the processed result
    let aiResponse = 'I apologize, but I encountered an issue processing your request. Please try again.';
    
    console.log('🔍 Debug - Agent result structure:', {
      hasMessages: !!result.messages,
      messageCount: result.messages?.length || 0,
      threadId: result.threadId
    });
    
    if (result.messages && Array.isArray(result.messages) && result.messages.length > 0) {
      // Get the last message which should be the AI's response
      const lastMessage = result.messages[result.messages.length - 1];
      console.log('🔍 Last message:', lastMessage);
      
      if (lastMessage && lastMessage.content) {
        aiResponse = typeof lastMessage.content === 'string' 
          ? lastMessage.content 
          : JSON.stringify(lastMessage.content);
        console.log('✅ Found AI response:', aiResponse.substring(0, 100) + '...');
      }
    } else {
      console.log('⚠️ No messages found in result');
    }

    const aiResponsePreview = typeof aiResponse === 'string' ? aiResponse : String(aiResponse || '');
    console.log(`✅ Payment processed for user ${req.user.email}: ${aiResponsePreview.substring(0, 100)}...`);
    
    res.json({
      success: true,
      data: {
        response: aiResponse,
        threadId: result.threadId,
        // Internal agent state (tool calls, config) only exposed outside production.
        fullResult: process.env.NODE_ENV === 'development' ? result : undefined,
      }
    });
  } catch (error) {
    console.error('❌ Payment processing error:', error.message);
    console.error('❌ Payment processing error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Payment processing failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 📈 Transaction History
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, type, status } = req.query;

    const where = { userId: req.user.id };
    if (type) where.type = type;
    if (status) where.status = status;

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(parseInt(limit) || 20, 1), 100),
    });

    res.json({
      success: true,
      transactions,
      total: transactions.length,
    });
  } catch (error) {
    console.error('❌ Transaction history error:', error);
    res.status(500).json({ error: 'Failed to retrieve transactions' });
  }
});

// 💸 Send Crypto
app.post('/api/wallet/send', authenticateToken, async (req, res) => {
  try {
    const { toAddress, amount, currency = 'ETH', network = 'sei-testnet' } = req.body;

    if (!toAddress || !amount) {
      return res.status(400).json({ error: 'Recipient address and amount required' });
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    if (!walletService.validateAddress(toAddress)) {
      return res.status(400).json({ error: 'Invalid recipient address' });
    }

    // Validate network
    const supportedNetworks = walletService.getSupportedNetworks();
    const isValidNetwork = supportedNetworks.some(n => n.id === network);
    if (!isValidNetwork) {
      return res.status(400).json({ 
        error: 'Invalid network', 
        supportedNetworks: supportedNetworks.map(n => n.id) 
      });
    }

    // Validate currency for network
    const supportedTokens = walletService.getSupportedTokens(network);
    const isValidCurrency = supportedTokens.some(t => t.symbol.toUpperCase() === currency.toUpperCase());
    if (!isValidCurrency) {
      return res.status(400).json({ 
        error: 'Invalid currency for network', 
        supportedTokens: supportedTokens.map(t => t.symbol) 
      });
    }

    const result = await walletService.sendCrypto(req.user.id, toAddress, amount, currency, network);

    console.log(`✅ ${amount} ${currency} sent by user ${req.user.email} on ${network}`);
    res.json({
      success: true,
      data: result,
      message: 'Crypto sent successfully'
    });
  } catch (error) {
    console.error('❌ Send crypto error:', error);
    res.status(500).json({ error: 'Failed to send crypto' });
  }
});



// 📊 Agent Status
app.get('/api/agent/status', authenticateToken, async (req, res) => {
  try {
    const isRunning = activeAgents.has(req.user.id);
    
    const agentRecord = await prisma.agent.findUnique({
      where: { userId: req.user.id },
    });

    res.json({
      success: true,
      isRunning,
      status: agentRecord?.status || 'STOPPED',
      lastActivity: agentRecord?.lastActivity,
      stats: agentRecord ? {
        totalProcessed: agentRecord.totalProcessed,
        totalSent: agentRecord.totalSent,
        totalReceived: agentRecord.totalReceived,
        totalAmountSent: agentRecord.totalAmountSent,
        totalAmountReceived: agentRecord.totalAmountReceived,
      } : null,
    });
  } catch (error) {
    console.error('❌ Agent status error:', error);
    res.status(500).json({ error: 'Failed to get agent status' });
  }
});

// 🔄 Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  
  // Stop all active agents
  for (const [userId, agent] of activeAgents) {
    try {
      await agent.cleanup();
      console.log(`✅ Agent cleaned up for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error cleaning up agent for user ${userId}:`, error);
    }
  }
  
  // Disconnect from database
  await prisma.$disconnect();
  await walletService.cleanup();
  
  console.log('✅ Server shutdown complete');
  process.exit(0);
});

// 🚀 Start server
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  outbox.start();
  console.log(`⛓️  NEAR ${nearService.network}: ${nearService.configured ? `token ${nearService.token}, relayer ${nearService.relayerId}` : 'NOT configured (npm run near:bootstrap)'}`);
  console.log(`
🚀 AgenPay Multi-User API Server
================================
Server running on port ${PORT}
Environment: ${process.env.NODE_ENV || 'development'}

🔧 Services:
- Database: ${prisma ? '✅ Connected' : '❌ Disconnected'}
      - Wallet: ${walletService.initialized ? '✅ Privy Live' : '🧪 Mock Mode'}
- JWT Auth: ${process.env.JWT_SECRET ? '✅ Configured' : '❌ Missing'}

📚 API Endpoints:
- POST /api/auth/register - User registration
- POST /api/auth/login - User login
- POST /api/notion/login - Notion integration
- POST /api/wallet/create - Create Privy wallet
- GET /api/dashboard - Dashboard analytics
- POST /api/agent/start - Start AI agent
- POST /api/agent/process - Process payments
- GET /health - Health check

🎯 Ready for production deployment!
  `);
}); 