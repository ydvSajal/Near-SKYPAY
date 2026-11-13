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

      // Databases sit directly on the page (inline), in order: no sub-pages to click through.
      const incomingPaymentsDb = await this.createIncomingPaymentsDatabase(workspacePage.id);
      const outgoingPaymentsDb = await this.createOutgoingPaymentsDatabase(workspacePage.id);
      const transactionsDb = await this.createTransactionsDatabase(workspacePage.id);

      await buildRecent(this.notion, this.prisma, userId);

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
        console.log(`📍 Creating SkyPay workspace inside: "${titleOf(parentPage) || 'Untitled'}" (${parentPage.id})`);

        workspacePage = await this.notion.pages.create({
          parent: {
            type: 'page_id',
            page_id: parentPage.id,
          },
          properties: {
            title: {
              title: [
                {
                  type: 'text',
                  text: {
                    content: 'SkyPay',
                  },
                },
              ],
            },
          },
        });
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
      is_inline: true,
      parent: {
        type: 'page_id',
        page_id: parentPageId,
      },
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
      is_inline: true,
      parent: {
        type: 'page_id',
        page_id: parentPageId,
      },
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
      is_inline: true,
      parent: {
        type: 'page_id',
        page_id: parentPageId,
      },
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