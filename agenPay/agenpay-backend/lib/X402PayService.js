/**
 * X402Pay Service for AgenPay
 * Handles X402 protocol payment processing and verification
 */

import { paymentMiddleware } from 'x402-express';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { createPublicClient, http, parseEther } from 'viem';
import { seiTestnet } from 'viem/chains';

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class X402PayService {
  constructor() {
    this.instanceId = `x402-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    console.log(`🆔 X402PayService instance created: ${this.instanceId}`);
    
    this.prisma = new PrismaClient();
    
    // X402 middleware needs a facilitator for payment verification
    // Use the correct x402.org facilitator URL (after redirect)
    this.facilitatorConfig = {
      url: process.env.X402_FACILITATOR_URL || "http://localhost:3002",
      // Only sent if FACILITATOR_API_KEY is set; matches the facilitator's own optional check.
      ...(process.env.FACILITATOR_API_KEY && {
        createAuthHeaders: async () => {
          const authHeader = { Authorization: `Bearer ${process.env.FACILITATOR_API_KEY}` };
          return { verify: authHeader, settle: authHeader };
        },
      }),
    };
    
    console.log(`🌐 [${this.instanceId}] X402 Facilitator URL: ${this.facilitatorConfig.url}`);
    
    this.paymentRoutes = new Map();
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
    this.loadActivePaymentRoutes(); // Load existing payment routes from database
  }

  /**
   * Resolve which network string is forwarded to x402 middleware.
   * We allow explicit overrides so local facilitator setups can run on sei-testnet.
   */
  resolveX402Network(network) {
    const override = (process.env.X402_NETWORK_OVERRIDE || '').trim().toLowerCase();
    if (override === 'sei' || override === 'sei-testnet') {
      return override;
    }

    const normalized = (network || '').toLowerCase();

    if (normalized === 'sei' || normalized === 'sei-testnet') {
      return 'sei-testnet';
    }

    // Hard lock to Sei testnet for this deployment.
    return 'sei-testnet';
  }



  /**
   * Load active payment routes from database
   */
  async loadActivePaymentRoutes() {
    try {
      console.log(`🔄 [${this.instanceId}] Loading active payment routes from database...`);
      
      // Get all active payment requests from database
      const activePayments = await this.prisma.paymentRequest.findMany({
        where: {
          status: {
            in: ['processing', 'scheduled']
          }
        },
        include: {
          user: {
            select: {
              walletAddress: true
            }
          }
        }
      });

      // Populate the payment routes map
      for (const payment of activePayments) {
        if (payment.user?.walletAddress) {
          this.paymentRoutes.set(payment.id, {
            userId: payment.userId,
            userWalletAddress: payment.user.walletAddress,
            amount: payment.amount,
            currency: payment.currency,
            network: payment.network,
            description: payment.description,
            transactionType: payment.transactionType,
            createdAt: payment.createdAt
          });
        }
      }

      console.log(`✅ [${this.instanceId}] Loaded ${activePayments.length} active payment routes from database`);
    } catch (error) {
      console.error('❌ Error loading active payment routes:', error);
    }
  }

  /**
   * Setup X402 payment routes
   */
  setupRoutes() {
    console.log('🔧 Setting up authentic X402 payment routes...');

    // Native SEI payment confirmation endpoint
    this.app.post('/x402pay/:paymentId/confirm-sei', async (req, res) => {
      const paymentId = req.params.paymentId;
      const { txHash, fromAddress } = req.body || {};

      if (!txHash || typeof txHash !== 'string') {
        return res.status(400).json({ error: 'txHash is required' });
      }

      try {
        const paymentConfig = this.paymentRoutes.get(paymentId);
        let paymentRequest = null;

        if (!paymentConfig) {
          paymentRequest = await this.prisma.paymentRequest.findUnique({
            where: { id: paymentId }
          });

          if (!paymentRequest) {
            return res.status(404).json({ error: 'Payment request not found' });
          }

          if (paymentRequest.status === 'payment_received') {
            return res.status(200).json({
              success: true,
              paymentId,
              message: 'Payment already confirmed'
            });
          }
        }

        const effectiveCurrency = (paymentConfig?.currency || paymentRequest?.currency || '').toUpperCase();
        if (effectiveCurrency !== 'SEI') {
          return res.status(400).json({ error: 'Only SEI native confirmations are allowed on this endpoint' });
        }

        const userId = paymentConfig?.userId || paymentRequest?.userId;
        const amount = paymentConfig?.amount ?? paymentRequest?.amount;

        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { walletAddress: true }
        });

        if (!user?.walletAddress) {
          return res.status(400).json({ error: 'Recipient wallet not found' });
        }

        const publicClient = createPublicClient({
          chain: seiTestnet,
          transport: http(),
        });

        const tx = await publicClient.getTransaction({ hash: txHash });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
          confirmations: 1,
          timeout: 120000,
        });

        if (receipt.status !== 'success') {
          return res.status(400).json({ error: 'Transaction failed on-chain' });
        }

        if (!tx.to || tx.to.toLowerCase() !== user.walletAddress.toLowerCase()) {
          return res.status(400).json({
            error: 'Transaction recipient mismatch',
            expected: user.walletAddress,
            actual: tx.to || null,
          });
        }

        if (fromAddress && tx.from.toLowerCase() !== String(fromAddress).toLowerCase()) {
          return res.status(400).json({
            error: 'Transaction sender mismatch',
            expected: fromAddress,
            actual: tx.from,
          });
        }

        const requiredWei = parseEther(String(amount));
        if (tx.value < requiredWei) {
          return res.status(400).json({
            error: 'Insufficient SEI sent',
            requiredWei: requiredWei.toString(),
            actualWei: tx.value.toString(),
          });
        }

        const paymentResult = await this.handlePaymentSuccess(paymentId, txHash);
        return res.status(200).send(this.generateSuccessPage({
          paymentId,
          amount: paymentResult.amount,
          currency: paymentResult.currency,
          description: paymentResult.description,
          walletAddress: paymentResult.toAddress,
        }));
      } catch (error) {
        console.error(`❌ [${this.instanceId}] Native SEI confirmation failed:`, error);
        return res.status(400).json({
          error: 'Native SEI verification failed',
          details: process.env.NODE_ENV === 'development' ? (error?.message || String(error)) : undefined,
        });
      }
    });
    
    // Handle X402 payment requests with proper middleware setup
    this.app.use('/x402pay/:paymentId', async (req, res, next) => {
      const paymentId = req.params.paymentId;
      console.log(`🔍 [${this.instanceId}] X402Pay route accessed: ${req.url} -> Payment ID: ${paymentId}`);
      console.log(`🔍 [${this.instanceId}] Available payment routes: [${Array.from(this.paymentRoutes.keys()).join(', ')}]`);
      
      if (!this.paymentRoutes.has(paymentId)) {
        console.log(`❌ Payment ID ${paymentId} not found in active routes`);
        return res.status(404).json({
          error: 'Payment link not found or expired',
          paymentId,
          message: 'This payment link may have expired or been completed. Please request a new payment link.'
        });
      }

      const paymentConfig = this.paymentRoutes.get(paymentId);

      // Native SEI flow does not use x402 middleware (which is USDC-based).
      if ((paymentConfig?.currency || '').toUpperCase() === 'SEI') {
        const user = await this.prisma.user.findUnique({
          where: { id: paymentConfig.userId },
          select: { walletAddress: true }
        });

        if (!user?.walletAddress) {
          return res.status(400).json({
            error: 'User wallet not found. Please create a Privy wallet first.'
          });
        }

        return res.status(402).send(this.generateSeiNativePayPage({
          paymentId,
          amount: paymentConfig.amount,
          description: paymentConfig.description,
          walletAddress: user.walletAddress,
        }));
      }
      
      // Get user's specific Privy wallet address
      const user = await this.prisma.user.findUnique({
        where: { id: paymentConfig.userId },
        select: { walletAddress: true }
      });

      if (!user?.walletAddress) {
        return res.status(400).json({ 
          error: 'User wallet not found. Please create a Privy wallet first.' 
        });
      }

      console.log(`💳 Processing X402Pay request for payment ID: ${paymentId}`);
      console.log(`💳 X402Pay processing payment to user wallet: ${user.walletAddress}`);
      
      // FIX: The key issue is path configuration for X402 middleware
      // When Express routes to /x402pay/:paymentId, the middleware sees the path as "/"
      // So we need to configure the middleware for the root path "/"
      const destinationWalletAddress = user.walletAddress;
      const paymentNetwork = this.resolveX402Network(paymentConfig.network);

      const middlewareConfig = {
        "/": {  // Use "/" instead of full path since Express strips the matched part
          price: `$${paymentConfig.amount}`,
          network: paymentNetwork,
          config: {
            description: paymentConfig.description,
            maxTimeoutSeconds: 300,
          }
        }
      };
      
      console.log(`🔧 X402Pay middleware configuration:`, JSON.stringify(middlewareConfig, null, 2));
      console.log(`🌐 [${this.instanceId}] Network requested: ${paymentConfig.network}`);
      console.log(`🌐 [${this.instanceId}] Network used for x402: ${paymentNetwork}`);
      console.log(`🌐 [${this.instanceId}] Facilitator config:`, JSON.stringify(this.facilitatorConfig, null, 2));
      console.log(`🔍 X402Pay request details:`, {
        method: req.method,
        path: req.path,
        originalUrl: req.originalUrl,
        hasXPaymentHeader: !!req.headers['x-payment'],
        xPaymentHeaderLength: req.headers['x-payment']?.length || 0,
        userAgent: req.headers['user-agent']?.substring(0, 50) + '...',
        allHeaders: Object.keys(req.headers).filter(h => h.startsWith('x-'))
      });
      
      if (req.headers['x-payment']) {
        console.log(`💳 [${this.instanceId}] X-PAYMENT header received:`, {
          headerStart: req.headers['x-payment'].substring(0, 100) + '...',
          headerLength: req.headers['x-payment'].length,
          headerType: typeof req.headers['x-payment']
        });
      }

      try {
        console.log(`🔧 [${this.instanceId}] Creating X402 middleware with config:`, {
          walletAddress: user.walletAddress,
          config: middlewareConfig,
          facilitator: this.facilitatorConfig
        });
        
        // Create X402 middleware with correct configuration
        const middleware = paymentMiddleware(
          destinationWalletAddress, // Always receive funds into the request owner's wallet
          middlewareConfig,
          this.facilitatorConfig,
        );
        
        console.log(`✅ [${this.instanceId}] X402 middleware created successfully`);
        
        // Apply X402 middleware with timeout and proper response handling
        let middlewareCompleted = false;
        
        // Set a timeout to ensure we always respond
        const timeoutId = setTimeout(() => {
          if (!middlewareCompleted && !res.headersSent) {
            console.warn(`⏰ [${this.instanceId}] X402 middleware timeout - forcing response`);
            middlewareCompleted = true;
            
            if (req.headers['x-payment']) {
              // If we have a payment header, assume payment was successful
              console.log(`✅ [${this.instanceId}] Timeout but payment header present - processing as successful`);
                             this.handlePaymentSuccess(paymentId, req.headers['x-payment'])
                 .then((paymentResult) => {
                   res.status(200).send(this.generateSuccessPage({
                     paymentId: paymentId,
                     amount: paymentResult.amount,
                     currency: paymentResult.currency,
                     description: paymentResult.description,
                     walletAddress: paymentResult.toAddress
                   }));
                 })
                .catch((err) => {
                  console.error(`❌ [${this.instanceId}] Payment processing failed:`, err);
                  res.status(400).json({
                    error: 'Payment verification failed',
                    details: err.message,
                    paymentId: paymentId
                  });
                });
            } else {
              res.status(500).json({ 
                error: 'X402 payment processing timeout',
                paymentId: paymentId
              });
            }
          }
        }, 5000); // 5 second timeout
        
        middleware(req, res, (err) => {
          if (middlewareCompleted) return; // Prevent double responses
          
          clearTimeout(timeoutId);
          middlewareCompleted = true;
          
          console.log(`🔄 [${this.instanceId}] X402 middleware callback triggered:`, {
            hasError: !!err,
            errorMessage: err?.message,
            hasXPaymentHeader: !!req.headers['x-payment'],
            responseHeadersSent: res.headersSent,
            responseStatusCode: res.statusCode,
            responseFinished: res.finished
          });
          
          if (err) {
            console.error(`❌ [${this.instanceId}] X402Pay middleware error:`, err);
            if (!res.headersSent) {
              return res.status(500).json({ 
                error: 'Payment processing failed', 
                details: err.message,
                paymentId: paymentId
              });
            }
            return;
          }
          
          // If payment was successful, X402 middleware should have sent 200 response
          if (req.headers['x-payment'] && res.headersSent && res.statusCode === 200) {
            console.log(`✅ [${this.instanceId}] X402 payment verified successfully`);
            // Process payment success in background (don't block response)
            setImmediate(() => {
              this.handlePaymentSuccess(paymentId, req.headers['x-payment'])
                .catch(err => console.error(`❌ Background payment processing failed:`, err));
            });
            return;
          }
          
          // If we get here and no response was sent, the middleware failed to handle the request
          if (!res.headersSent) {
            console.warn(`⚠️ [${this.instanceId}] X402 middleware didn't send response - handling manually`);
            
            if (req.headers['x-payment']) {
              // We have a payment signature - process it manually
              console.log(`💳 [${this.instanceId}] Processing payment manually since middleware failed`);
                             this.handlePaymentSuccess(paymentId, req.headers['x-payment'])
                .then((paymentResult) => {
                  res.status(200).send(this.generateSuccessPage({
                    paymentId: paymentId,
                    amount: paymentResult.amount,
                    currency: paymentResult.currency,
                    description: paymentResult.description,
                    walletAddress: paymentResult.toAddress
                  }));
                })
                .catch((verificationError) => {
                  console.error(`❌ [${this.instanceId}] Manual payment verification failed:`, verificationError);
                  res.status(400).json({
                    error: 'Payment verification failed',
                    details: verificationError.message,
                    paymentId: paymentId
                  });
                });
            } else {
              res.status(500).json({ 
                error: 'X402 payment processing incomplete',
                paymentId: paymentId,
                message: "Payment middleware did not handle the request."
              });
            }
          }
        });
      } catch (middlewareError) {
        console.error(`❌ [${this.instanceId}] X402Pay middleware creation error:`, middlewareError);
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Payment middleware initialization failed', 
            details: middlewareError.message,
            paymentId: paymentId
          });
        }
      }
    });



        
    // X402 middleware handles all payment verification and success cases
    console.log(`✅ [${this.instanceId}] Authentic X402 payment routes configured`);
 
  }

  /**
   * Create a unique payment request with X402 link
   */
  async createPaymentRequest({
    userId,
    amount,
    currency = 'SEI',
    network = 'sei-testnet',
    recipientEmail,
    recipientName,
    description,
    transactionType = 'ask_payment',
    scheduleType = 'immediate',
    scheduledDate = null,
    aiPrompt = null
  }) {
    try {
      const x402Network = this.resolveX402Network(network);
      console.log(`💳 [${this.instanceId}] Creating X402 payment request for user ${userId}`);
      console.log(`🌐 [${this.instanceId}] Requested network: ${network} -> X402 network: ${x402Network}`);
      console.log(`🔍 [${this.instanceId}] Current routes before creation: [${Array.from(this.paymentRoutes.keys()).join(', ')}]`);

      // Verify user has a Privy wallet
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { walletAddress: true, email: true }
      });

      if (!user?.walletAddress) {
        throw new Error('User must create a Privy wallet before requesting payments');
      }

      // Generate unique payment ID
      const paymentId = `x402_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create the payment URL
      const paymentUrl = `${process.env.BASE_URL || 'http://localhost:3001'}/x402pay/${paymentId}`;
      
      // Create payment request in database first
      const paymentRequest = await this.prisma.paymentRequest.create({
        data: {
          id: paymentId,
          userId,
          amount: parseFloat(amount),
          currency,
          // Keep the original requested network for auditability and app context.
          network,
          recipientEmail,
          recipientName,
          description,
          aiPrompt,
          transactionType,
          scheduleType,
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
          status: scheduleType === 'immediate' ? 'processing' : 'scheduled',
          x402PayLink: paymentUrl,
        }
      });

      // Store payment configuration in memory for X402 middleware
      console.log(`🔧 [${this.instanceId}] Adding payment route to memory: ${paymentId}`);
      
      const routeConfig = {
        userId,
        userWalletAddress: user.walletAddress,
        amount: parseFloat(amount),
        currency,
        network,
        x402Network,
        description,
        transactionType,
        createdAt: new Date()
      };
      
      this.paymentRoutes.set(paymentId, routeConfig);
      
      console.log(`✅ [${this.instanceId}] X402 payment request created: ${paymentId} → ${user.walletAddress}`);
      console.log(`🗺️ [${this.instanceId}] Payment route added to memory. Total routes: ${this.paymentRoutes.size}`);
      console.log(`🔍 [${this.instanceId}] Updated routes list: [${Array.from(this.paymentRoutes.keys()).join(', ')}]`);
      
      return {
        success: true,
        paymentId,
        paymentUrl,
        x402PayLink: paymentUrl,
        destinationWallet: user.walletAddress,
        request: paymentRequest
      };
    } catch (error) {
      console.error('❌ Error creating X402 payment request:', error);
      throw error;
    }
  }

  /**
   * Calculate payment options for multi-token request (disabled)
   */
  async calculatePaymentOptions(paymentId, userPreferredToken = 'SEI') {
    try {
      console.log(`🧮 [${this.instanceId}] Calculating payment options for ${paymentId}`);
      console.log(`⚠️ [${this.instanceId}] OKX DEX Service is disabled - returning direct payment option`);

      const routeConfig = this.paymentRoutes.get(paymentId);
      if (!routeConfig) {
        throw new Error('Payment route not found');
      }

      // Since OKX DEX is disabled, always return direct payment
      return {
        paymentId,
        userPreferredToken,
        receiveCurrency: routeConfig.currency,
        swapRequired: false,
        directPayment: true,
        paymentAmount: routeConfig.amount,
        paymentCurrency: routeConfig.currency,
        message: 'Direct payment (OKX DEX disabled)'
      };

    } catch (error) {
      console.error('❌ Error calculating payment options:', error);
      return {
        swapRequired: false,
        swapPossible: false,
        error: error.message
      };
    }
  }

  /**
   * Generate beautiful HTML success page
   */
  generateSuccessPage({ paymentId, amount, currency, description, walletAddress }) {
    const safeAmount = escapeHtml(amount);
    const safeCurrency = escapeHtml(currency);
    const safeDescription = escapeHtml(description || 'Payment request');
    const safePaymentId = escapeHtml(paymentId);
    const safeWalletAddress = escapeHtml(walletAddress || 'N/A');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Successful - AgenPay</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          
          .success-container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            text-align: center;
            max-width: 500px;
            width: 100%;
            animation: slideUp 0.6s ease-out;
          }
          
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          
          .success-icon {
            width: 80px;
            height: 80px;
            margin: 0 auto 30px;
            background: #4CAF50;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: bounce 0.8s ease-out 0.3s both;
          }
          
          @keyframes bounce {
            0%, 20%, 53%, 80%, 100% {
              transform: translate3d(0,0,0);
            }
            40%, 43% {
              transform: translate3d(0, -20px, 0);
            }
            70% {
              transform: translate3d(0, -10px, 0);
            }
            90% {
              transform: translate3d(0, -4px, 0);
            }
          }
          
          .checkmark {
            color: white;
            font-size: 40px;
            font-weight: bold;
          }
          
          h1 {
            color: #2c3e50;
            font-size: 32px;
            margin-bottom: 10px;
            font-weight: 600;
          }
          
          .amount {
            font-size: 48px;
            font-weight: 700;
            color: #4CAF50;
            margin: 20px 0;
          }
          
          .payment-details {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 25px;
            margin: 30px 0;
            text-align: left;
          }
          
          .detail-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid #e9ecef;
          }
          
          .detail-row:last-child {
            border-bottom: none;
          }
          
          .detail-label {
            color: #6c757d;
            font-weight: 500;
          }
          
          .detail-value {
            color: #2c3e50;
            font-weight: 600;
            word-break: break-all;
          }
          
          .wallet-address {
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 12px;
            background: #e9ecef;
            padding: 5px 8px;
            border-radius: 6px;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          
          .powered-by {
            margin-top: 30px;
            color: #6c757d;
            font-size: 14px;
          }
          
          .powered-by strong {
            color: #667eea;
          }
          
          .close-button {
            background: #667eea;
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 20px;
            transition: all 0.3s ease;
          }
          
          .close-button:hover {
            background: #5a6fd8;
            transform: translateY(-2px);
          }
        </style>
      </head>
      <body>
        <div class="success-container">
          <div class="success-icon">
            <div class="checkmark">✓</div>
          </div>
          
          <h1>Payment Successful!</h1>
          <p style="color: #6c757d; margin-bottom: 20px;">Your crypto payment has been verified and processed.</p>
          
          <div class="amount">${safeAmount} ${safeCurrency}</div>
          
          <div class="payment-details">
            <div class="detail-row">
              <span class="detail-label">Description</span>
              <span class="detail-value">${safeDescription}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Payment ID</span>
              <span class="detail-value">${safePaymentId}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Network</span>
              <span class="detail-value">Sei Testnet</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Recipient Wallet</span>
              <span class="detail-value">
                <div class="wallet-address">${safeWalletAddress}</div>
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Protocol</span>
              <span class="detail-value">X402Pay ⚡</span>
            </div>
          </div>
          
          <button class="close-button" onclick="window.close()">Close</button>
          
          <div class="powered-by">
            Powered by <strong>AgenPay × X402</strong><br>
            Secure crypto payments for the future
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate native Sei testnet payment page for SEI-denominated requests.
   */
  generateSeiNativePayPage({ paymentId, amount, description, walletAddress }) {
    const amountString = String(amount);
    const requiredWei = this.toWeiString(amountString);
    const safeAmount = escapeHtml(amountString);
    const safeDescription = escapeHtml(description || 'Payment request');
    const safeWalletAddress = escapeHtml(walletAddress || 'N/A');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>SEI Payment Required</title>
        <style>
          body {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f7fb;
            color: #111827;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
          }
          .card {
            width: 100%;
            max-width: 560px;
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.08);
            padding: 28px;
          }
          h1 {
            margin: 0 0 12px;
            font-size: 28px;
          }
          .muted { color: #6b7280; }
          .details {
            margin-top: 18px;
            padding: 14px;
            background: #f9fafb;
            border-radius: 12px;
          }
          .wallet-box {
            margin-top: 14px;
            padding: 12px;
            background: #f9fafb;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
          }
          .wallet-text {
            font-size: 14px;
            color: #374151;
            word-break: break-all;
          }
          .wallet-actions {
            display: flex;
            gap: 8px;
          }
          .small-btn {
            margin-top: 0;
            width: auto;
            padding: 8px 12px;
            font-size: 13px;
            border-radius: 8px;
          }
          .small-btn.secondary {
            background: #4b5563;
          }
          .row {
            display: flex;
            justify-content: space-between;
            margin: 10px 0;
            gap: 16px;
          }
          .label { color: #6b7280; }
          .value { font-weight: 600; word-break: break-all; }
          button {
            margin-top: 20px;
            width: 100%;
            border: 0;
            border-radius: 10px;
            padding: 14px;
            font-size: 16px;
            font-weight: 700;
            color: #fff;
            background: #2563eb;
            cursor: pointer;
          }
          button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          #status { margin-top: 12px; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Payment Required</h1>
          <p class="muted">Pay exactly ${safeAmount} SEI on Sei Testnet to unlock this resource.</p>

          <div class="details">
            <div class="row"><span class="label">Amount</span><span class="value">${safeAmount} SEI</span></div>
            <div class="row"><span class="label">Network</span><span class="value">Sei Testnet</span></div>
            <div class="row"><span class="label">Recipient</span><span class="value">${safeWalletAddress}</span></div>
            <div class="row"><span class="label">Description</span><span class="value">${safeDescription}</span></div>
          </div>

          <div class="wallet-box">
            <div id="walletInfo" class="wallet-text">Wallet: Not connected</div>
            <div class="wallet-actions">
              <button id="connectBtn" class="small-btn" type="button">Connect</button>
              <button id="disconnectBtn" class="small-btn secondary" type="button">Disconnect</button>
            </div>
          </div>

          <button id="payBtn">Pay ${safeAmount} SEI</button>
          <div id="status" class="muted"></div>
        </div>

        <script>
          const paymentId = ${JSON.stringify(paymentId)};
          const recipient = ${JSON.stringify(walletAddress)};
          const valueWei = ${JSON.stringify(requiredWei)};
          const chainIdHex = '0x530';

          const payBtn = document.getElementById('payBtn');
          const statusEl = document.getElementById('status');
          const connectBtn = document.getElementById('connectBtn');
          const disconnectBtn = document.getElementById('disconnectBtn');
          const walletInfo = document.getElementById('walletInfo');
          let connectedAddress = null;

          function setStatus(msg) {
            statusEl.textContent = msg;
          }

          function shortAddress(addr) {
            if (!addr || addr.length < 12) return addr || '';
            return addr.slice(0, 6) + '...' + addr.slice(-4);
          }

          function updateWalletUI() {
            if (connectedAddress) {
              walletInfo.textContent = 'Wallet: ' + shortAddress(connectedAddress);
              connectBtn.disabled = true;
              disconnectBtn.disabled = false;
              payBtn.disabled = false;
            } else {
              walletInfo.textContent = 'Wallet: Not connected';
              connectBtn.disabled = false;
              disconnectBtn.disabled = true;
              payBtn.disabled = false;
            }
          }

          function getProvider() {
            if (!window.ethereum) return null;
            if (Array.isArray(window.ethereum.providers) && window.ethereum.providers.length > 0) {
              const preferred = window.ethereum.providers.find((p) => p && (p.isMetaMask || p.isRabby));
              return preferred || window.ethereum.providers[0];
            }
            return window.ethereum;
          }

          function withTimeout(promise, timeoutMs, timeoutMessage) {
            let timeoutId;
            const timeoutPromise = new Promise((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
            });
            return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
          }

          async function ensureSeiTestnet(ethereum) {
            try {
              await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
            } catch (switchError) {
              if (switchError && switchError.code === 4902) {
                await ethereum.request({
                  method: 'wallet_addEthereumChain',
                  params: [{
                    chainId: chainIdHex,
                    chainName: 'Sei Testnet',
                    nativeCurrency: { name: 'SEI', symbol: 'SEI', decimals: 18 },
                    rpcUrls: ['https://evm-rpc-testnet.sei-apis.com'],
                    blockExplorerUrls: ['https://seitrace.com']
                  }]
                });
              } else {
                throw switchError;
              }
            }
          }

          async function connectWallet() {
            const provider = getProvider();
            if (!provider) {
              throw new Error('No wallet detected. Please install MetaMask or Rabby.');
            }

            let accounts = await withTimeout(
              provider.request({ method: 'eth_accounts' }),
              8000,
              'Wallet detection timed out. Reload the page and try again.'
            );

            if (!accounts || accounts.length === 0) {
              setStatus('Approve wallet connection in your wallet popup...');
              accounts = await withTimeout(
                provider.request({ method: 'eth_requestAccounts' }),
                30000,
                'Wallet connection timed out. Check for a blocked wallet popup.'
              );
            }

            connectedAddress = accounts && accounts[0] ? accounts[0] : null;
            if (!connectedAddress) {
              throw new Error('Wallet returned no account. Unlock wallet and retry.');
            }

            await withTimeout(
              ensureSeiTestnet(provider),
              30000,
              'Network switch timed out. Switch to Sei Testnet manually and retry.'
            );

            updateWalletUI();
          }

          async function disconnectWallet() {
            const provider = getProvider();
            connectedAddress = null;
            updateWalletUI();

            if (provider && provider.request) {
              try {
                await provider.request({
                  method: 'wallet_revokePermissions',
                  params: [{ eth_accounts: {} }],
                });
              } catch (_ignored) {
                // Not all wallets implement revoke permissions; local disconnect is still useful.
              }
            }

            setStatus('Wallet disconnected.');
          }

          connectBtn.addEventListener('click', async () => {
            try {
              setStatus('Connecting wallet...');
              await connectWallet();
              setStatus('Wallet connected. Ready to pay.');
            } catch (err) {
              if (err && err.code === 4001) {
                setStatus('Wallet connection request rejected.');
              } else {
                setStatus(err && err.message ? err.message : String(err));
              }
            }
          });

          disconnectBtn.addEventListener('click', () => {
            disconnectWallet();
          });

          payBtn.addEventListener('click', async () => {
            try {
              const provider = getProvider();
              if (!provider) {
                setStatus('No wallet detected. Please install MetaMask or Rabby.');
                return;
              }

              payBtn.disabled = true;
              if (!connectedAddress) {
                setStatus('Connecting wallet...');
                await connectWallet();
              }

              const from = connectedAddress;

              setStatus('Sending transaction...');
              const txHash = await withTimeout(provider.request({
                method: 'eth_sendTransaction',
                params: [{ from, to: recipient, value: '0x' + BigInt(valueWei).toString(16) }],
              }), 60000, 'Transaction request timed out. Retry after checking your wallet.');

              setStatus('Verifying payment on-chain...');
              const response = await fetch('/x402pay/' + paymentId + '/confirm-sei', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ txHash, fromAddress: from }),
              });

              const contentType = response.headers.get('content-type') || '';
              if (response.ok && contentType.includes('text/html')) {
                document.open();
                document.write(await response.text());
                document.close();
                return;
              }

              const payload = await response.json().catch(() => ({}));
              throw new Error(payload.error || payload.details || 'Payment verification failed');
            } catch (err) {
              if (err && err.code === 4001) {
                setStatus('Wallet request rejected. Please approve the connection/transaction to continue.');
              } else {
                setStatus('Payment failed: ' + (err && err.message ? err.message : String(err)));
              }
              updateWalletUI();
              payBtn.disabled = false;
            }
          });

          updateWalletUI();

          const initialProvider = getProvider();
          if (initialProvider && typeof initialProvider.on === 'function') {
            initialProvider.on('accountsChanged', (accounts) => {
              connectedAddress = accounts && accounts[0] ? accounts[0] : null;
              updateWalletUI();
            });
          }
        </script>
      </body>
      </html>
    `;
  }

  /**
   * Convert decimal SEI string to wei string without floating point precision loss.
   */
  toWeiString(amount) {
    const [wholeRaw, fracRaw = ''] = String(amount).trim().split('.');
    const whole = wholeRaw === '' ? '0' : wholeRaw;
    const frac = (fracRaw + '000000000000000000').slice(0, 18);
    const wholeWei = BigInt(whole || '0') * 1000000000000000000n;
    const fracWei = BigInt(frac || '0');
    return (wholeWei + fracWei).toString();
  }

  /**
   * Handle successful payment verification
   */
  async handlePaymentSuccess(paymentId, paymentProof) {
    try {
      console.log(`✅ [${this.instanceId}] Processing payment success for: ${paymentId}`);
      console.log(`🧾 [${this.instanceId}] Payment proof received:`, paymentProof ? 'Present' : 'Missing');

      // Get payment config to find destination wallet
      const paymentConfig = this.paymentRoutes.get(paymentId);
      let dbPaymentRequest = null;
      
      if (!paymentConfig) {
        // Try to get from database if not in memory
        dbPaymentRequest = await this.prisma.paymentRequest.findUnique({
          where: { id: paymentId }
        });
        
        if (!dbPaymentRequest) {
          throw new Error(`Payment configuration not found for ${paymentId}`);
        }
        
        console.log(`📋 [${this.instanceId}] Using payment config from database`);
      }

      // Get user wallet address
      const user = await this.prisma.user.findUnique({
        where: { id: paymentConfig?.userId || dbPaymentRequest?.userId },
        select: { walletAddress: true, email: true }
      });

      // Update payment request status
      const paymentRequest = await this.prisma.paymentRequest.update({
        where: { id: paymentId },
        data: {
          status: 'payment_received',
          paymentHash: paymentProof || 'X402_VERIFIED',
          paidAt: new Date()
        }
      });

      // Create transaction record with proper wallet tracking
      await this.prisma.transaction.create({
        data: {
          userId: paymentRequest.userId,
          type: 'INCOMING',
          status: 'COMPLETED',
          amount: paymentRequest.amount,
          currency: paymentRequest.currency,
          network: paymentRequest.network,
          description: paymentRequest.description,
          toAddress: user?.walletAddress, // User's Privy wallet that received payment
          fromAddress: 'X402Pay_Verified_Sender', // X402Pay verified sender
          x402PayId: paymentId,
          relatedRequestId: paymentId,
          txHash: paymentProof || `x402_${paymentId}`,
          completedAt: new Date()
        }
      });

      // Handle refund scheduling if needed
      if (paymentRequest.transactionType === 'ask_and_refund') {
        await this.scheduleRefund(paymentRequest);
      }

      // Update Notion database if user has integration
      await this.updateNotionRecord(paymentRequest);

      // Remove from active payment routes (payment completed)
      this.paymentRoutes.delete(paymentId);

      console.log(`✅ [${this.instanceId}] Payment success handled: ${paymentRequest.amount} ${paymentRequest.currency} → ${user?.walletAddress}`);
      return {
        ...paymentRequest,
        toAddress: user?.walletAddress
      };
    } catch (error) {
      console.error(`❌ [${this.instanceId}] Error handling payment success for ${paymentId}:`, error);
      throw error;
    }
  }

  /**
   * Schedule a refund for ask_and_refund transactions
   */
  async scheduleRefund(paymentRequest) {
    try {
      // Calculate refund date (default 30 days from payment)
      const refundDate = new Date();
      refundDate.setDate(refundDate.getDate() + 30);

      // Create outgoing payment record for the refund
      const refundPayment = await this.prisma.outgoingPayment.create({
        data: {
          userId: paymentRequest.userId,
          amount: paymentRequest.amount,
          currency: paymentRequest.currency,
          network: paymentRequest.network,
          recipientAddress: paymentRequest.recipientEmail, // Will need wallet address
          recipientName: paymentRequest.recipientName,
          fromName: 'AgenPay Refund System',
          description: `Refund for: ${paymentRequest.description}`,
          scheduleDate: refundDate,
          status: 'scheduled',
          relatedRequestId: paymentRequest.id
        }
      });

      // Update original request with refund date
      await this.prisma.paymentRequest.update({
        where: { id: paymentRequest.id },
        data: { refundDate: refundDate }
      });

      console.log(`📅 Refund scheduled for ${paymentRequest.id} on ${refundDate}`);
      return refundPayment;
    } catch (error) {
      console.error(`❌ Error scheduling refund for ${paymentRequest.id}:`, error);
      throw error;
    }
  }

  /**
   * Update Notion database with payment information
   */
  async updateNotionRecord(paymentRequest) {
    try {
      // Get user's Notion databases
      const user = await this.prisma.user.findUnique({
        where: { id: paymentRequest.userId },
        include: {
          notionDatabases: {
            where: { databaseType: 'INCOMING_PAYMENTS' }
          }
        }
      });

      if (user?.notionApiKey && user.notionDatabases.length > 0) {
        const NotionService = await import('./NotionService.js');
        const notionService = new NotionService.NotionService(user.notionApiKey);
        
        const databaseId = user.notionDatabases[0].databaseId;
        
        // Update existing record or create new one if not found
        await notionService.updateOrCreateIncomingPaymentRecord(databaseId, {
          requestId: paymentRequest.id,
          amount: paymentRequest.amount,
          currency: paymentRequest.currency,
          network: paymentRequest.network,
          recipientEmail: paymentRequest.recipientEmail,
          recipientName: paymentRequest.recipientName,
          description: paymentRequest.description,
          transactionType: paymentRequest.transactionType,
          status: 'payment_received', // Update status to received
          x402PayLink: paymentRequest.x402PayLink,
          paymentHash: paymentRequest.paymentHash || `x402_${paymentRequest.id}`
        });

        console.log(`📝 Notion record updated for payment: ${paymentRequest.id}`);
      }
    } catch (error) {
      console.error(`❌ Error updating Notion record for ${paymentRequest.id}:`, error);
      // Don't throw error - Notion update failure shouldn't break payment flow
    }
  }

  /**
   * Start the X402 payment server
   */
  async startServer(port = 3002) {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(`🚀 X402Pay service running on port ${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the X402 payment server
   */
  async stopServer() {
    if (this.server) {
      this.server.close();
      console.log('🛑 X402Pay service stopped');
    }
  }

  async cleanup() {
    await this.stopServer();
    await this.prisma.$disconnect();
  }
}

export default X402PayService; 