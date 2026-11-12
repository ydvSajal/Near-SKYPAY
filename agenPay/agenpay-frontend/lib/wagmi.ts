"use client"

import { getDefaultConfig } from "@rainbow-me/rainbowkit"
import { seiTestnet, base, baseSepolia, mainnet, sepolia } from "viem/chains"

// WalletConnect projectId — required for WalletConnect / mobile wallets.
// Get one free at https://cloud.reown.com and set NEXT_PUBLIC_WC_PROJECT_ID.
// Injected wallets (MetaMask, Coinbase extension) still work without it.
const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "MISSING_WALLETCONNECT_PROJECT_ID"

export const wagmiConfig = getDefaultConfig({
  appName: "SKYPay",
  projectId,
  chains: [seiTestnet, baseSepolia, base, sepolia, mainnet],
  ssr: true,
})
