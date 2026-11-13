#!/usr/bin/env node

/**
 * SkyPay API server: auth, Notion, AI agent, NEAR vault / invoices / x402 (see lib/).
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import AgenPayAgent from './lib/AgentPayAgent.js';
import NotionService from './lib/NotionService.js';
import adminRouter from './lib/adminRouter.js';
import { NearService } from './lib/near/NearService.js';
import { Outbox } from './lib/outbox.js';
import { SkyPay } from './lib/skypay.js';
import { createNearRouter } from './lib/nearRouter.js';
import { createX402Router } from './lib/x402.js';

// Load environment variables
config({ path: ['.env.near', '.env'] }); // NEAR secrets live in .env.near (gitignored)

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
const nearService = new NearService(process.env);
const outbox = new Outbox({ prisma, near: nearService });
const skypay = new SkyPay({ prisma, near: nearService, outbox });

// Store active agents for each user
const activeAgents = new Map();

// Middleware (registered before any route)
app.use(helmet());
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 6000, // sized for 2 s UI polling (hackathon demo)
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

const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, hasNotionIntegration: !!u.notionApiKey, hasNearAccount: !!u.nearAccountId,
});

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
      select: { id: true, email: true, name: true, notionApiKey: true, nearAccountId: true },
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

// x402 on NEAR: pay links (HTTP 402) + self-hosted facilitator
app.use(createX402Router({
  prisma, near: nearService, skypay,
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`,
  appUrl: allowedOrigins[0],
}));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: { database: 'connected', near: nearService.configured ? `${nearService.network}` : 'not configured' },
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

    // self-heal: token saved but workspace never built (e.g. earlier setup failed) -> queue one setup unless one is active
    if (user.notionApiKey && !user.notionWorkspaceId) {
      const active = await prisma.outboxJob.findFirst({ where: { userId, kind: 'notion_setup', status: { in: ['pending', 'running'] } } });
      if (!active) await outbox.enqueue(userId, 'notion_setup', `notion_setup:${userId}:${Date.now()}`, { userId });
    }

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
// Session restore for the web app
app.get('/api/me', authenticateToken, (req, res) => res.json({ success: true, data: { user: publicUser(req.user) } }));

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
    
    res.status(201).json({ success: true, token, user: publicUser(user) });
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
    
    res.json({ success: true, token, user: publicUser(user) });
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

    // Step 4: workspace setup runs as a durable outbox job (retried with backoff), not a one-shot
    await outbox.enqueue(oauthResult.userId, 'notion_setup', `notion_setup:${oauthResult.userId}:${Date.now()}`, { userId: oauthResult.userId });
    console.log('🏗️ Step 4: Notion workspace setup queued');
  } catch (error) {
    console.error('❌ Notion OAuth callback UNEXPECTED error:', error);
    if (!res.headersSent) {
      res.redirect(`${frontendUrl}/auth/notion-callback?error=${encodeURIComponent(error.message || 'OAuth failed')}`);
    }
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

// Graceful shutdown
process.on('SIGINT', async () => {
  for (const [userId, agent] of activeAgents) {
    try { await agent.cleanup(); } catch (error) { console.error(`Error cleaning up agent for user ${userId}:`, error); }
  }
  await prisma.$disconnect();
  process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  outbox.start();
  console.log(`SkyPay API on :${PORT} | NEAR ${nearService.network}: ${nearService.configured ? `token ${nearService.token}, relayer ${nearService.relayerId}` : 'NOT configured (npm run near:bootstrap)'}`);
});
