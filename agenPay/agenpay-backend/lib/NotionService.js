/**
 * Notion Service for SkyPay
 * Handles workspace setup, database creation, and OAuth management
 */

import { Client } from '@notionhq/client';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { buildTop, buildRecent } from './notionDashboard.js';

export class NotionService {
  constructor(notionApiKey = null) {
    this.notion = notionApiKey ? new Client({ auth: notionApiKey, fetch: globalThis.fetch }) : null;
    this.prisma = new PrismaClient();
  }

  /**
   * Generate Notion OAuth URL
   */
  static generateOAuthUrl(userId) {
    const clientId = process.env.NOTION_CLIENT_ID;
    
    if (!clientId) {
      throw new Error('Notion OAuth not configured - missing NOTION_CLIENT_ID');
    }

    const redirectUri = process.env.NOTION_REDIRECT_URI || 'http://localhost:3001/api/notion/callback';
    // Signed state: prevents an attacker from forging state=<victim-userId> on the
    // public callback and having the server link their Notion token — and mint a
    // session JWT — for an arbitrary account.
    const state = jwt.sign({ userId, purpose: 'notion_oauth' }, process.env.JWT_SECRET, { expiresIn: '15m' });
    
    const authUrl = `https://api.notion.com/v1/oauth/authorize?` +
      `client_id=${clientId}&` +
      `response_type=code&` +
      `owner=user&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${state}`;

    return authUrl;
  }

  /**
   * Handle OAuth callback and exchange code for token
   */
  static async handleOAuthCallback(code, state) {
    try {
      // Verify the signed state before trusting the userId inside it.
      let statePayload;
      try {
        statePayload = jwt.verify(state, process.env.JWT_SECRET);
      } catch {
        throw new Error('Invalid or expired OAuth state');
      }
      if (statePayload.purpose !== 'notion_oauth' || !statePayload.userId) {
        throw new Error('Invalid OAuth state');
      }

      const clientId = process.env.NOTION_CLIENT_ID;
      const clientSecret = process.env.NOTION_CLIENT_SECRET;
      const redirectUri = process.env.NOTION_REDIRECT_URI || 'http://localhost:3001/api/notion/callback';

      if (!clientId || !clientSecret) {
        throw new Error('Missing Notion OAuth credentials');
      }

      // Exchange code for access token
      const tokenResponse = await fetch('https://api.notion.com/v1/oauth/token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        })
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${errorData}`);
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;

      if (!accessToken) {
        throw new Error('No access token received from Notion');
      }

      return {
        success: true,
        accessToken,
        userId: statePayload.userId
      };
    } catch (error) {
      console.error('❌ OAuth callback error:', error);
      throw error;
    }
  }

  /**
   * Complete user integration with OAuth token
   */
  async completeIntegration(userId, accessToken) {
    try {
      // Initialize client with new token
      this.notion = new Client({ auth: accessToken, fetch: globalThis.fetch });

      // Test connection
      const connectionTest = await this.testConnection();
      if (!connectionTest.success) {
        throw new Error('Invalid access token');
      }

      // Setup workspace
      const workspaceSetup = await this.setupUserWorkspace(userId, accessToken);
      
      // Update user in database
      await this.prisma.user.update({
        where: { id: userId },
        data: { 
          notionApiKey: accessToken,
          notionWorkspaceId: workspaceSetup.workspacePageId,
        }
      });

      console.log(`✅ Notion integration completed for user ${userId}`);

      return {
        success: true,
        message: 'Notion workspace setup completed successfully',
        workspacePageId: workspaceSetup.workspacePageId,
        databases: workspaceSetup.databases,
        user: connectionTest.user
      };
    } catch (error) {
      console.error(`❌ Error completing integration for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Setup user workspace with required databases (Updated Structure)
   */
  async setupUserWorkspace(userId, notionApiKey) {
    try {
      console.log(`🗃️ Setting up SkyPay workspace for user ${userId}`);
      
      // Page order is creation order: header + key figures, then the three databases, then recent activity.
      const workspacePage = await this.createWorkspacePage();
      const isTest = process.env.NEAR_USDC_IS_TEST_TOKEN === 'true';
      const network = (process.env.NEAR_NETWORK || 'testnet');
      await buildTop(this.notion, this.prisma, userId, workspacePage.id, { network, isTest });

      // Full-page databases as direct children: each entry under "Records" opens straight to its table (no page-inside-page).
      const incomingPaymentsDb = await this.createIncomingPaymentsDatabase(workspacePage.id);
      const outgoingPaymentsDb = await this.createOutgoingPaymentsDatabase(workspacePage.id);
      const transactionsDb = await this.createTransactionsDatabase(workspacePage.id);

      await buildRecent(this.notion, this.prisma, userId, [incomingPaymentsDb.id, outgoingPaymentsDb.id, transactionsDb.id]);

      // Store databases in our system (serialize properties to string for SQLite compatibility)
      const databases = [
        {
          userId,
          databaseId: incomingPaymentsDb.id,
          databaseName: 'SkyPay Incoming Payments',
          databaseType: 'INCOMING_PAYMENTS',
          properties: JSON.stringify(incomingPaymentsDb.properties),
        },
        {
          userId,
          databaseId: outgoingPaymentsDb.id,
          databaseName: 'SkyPay Outgoing Payments',
          databaseType: 'OUTGOING_PAYMENTS',
          properties: JSON.stringify(outgoingPaymentsDb.properties),
        },
        {
          userId,
          databaseId: transactionsDb.id,
          databaseName: 'SkyPay Transactions',
          databaseType: 'TRANSACTIONS',
          properties: JSON.stringify(transactionsDb.properties),
        },
      ];
      
      // A rebuilt workspace replaces the old one: only the new databases stay active
      await this.prisma.notionDatabase.updateMany({ where: { userId }, data: { isActive: false } });
      // Save to database (upsert to avoid duplicates)
      for (const db of databases) {
        await this.prisma.notionDatabase.upsert({
          where: { databaseId: db.databaseId },
          update: { ...db, isActive: true },
          create: db,
        });
      }
      
      console.log(`✅ SkyPay workspace setup completed for user ${userId}`);
      
      return {
        success: true,
        workspacePageId: workspacePage.id,
        databases: {
          incomingPayments: incomingPaymentsDb,
          outgoingPayments: outgoingPaymentsDb,
          transactions: transactionsDb,
        },
      };
    } catch (error) {
      console.error(`❌ Error setting up workspace for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Create main workspace page
   */
  async createWorkspacePage() {
    try {
      // Try to create at workspace root first
      let workspacePage;
      try {
        // Parent = a page the user shared with the integration. Never a database row, an archived page, or
        // anything we created ourselves (a rebuild would otherwise nest inside the workspace it replaces).
        const pages = await this.notion.search({
          filter: { property: 'object', value: 'page' },
          page_size: 50,
        });
        const ours = /^(skypay|agenpay)( workspace)?$/i;
        const titleOf = (p) => Object.values(p.properties || {}).find((x) => x.type === 'title')?.title?.[0]?.plain_text || '';
        const candidates = pages.results.filter((p) => !p.archived && !p.in_trash && p.parent?.type !== 'database_id' && !ours.test(titleOf(p).trim()));
        const parentPage = candidates.find((p) => p.parent?.type === 'workspace') || candidates.find((p) => p.parent?.type === 'page_id');
        if (!parentPage) {
          throw new Error('No accessible page found. In Notion, share at least one top-level page with the SkyPay integration.');
        }
        // The dashboard goes straight onto the shared page (no "SkyPay" child page to click through).
        // Rebuilds only remove blocks SkyPay added (tracked in notionDashboard), never the page itself.
        console.log(`📍 Building SkyPay dashboard on: "${titleOf(parentPage) || 'Untitled'}" (${parentPage.id})`);
        workspacePage = parentPage;
      } catch (error) {
        console.error('⚠️ Could not create in page, trying workspace root:', error.message);
        // Fallback: try workspace root (this might fail if integration doesn't have workspace permission)
        throw error;
      }

      console.log('✅ SkyPay workspace page created:', workspacePage.id);
      return workspacePage;
    } catch (error) {
      console.error('❌ Error creating workspace page:', error);
      throw error;
    }
  }

  /**
   * Create Incoming Payment Requests Database
   */
  async createIncomingPaymentsDatabase(parentPageId) {
    const database = await this.notion.databases.create({
      parent: {
        type: 'page_id',
        page_id: parentPageId,
      },
      is_inline: false, // sub-page under "Records", not a table dumped on the dashboard
      title: [
        {
          type: 'text',
          text: {
            content: 'Invoices',
          },
        },
      ],
      properties: {
        'Request ID': {
          title: {},
        },
        'Amount': {
          number: {
            format: 'number',
          },
        },
        'Currency': {
          select: {
            options: [
              { name: 'USDC', color: 'green' },
              { name: 'USD', color: 'gray' },
            ],
          },
        },
        'Network': {
          select: {
            options: [
              { name: 'near-testnet', color: 'blue' },
              { name: 'near-mainnet', color: 'green' },
            ],
          },
        },
        'Recipient Email': {
          email: {},
        },
        'Recipient Name': {
          rich_text: {},
        },
        'Description': {
          rich_text: {},
        },
        'AI Prompt': {
          rich_text: {},
        },
        'Transaction Type': {
          select: {
            options: [
              { name: 'ask_payment', color: 'blue' },
              { name: 'ask_and_refund', color: 'orange' },
              { name: 'subscription', color: 'purple' },
            ],
          },
        },
        'Schedule Type': {
          select: {
            options: [
              { name: 'immediate', color: 'red' },
              { name: 'scheduled', color: 'yellow' },
            ],
          },
        },
        'Scheduled Date': {
          date: {},
        },
        'Status': {
          select: {
            options: [
              { name: 'draft', color: 'gray' },
              { name: 'scheduled', color: 'yellow' },
              { name: 'processing', color: 'orange' },
              { name: 'payment_received', color: 'green' },
              { name: 'refunded', color: 'purple' },
              { name: 'failed', color: 'red' },
            ],
          },
        },
        'X402Pay Link': {
          url: {},
        },
        'Payment Hash': {
          rich_text: {},
        },
        'Refund Date': {
          date: {},
        },
        'Created': {
          created_time: {},
        },
      },
    });

    console.log('✅ Incoming Payments database created:', database.id);
    return database;
  }

  /**
   * Create Outgoing Scheduled Payments Database  
   */
  async createOutgoingPaymentsDatabase(parentPageId) {
    const database = await this.notion.databases.create({
      parent: {
        type: 'page_id',
        page_id: parentPageId,
      },
      is_inline: false,
      title: [
        {
          type: 'text',
          text: {
            content: 'Supplier payments',
          },
        },
      ],
      properties: {
        'Payment ID': {
          title: {},
        },
        'Amount': {
          number: {
            format: 'number',
          },
        },
        'Currency': {
          select: {
            options: [
              { name: 'USDC', color: 'green' },
              { name: 'USD', color: 'gray' },
            ],
          },
        },
        'Network': {
          select: {
            options: [
              { name: 'near-testnet', color: 'blue' },
              { name: 'near-mainnet', color: 'green' },
            ],
          },
        },
        'Recipient Address': {
          rich_text: {},
        },
        'Recipient Name': {
          rich_text: {},
        },
        'From Name': {
          rich_text: {},
        },
        'Description': {
          rich_text: {},
        },
        'Schedule Date': {
          date: {},
        },
        'Status': {
          select: {
            options: [
              { name: 'scheduled', color: 'yellow' },
              { name: 'processing', color: 'orange' },
              { name: 'completed', color: 'green' },
              { name: 'failed', color: 'red' },
              { name: 'cancelled', color: 'gray' },
            ],
          },
        },
        'Transaction Hash': {
          rich_text: {},
        },
        'Executed At': {
          date: {},
        },
        'Created': {
          created_time: {},
        },
      },
    });

    console.log('✅ Outgoing Payments database created:', database.id);
    return database;
  }

  /**
   * Create Transactions Database (Updated)
   */
  async createTransactionsDatabase(parentPageId) {
    const database = await this.notion.databases.create({
      parent: {
        type: 'page_id',
        page_id: parentPageId,
      },
      is_inline: false,
      title: [
        {
          type: 'text',
          text: {
            content: 'Ledger',
          },
        },
      ],
      properties: {
        'Transaction ID': {
          title: {},
        },
        'Type': {
          select: {
            options: [
              { name: 'INCOMING', color: 'green' },
              { name: 'OUTGOING', color: 'red' },
              { name: 'REFUND', color: 'purple' },
            ],
          },
        },
        'Amount': {
          number: {
            format: 'number',
          },
        },
        'Currency': {
          select: {
            options: [
              { name: 'USDC', color: 'green' },
              { name: 'USD', color: 'gray' },
            ],
          },
        },
        'Network': {
          select: {
            options: [
              { name: 'near-testnet', color: 'blue' },
              { name: 'near-mainnet', color: 'green' },
            ],
          },
        },
        'From': {
          rich_text: {},
        },
        'To': {
          rich_text: {},
        },
        'Status': {
          select: {
            options: [
              { name: 'PENDING', color: 'yellow' },
              { name: 'PROCESSING', color: 'orange' },
              { name: 'COMPLETED', color: 'green' },
              { name: 'FAILED', color: 'red' },
            ],
          },
        },
        'Transaction Hash': {
          rich_text: {},
        },
        'X402Pay ID': {
          rich_text: {},
        },
        'Description': {
          rich_text: {},
        },
        'Related Request ID': {
          rich_text: {},
        },
        'Created': {
          created_time: {},
        },
      },
    });

    console.log('✅ Transactions database created:', database.id);
    return database;
  }

  /**
   * Get payment analytics from Notion databases and update dashboard
   */
  async getPaymentAnalytics(userId) {
    try {
      const databases = await this.prisma.notionDatabase.findMany({
        where: { userId, isActive: true },
      });

      const analytics = {
        totalIncomingRequests: 0,
        totalOutgoingPayments: 0,
        totalAmountRequested: 0,
        totalAmountSent: 0,
        totalTransactions: 0,
        activeRequests: 0,
        scheduledPayments: 0,
        recentActivity: [],
      };

      for (const db of databases) {
        const response = await this.notion.databases.query({
          database_id: db.databaseId,
          sorts: [
            {
              property: 'Created',
              direction: 'descending',
            },
          ],
          page_size: 20,
        });

        for (const page of response.results) {
          const amount = page.properties.Amount?.number || 0;
          const status = page.properties.Status?.select?.name?.toLowerCase();

          if (db.databaseType === 'INCOMING_PAYMENTS') {
            analytics.totalIncomingRequests++;
            if (status === 'payment_received') {
              analytics.totalAmountRequested += amount;
            }
            if (status === 'processing' || status === 'scheduled') {
              analytics.activeRequests++;
            }
          } else if (db.databaseType === 'OUTGOING_PAYMENTS') {
            analytics.totalOutgoingPayments++;
            if (status === 'completed') {
              analytics.totalAmountSent += amount;
            }
            if (status === 'scheduled') {
              analytics.scheduledPayments++;
            }
          } else if (db.databaseType === 'TRANSACTIONS') {
            analytics.totalTransactions++;
          }

          // Add to recent activity (top 5)
          if (analytics.recentActivity.length < 5) {
            analytics.recentActivity.push({
              id: page.id,
              type: db.databaseType,
              amount,
              currency: page.properties.Currency?.select?.name || 'USDC',
              status,
              description: this.getPropertyText(page.properties.Description) || this.getPropertyText(page.properties['Request ID']) || 'Unknown',
              created: page.properties.Created?.created_time,
              databaseType: db.databaseType,
            });
          }
        }
      }

      console.log(`✅ Analytics calculated for user ${userId}:`, {
        totalIncomingRequests: analytics.totalIncomingRequests,
        totalOutgoingPayments: analytics.totalOutgoingPayments,
        totalAmountRequested: analytics.totalAmountRequested,
        totalAmountSent: analytics.totalAmountSent,
        activeRequests: analytics.activeRequests,
        scheduledPayments: analytics.scheduledPayments,
      });

      return analytics;
    } catch (error) {
      console.error(`❌ Error getting analytics for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Test Notion connection
   */
  async testConnection() {
    try {
      const response = await this.notion.users.me();
      console.log('✅ Notion connection successful:', response.name);
      return { success: true, user: response };
    } catch (error) {
      console.error('❌ Notion connection failed:', error);
      throw error;
    }
  }

  async cleanup() {
    await this.prisma.$disconnect();
  }

  /**
   * Find existing payment record by Request ID
   */
  async findPaymentRecordByRequestId(databaseId, requestId) {
    try {
      console.log(`🔍 Searching for existing Notion record with Request ID: ${requestId}`);
      
      const response = await this.notion.databases.query({
        database_id: databaseId,
        filter: {
          property: 'Request ID',
          title: {
            contains: requestId
          }
        }
      });

      console.log(`🔍 Notion search results: ${response.results?.length || 0} records found`);
      
      if (response.results && response.results.length > 0) {
        const foundRecord = response.results[0];
        console.log(`✅ Found existing Notion record: ${foundRecord.id}`);
        return foundRecord; // Return the first matching record
      }
      
      console.log(`❌ No existing Notion record found for Request ID: ${requestId}`);
      return null; // No existing record found
    } catch (error) {
      console.error('❌ Error finding payment record by Request ID:', error);
      return null;
    }
  }

  /**
   * Update existing incoming payment record or create new one if not found
   */
  async updateOrCreateIncomingPaymentRecord(databaseId, paymentData) {
    try {
      console.log(`🔄 updateOrCreateIncomingPaymentRecord called for Request ID: ${paymentData.requestId}`);
      console.log(`🗃️ Using database ID: ${databaseId}`);
      
      // First try to find existing record
      const existingRecord = await this.findPaymentRecordByRequestId(databaseId, paymentData.requestId);
      
      if (existingRecord) {
        // Update existing record
        console.log(`🔄 Updating existing Notion record: ${existingRecord.id}`);
        
        const updateData = {
          'Status': {
            select: {
              name: paymentData.status || 'processing',
            },
          },
        };

        // Add payment hash if provided
        if (paymentData.paymentHash) {
          updateData['Payment Hash'] = {
            rich_text: [
              {
                text: {
                  content: paymentData.paymentHash,
                },
              },
            ],
          };
        }

        const updatedPage = await this.notion.pages.update({
          page_id: existingRecord.id,
          properties: updateData,
        });

        console.log('✅ Existing payment record updated in Notion:', existingRecord.id);
        return updatedPage;
      } else {
        // Create new record if none exists
        console.log(`➕ Creating new Notion record for: ${paymentData.requestId}`);
        return await this.addIncomingPaymentRecord(databaseId, paymentData);
      }
    } catch (error) {
      console.error('❌ Error updating or creating payment record in Notion:', error);
      throw error;
    }
  }

  /**
   * Add incoming payment record to Notion database
   */
  async addIncomingPaymentRecord(databaseId, paymentData) {
    try {
      const page = await this.notion.pages.create({
        parent: {
          database_id: databaseId,
        },
        properties: {
          'Request ID': {
            title: [
              {
                text: {
                  content: paymentData.requestId || `REQ-${Date.now()}`,
                },
              },
            ],
          },
          'Amount': {
            number: parseFloat(paymentData.amount) || 0,
          },
          'Currency': {
            select: {
              name: paymentData.currency || 'USDC',
            },
          },
          'Network': {
            select: {
              name: paymentData.network || 'near-testnet',  
            },
          },
          'Recipient Email': {
            email: paymentData.recipientEmail || null,
          },
          'Recipient Name': {
            rich_text: [
              {
                text: {
                  content: paymentData.recipientName || '',
                },
              },
            ],
          },
          'Description': {
            rich_text: [
              {
                text: {
                  content: paymentData.description || '',
                },
              },
            ],
          },
          'AI Prompt': {
            rich_text: [
              {
                text: {
                  content: paymentData.aiPrompt || '',
                },
              },
            ],
          },
          'Transaction Type': {
            select: {
              name: paymentData.transactionType || 'ask_payment',
            },
          },
          'Schedule Type': {
            select: {
              name: paymentData.scheduleType || 'immediate',
            },
          },
          'Scheduled Date': {
            date: paymentData.scheduledDate ? { start: paymentData.scheduledDate } : null,
          },
          'Status': {
            select: {
              name: paymentData.status || 'draft',
            },
          },
          'X402Pay Link': {
            url: paymentData.x402PayLink || null,
          },
          'Payment Hash': {
            rich_text: [
              {
                text: {
                  content: paymentData.paymentHash || '',
                },
              },
            ],
          },
          'Refund Date': {
            date: paymentData.refundDate ? { start: paymentData.refundDate } : null,
          },
        },
      });

      console.log('✅ Incoming payment record added to Notion:', page.id);
      return page;
    } catch (error) {
      console.error('❌ Error adding incoming payment record to Notion:', error);
      throw error;
    }
  }

  /**
   * Add outgoing payment record to Notion database
   */
  async addOutgoingPaymentRecord(databaseId, paymentData) {
    try {
      const page = await this.notion.pages.create({
        parent: {
          database_id: databaseId,
        },
        properties: {
          'Payment ID': {
            title: [
              {
                text: {
                  content: paymentData.paymentId || `OUT-${Date.now()}`,
                },
              },
            ],
          },
          'Amount': {
            number: parseFloat(paymentData.amount) || 0,
          },
          'Currency': {
            select: {
              name: paymentData.currency || 'USDC',
            },
          },
          'Network': {
            select: {
              name: paymentData.network || 'near-testnet',  
            },
          },
          'Recipient Address': {
            rich_text: [
              {
                text: {
                  content: paymentData.recipientAddress || '',
                },
              },
            ],
          },
          'Recipient Name': {
            rich_text: [
              {
                text: {
                  content: paymentData.recipientName || '',
                },
              },
            ],
          },
          'From Name': {
            rich_text: [
              {
                text: {
                  content: paymentData.fromName || 'SkyPay User',
                },
              },
            ],
          },
          'Description': {
            rich_text: [
              {
                text: {
                  content: paymentData.description || '',
                },
              },
            ],
          },
          'Schedule Date': {
            date: paymentData.scheduleDate ? { start: paymentData.scheduleDate } : null,
          },
          'Status': {
            select: {
              name: paymentData.status || 'scheduled',
            },
          },
          'Transaction Hash': {
            rich_text: [
              {
                text: {
                  content: paymentData.txHash || '',
                },
              },
            ],
          },
          'Executed At': {
            date: paymentData.executedAt ? { start: paymentData.executedAt } : null,
          },
        },
      });

      console.log('✅ Outgoing payment record added to Notion:', page.id);
      return page;
    } catch (error) {
      console.error('❌ Error adding outgoing payment record to Notion:', error);
      throw error;
    }
  }

  /**
   * "Payouts" sub-page of the SkyPay workspace page, holding the Employees & payees and Payout runs tables.
   * Created lazily so workspaces built before this feature get it without a rebuild. Ids live in NotionDatabase rows.
   */
  async ensurePayoutsPage(userId, workspacePageId) {
    const row = await this.prisma.notionDatabase.findFirst({ where: { userId, databaseType: 'PAYOUTS_PAGE', isActive: true } });
    if (row) return row.databaseId;
    const page = await this.notion.pages.create({
      parent: { type: 'page_id', page_id: workspacePageId },
      icon: { type: 'emoji', emoji: '💸' },
      properties: { title: { title: [{ text: { content: 'Payouts' } }] } },
      children: [{
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: 'Employees and suppliers you pay, and every payout run. Kept in sync by SkyPay; the vault on NEAR is the record of truth.' }, annotations: { color: 'gray' } }] },
      }],
    });
    await this.prisma.notionDatabase.create({ data: { userId, databaseId: page.id, databaseName: 'SkyPay Payouts page', databaseType: 'PAYOUTS_PAGE' } });
    return page.id;
  }

  async ensureDb(userId, workspacePageId, type, title, properties) {
    const existing = await this.prisma.notionDatabase.findFirst({ where: { userId, databaseType: type, isActive: true } });
    if (existing) return existing.databaseId;
    const parent = await this.ensurePayoutsPage(userId, workspacePageId);
    const db = await this.notion.databases.create({
      parent: { type: 'page_id', page_id: parent }, is_inline: true, title: [{ type: 'text', text: { content: title } }], properties,
    });
    await this.prisma.notionDatabase.create({ data: { userId, databaseId: db.id, databaseName: `SkyPay ${title}`, databaseType: type, properties: JSON.stringify(db.properties) } });
    return db.id;
  }

  ensurePayeesDatabase(userId, workspacePageId) {
    const rt = { rich_text: {} };
    return this.ensureDb(userId, workspacePageId, 'PAYEES', 'Employees & payees', {
      Name: { title: {} }, 'NEAR Account': rt, Email: { email: {} }, Notes: rt,
      'Total paid': { number: { format: 'number' } }, Payouts: { number: { format: 'number' } }, 'Last paid': { date: {} },
    });
  }

  ensureRunsDatabase(userId, workspacePageId) {
    const rt = { rich_text: {} };
    return this.ensureDb(userId, workspacePageId, 'PAYOUT_RUNS', 'Payout runs', {
      Run: { title: {} }, Date: { date: {} }, Payments: { number: { format: 'number' } }, Settled: { number: { format: 'number' } },
      'Total (USDC)': { number: { format: 'number' } },
      Status: { select: { options: [{ name: 'done', color: 'green' }, { name: 'partial', color: 'yellow' }, { name: 'failed', color: 'red' }, { name: 'queued', color: 'gray' }] } },
      Source: rt, 'Run ID': rt,
    });
  }

  /** One row per payout run (batch), keyed by Run ID. */
  async upsertRunRecord(userId, workspacePageId, r) {
    const databaseId = await this.ensureRunsDatabase(userId, workspacePageId);
    const text = (c) => ({ rich_text: [{ text: { content: String(c || '').slice(0, 1900) } }] });
    const properties = {
      Run: { title: [{ text: { content: r.label } }] }, Date: { date: { start: r.date } }, Payments: { number: r.payments },
      Settled: { number: r.settled }, 'Total (USDC)': { number: r.total }, Status: { select: { name: r.status } },
      Source: text(r.source), 'Run ID': text(r.id),
    };
    const found = await this.notion.databases.query({ database_id: databaseId, filter: { property: 'Run ID', rich_text: { equals: r.id } } });
    if (found.results[0]) return this.notion.pages.update({ page_id: found.results[0].id, properties });
    return this.notion.pages.create({ parent: { database_id: databaseId }, properties });
  }

  /** Add the Payee / Batch columns to a Supplier payments database made before batch payouts existed. Idempotent. */
  async ensurePayoutColumns(databaseId) {
    await this.notion.databases.update({ database_id: databaseId, properties: { Payee: { rich_text: {} }, Batch: { rich_text: {} } } })
      .catch((e) => console.error('payout columns:', e.message));
  }

  /** p: payee row plus { totalPaid (number), payouts (count), lastPaid (ISO|null) } */
  async upsertPayeeRecord(userId, parentPageId, p) {
    const databaseId = await this.ensurePayeesDatabase(userId, parentPageId);
    const text = (c) => ({ rich_text: [{ text: { content: String(c || '').slice(0, 1900) } }] });
    const properties = {
      Name: { title: [{ text: { content: p.name } }] }, 'NEAR Account': text(p.nearAccount),
      Email: { email: p.email || null }, Notes: text(p.notes),
      'Total paid': { number: p.totalPaid ?? 0 }, Payouts: { number: p.payouts ?? 0 }, 'Last paid': { date: p.lastPaid ? { start: p.lastPaid } : null },
    };
    const found = await this.notion.databases.query({ database_id: databaseId, filter: { property: 'NEAR Account', rich_text: { equals: p.nearAccount } } });
    if (found.results[0]) return this.notion.pages.update({ page_id: found.results[0].id, properties });
    return this.notion.pages.create({ parent: { database_id: databaseId }, properties });
  }

  /** Trash the Notion row for a removed payee. False when there is no Payees table or no row. */
  async archivePayeeRecord(userId, nearAccount) {
    const db = await this.prisma.notionDatabase.findFirst({ where: { userId, databaseType: 'PAYEES', isActive: true } });
    if (!db) return false;
    const found = await this.notion.databases.query({ database_id: db.databaseId, filter: { property: 'NEAR Account', rich_text: { equals: nearAccount } } });
    for (const page of found.results) await this.notion.pages.update({ page_id: page.id, archived: true });
    return found.results.length > 0;
  }

  /** Create or update the Supplier payments row for one vault payment (keyed by Payment ID). */
  async upsertOutgoingPaymentRecord(databaseId, d) {
    const found = await this.notion.databases.query({ database_id: databaseId, filter: { property: 'Payment ID', title: { equals: d.paymentId } } });
    const text = (c) => ({ rich_text: [{ text: { content: String(c || '').slice(0, 1900) } }] });
    if (found.results[0]) {
      return this.notion.pages.update({
        page_id: found.results[0].id,
        properties: { Status: { select: { name: d.status } }, 'Transaction Hash': text(d.txHash), Description: text(d.description) },
      });
    }
    return this.notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        'Payment ID': { title: [{ text: { content: d.paymentId } }] }, Amount: { number: parseFloat(d.amount) || 0 },
        Currency: { select: { name: 'USDC' } }, Network: { select: { name: d.network } },
        'Recipient Address': text(d.recipientAddress), 'Recipient Name': text(d.recipientName), 'From Name': text(d.fromName),
        Description: text(d.description), Status: { select: { name: d.status } }, 'Transaction Hash': text(d.txHash),
        'Executed At': { date: d.executedAt ? { start: d.executedAt } : null }, Payee: text(d.recipientName), Batch: text(d.batch),
      },
    });
  }

  /**
   * Helper method to extract text from Notion properties
   */
  getPropertyText(property) {
    if (!property) return '';
    
    if (property.title && property.title.length > 0) {
      return property.title[0].text?.content || property.title[0].plain_text || '';
    }
    
    if (property.rich_text && property.rich_text.length > 0) {
      return property.rich_text[0].text?.content || property.rich_text[0].plain_text || '';
    }
    
    return '';
  }
}

export default NotionService; 