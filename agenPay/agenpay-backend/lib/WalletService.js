/**
 * Privy Wallet Service for AgenPay
 * Simple wrapper for Privy using Privy Server Auth API
 * Stores only wallet name and address - Privy handles private keys remotely
 */

import { PrivyClient } from '@privy-io/server-auth';
import { PrismaClient } from '@prisma/client';
import dotenv from "dotenv";
import axios from 'axios';

dotenv.config();

export class WalletService {
  constructor() {
    this.prisma = new PrismaClient();
    this.privy = null;
    this.initialized = false;
    this.setupPrivy();
  }

  /**
   * Setup Privy Client
   */
  setupPrivy() {
    try {
      const appId = process.env.PRIVY_APP_ID;
      const appSecret = process.env.PRIVY_APP_SECRET;
      
      if (!appId || !appSecret) {
        console.warn('⚠️ Privy credentials not found, using mock mode');
        this.initialized = false;
        return;
      }

      this.privy = new PrivyClient(appId, appSecret);
      this.initialized = true;
      console.log('✅ Privy Wallet Service initialized');
    } catch (error) {
      console.error('❌ Error initializing Privy:', error.message);
      this.initialized = false;
    }
  }

  /**
   * Create new wallet for user
   */
  async createWallet(userId, network = 'sei-testnet') {
    try {
      if (!this.initialized) {
        throw new Error('Privy not initialized');
      }

      console.log(`💳 Creating Privy wallet for user ${userId} on ${network}`);

      // Create wallet using Privy API
      const wallet = await this.createPrivyWallet(userId, network);
      
      const walletData = {
        walletId: wallet.id || `user_${userId}_wallet`,
        address: wallet.address,
        network: network,
      };

      // Update user record with wallet info
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          walletId: walletData.walletId,
          walletAddress: walletData.address,
        },
      });

      // Request faucet funds for testnet
      if (network.includes('sepolia') || network.includes('testnet')) {
        try {
          await this.requestFaucetFunds(walletData.address, network);
          console.log(`🚰 Faucet funds requested for ${walletData.address}`);
        } catch (faucetError) {
          console.warn('⚠️ Faucet funding failed:', faucetError.message);
        }
      }

      console.log(`✅ Wallet created for user ${userId}: ${walletData.address}`);
      return walletData;
    } catch (error) {
      console.error(`❌ Error creating wallet for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Create wallet using Privy Wallet API (server-managed embedded wallet)
   */
  async createPrivyWallet(userId, network) {
    try {
      const wallet = await this.privy.walletApi.create({ chainType: 'ethereum' });

      console.log(`✅ Created Privy wallet: ${wallet.address}`);
      return { id: wallet.id, address: wallet.address, network };
    } catch (error) {
      console.error('❌ Error creating Privy wallet:', error);
      throw error;
    }
  }

  /**
   * Convert a decimal amount string (e.g. "0.05") to a hex wei quantity
   */
  toWeiHex(amount) {
    const [whole = '0', frac = ''] = String(amount).split('.');
    const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
    const wei = BigInt(whole) * 10n ** 18n + BigInt(fracPadded || '0');
    return `0x${wei.toString(16)}`;
  }

  /**
   * Get wallet for user
   */
  async getWallet(userId) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { walletId: true, walletAddress: true },
      });

      if (!user?.walletAddress) {
        throw new Error('Wallet not found for user');
      }

      // Return consistent structure
      return {
        walletId: user.walletId,
        address: user.walletAddress,
        walletAddress: user.walletAddress, // Add this for compatibility
        network: 'sei-testnet', // Default network since we don't store it in User model
      };
    } catch (error) {
      console.error(`❌ Error getting wallet for user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(userId) {
    try {
      const { address, network } = await this.getWallet(userId);
      
      if (!this.initialized) {
        // Return mock balance if Privy not initialized
        return { ETH: '0.1', USD: '200.00' };
      }
      
      // Get balance from blockchain RPC (since Privy server-auth doesn't have balance API)
      const balance = await this.getBlockchainBalance(address, network);
      
      return balance;
    } catch (error) {
      console.error(`❌ Error getting wallet balance for user ${userId}:`, error);
      return { ETH: '0', USD: '0' };
    }
  }

  /**
   * Get balance from blockchain RPC
   */
  async getBlockchainBalance(address, network) {
    try {
      const rpcUrl = this.getRpcUrl(network);
      
      // Get ETH balance
      const ethBalance = await this.getEthBalance(address, rpcUrl);
      
      // Mock USD conversion
      const usdValue = (parseFloat(ethBalance) * 2000).toFixed(2);
      
      return { ETH: ethBalance, USD: usdValue };
    } catch (error) {
      console.warn('⚠️ Blockchain balance fetch failed, using mock:', error.message);
      return { ETH: '0.1', USD: '200.00' };
    }
  }

  /**
   * Get ETH balance from RPC
   */
  async getEthBalance(address, rpcUrl) {
    try {
      const response = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      if (response.data.result) {
        // Convert from wei to ETH
        const weiBalance = parseInt(response.data.result, 16);
        return (weiBalance / 1e18).toFixed(6);
      }
      
      return '0';
    } catch (error) {
      console.warn('⚠️ RPC balance fetch failed:', error.message);
      return '0.1'; // Mock balance
    }
  }

  /**
   * Get RPC URL for network
   */
  getRpcUrl(network) {
    const rpcUrls = {
      'sei-testnet': 'https://evm-rpc-testnet.sei-apis.com',
      'base-sepolia': 'https://sepolia.base.org',
      'base-mainnet': 'https://mainnet.base.org',
      'ethereum-sepolia': 'https://rpc.sepolia.org',
      'ethereum-mainnet': 'https://eth.llamarpc.com'
    };
    
    return rpcUrls[network] || rpcUrls['sei-testnet'];
  }

  /**
   * Send cryptocurrency
   */
  async sendCrypto(userId, toAddress, amount, currency = 'ETH') {
    try {
      if (!this.initialized) {
        throw new Error('Privy not initialized');
      }

      console.log(`💸 Sending ${amount} ${currency} from user ${userId} to ${toAddress}`);

      const { address: fromAddress, walletId, network } = await this.getWallet(userId);

      // Create transaction record
      const transaction = await this.prisma.transaction.create({
        data: {
          userId,
          type: 'SEND',
          status: 'PROCESSING',
          amount: parseFloat(amount),
          currency: currency.toUpperCase(),
          description: `Send ${amount} ${currency} to ${toAddress}`,
          toAddress,
          fromAddress,
        },
      });

      try {
        // Send transaction signed by Privy's server wallet
        const txResult = await this.sendBlockchainTransaction(walletId, toAddress, amount, network);
        
        const txHash = txResult.transactionHash || txResult.hash;
        
        // Update transaction record
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            txHash: txHash,
            status: 'PENDING',
          },
        });

        console.log(`✅ Transaction sent: ${txHash}`);
        
        return {
          success: true,
          transactionId: transaction.id,
          transactionHash: txHash,
          amount,
          currency,
          toAddress,
        };
      } catch (sendError) {
        // Update transaction as failed
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'FAILED' },
        });
        
        throw sendError;
      }
    } catch (error) {
      console.error(`❌ Error sending crypto for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Sign and broadcast a transaction using Privy's Wallet API
   */
  async sendBlockchainTransaction(walletId, toAddress, amount, network) {
    try {
      if (!walletId) {
        throw new Error('Missing walletId for signing transaction');
      }

      const chainId = this.getChainIdForNetwork(network);
      const result = await this.privy.walletApi.ethereum.sendTransaction({
        walletId,
        caip2: `eip155:${chainId}`,
        transaction: {
          to: toAddress,
          value: this.toWeiHex(amount),
        },
      });

      console.log(`✅ Transaction broadcast: ${result.hash}`);

      return {
        transactionHash: result.hash,
        hash: result.hash,
        success: true,
      };
    } catch (error) {
      console.error('❌ Error sending blockchain transaction:', error);
      throw error;
    }
  }

  /**
   * Request testnet tokens
   */
  async requestTestnetTokens(userId, network = 'sei-testnet') {
    try {
      if (!this.initialized) {
        console.log(`⚠️ Privy not fully initialized, but continuing with faucet request...`);
        // Don't throw error, just log warning and continue
      }

      const walletData = await this.getWallet(userId);
      const address = walletData.address || walletData.walletAddress;
      
      if (!address) {
        throw new Error('No wallet address found for user');
      }
      
      console.log(`🚰 Requesting faucet funds for address ${address} on ${network}`);

      const faucetUrl = this.getFaucetUrl(network);

      // Best-effort automated request. Most public testnet faucets are web-UI
      // with captcha, so this usually won't auto-fund — we report honestly and
      // always hand back the official faucet URL for the user to complete it.
      const faucetResult = await this.requestFaucetFunds(address, network);
      const currency = network === 'sei-testnet' ? 'SEI' : 'ETH';

      if (faucetResult.ok) {
        console.log(`🚰 Faucet auto-funded for user ${userId}: ${faucetResult.txHash}`);
        return {
          success: true,
          autoFunded: true,
          transactionHash: faucetResult.txHash,
          currency,
          network,
          faucetUrl,
          message: 'Testnet tokens requested. They may take a few minutes to arrive.',
        };
      }

      console.log(`🚰 Auto-faucet unavailable for user ${userId}; returning faucet URL`);
      return {
        success: true,
        autoFunded: false,
        currency,
        network,
        address,
        faucetUrl,
        message: `Automated faucet is unavailable for ${network}. Open the official faucet to fund ${address}.`,
      };
    } catch (error) {
      console.error(`❌ Error requesting testnet tokens for user ${userId}:`, error.message);
      throw new Error(`Faucet request failed: ${error.message}`);
    }
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(userId, limit = 20) {
    try {
      const transactions = await this.prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return transactions;
    } catch (error) {
      console.error(`❌ Error getting transaction history for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get wallet analytics
   */
  async getWalletAnalytics(userId) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          transactions: {
            where: { status: 'COMPLETED' },
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const balance = user.walletAddress ? await this.getWalletBalance(userId) : { ETH: '0', USD: '0' };
      
      // Calculate stats
      const stats = {
        totalSent: 0,
        totalReceived: 0,
        totalTransactions: 0,
      };

      for (const tx of user.transactions) {
        stats.totalTransactions++;
        if (tx.type === 'SEND') {
          stats.totalSent += parseFloat(tx.amount);
        } else if (tx.type === 'RECEIVE') {
          stats.totalReceived += parseFloat(tx.amount);
        }
      }

      return {
        walletAddress: user.walletAddress,
        walletNetwork: user.walletNetwork,
        balance,
        stats,
        recentTransactions: user.transactions,
      };
    } catch (error) {
      console.error(`❌ Error getting wallet analytics for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Check if user has wallet
   */
  async hasWallet(userId) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { walletAddress: true },
      });

      return !!(user?.walletAddress);
    } catch (error) {
      console.error(`❌ Error checking wallet for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Validate wallet address
   */
  validateAddress(address) {
    const ethRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethRegex.test(address);
  }

  /**
   * Get supported networks
   */
  getSupportedNetworks() {
    return [
      { id: 'sei-testnet', name: 'Sei Testnet', isTestnet: true },
      { id: 'base-sepolia', name: 'Base Sepolia (Testnet)', isTestnet: true },
      { id: 'base-mainnet', name: 'Base Mainnet', isTestnet: false },
      { id: 'ethereum-sepolia', name: 'Ethereum Sepolia (Testnet)', isTestnet: true },
      { id: 'ethereum-mainnet', name: 'Ethereum Mainnet', isTestnet: false },
    ];
  }

  /**
   * Get supported tokens for a network
   */
  getSupportedTokens(network) {
    const tokens = {
      'sei-testnet': [
        { symbol: 'SEI', name: 'Sei', decimals: 18, address: '0x0000000000000000000000000000000000000000' },
        { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x4fcf1784b31630811181f670aea7a7bef803eaed' },
        { symbol: 'USDT', name: 'Tether USD', decimals: 6, address: '0x1990BC6dfe2ef605Bfc08f5A23564dB75642Ad73' },
      ],
      'base-sepolia': [
        { symbol: 'ETH', name: 'Ethereum', decimals: 18, address: '0x0000000000000000000000000000000000000000' },
        { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x036CbD53842c5426634e7929541eC2318f3dCF7c' },
        { symbol: 'USDT', name: 'Tether USD', decimals: 6, address: '0x1990BC6dfe2ef605Bfc08f5A23564dB75642Ad73' },
      ],
      'base-mainnet': [
        { symbol: 'ETH', name: 'Ethereum', decimals: 18, address: '0x0000000000000000000000000000000000000000' },
        { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
        { symbol: 'USDT', name: 'Tether USD', decimals: 6, address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb' },
      ],
      'ethereum-sepolia': [
        { symbol: 'ETH', name: 'Ethereum', decimals: 18, address: '0x0000000000000000000000000000000000000000' },
        { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
        { symbol: 'USDT', name: 'Tether USD', decimals: 6, address: '0x7169D38820dfd117C3FA1fDf8770f9d1D40aBd9C' },
      ],
      'ethereum-mainnet': [
        { symbol: 'ETH', name: 'Ethereum', decimals: 18, address: '0x0000000000000000000000000000000000000000' },
        { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xA0b86a33E6441b8c4C8C0C8C0C8C0C8C0C8C0C8' },
        { symbol: 'USDT', name: 'Tether USD', decimals: 6, address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb' },
      ],
    };

    return tokens[network] || tokens['sei-testnet'];
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      sdk: 'Privy Server Auth',
      remoteKeyManagement: true,
    };
  }

  /**
   * Helper method to get chain ID for network
   */
  getChainIdForNetwork(network) {
    const chainIds = {
      'sei-testnet': 1328,
      'base-sepolia': 84532,
      'base-mainnet': 8453,
      'ethereum-sepolia': 11155111,
      'ethereum-mainnet': 1,
    };
    
    return chainIds[network] || 1328; // Default to Sei Testnet
  }

  /**
   * Official web faucet URL for a given testnet. These are the human-facing
   * faucets (captcha-gated), used as the reliable fallback when automated
   * funding isn't available.
   */
  getFaucetUrl(network) {
    const urls = {
      'sei-testnet': 'https://atlantic-2.app.sei.io/faucet',
      'base-sepolia': 'https://portal.cdp.coinbase.com/products/faucet',
      'ethereum-sepolia': 'https://sepoliafaucet.com',
    };
    return urls[network] || urls['sei-testnet'];
  }

  /**
   * Best-effort automated faucet call. Returns { ok, txHash } honestly:
   * ok is true ONLY when the faucet endpoint actually accepted the request.
   * Most public faucets are captcha-gated web UIs, so ok will usually be false
   * and the caller falls back to getFaucetUrl().
   */
  async requestFaucetFunds(address, network) {
    const endpoints = {
      'sei-testnet': {
        url: 'https://faucet.sei-testnet.seinetwork.io/',
        body: { address, amount: '1000000000000000000' },
      },
      'base-sepolia': {
        url: 'https://faucet.sepolia.base.org/donate',
        body: { address },
      },
      'ethereum-sepolia': {
        url: 'https://faucet.sepolia.dev/',
        body: { address },
      },
    };

    const endpoint = endpoints[network];
    if (!endpoint) return { ok: false, txHash: null };

    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(endpoint.body),
      });

      if (!response.ok) {
        console.warn(`⚠️ Faucet ${endpoint.url} returned ${response.status}`);
        return { ok: false, txHash: null };
      }

      const result = await response.json().catch(() => ({}));
      return { ok: true, txHash: result.txHash || result.transactionHash || null };
    } catch (error) {
      console.warn('⚠️ Faucet request failed:', error.message);
      return { ok: false, txHash: null };
    }
  }

  async cleanup() {
    await this.prisma.$disconnect();
  }
}

export default WalletService; 