"use client"

import { useState } from "react"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { useAccount, useSignMessage } from "wagmi"
import { authService } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, CheckCircle, Link2, Loader2, Wallet, ChevronDown } from "lucide-react"

interface ConnectWalletProps {
  /** Address already linked on the backend (from dashboard/user), if any. */
  linkedAddress?: string | null
  onLinked?: (address: string) => void
  onDisconnected?: () => void
}

/**
 * Connect a self-custody wallet (MetaMask / WalletConnect / Coinbase / …) and
 * prove ownership to the backend by signing a one-time nonce (SIWE-style).
 */
export function ConnectWallet({ linkedAddress, onLinked, onDisconnected }: ConnectWalletProps) {
  const { address, isConnected, connector } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const isLinked = Boolean(
    linkedAddress && address && linkedAddress.toLowerCase() === address.toLowerCase(),
  )

  const linkWallet = async () => {
    if (!address) return
    setBusy(true)
    setError("")
    try {
      const nonceRes = await authService.getWalletNonce()
      if (!nonceRes.success || !nonceRes.message) {
        throw new Error(nonceRes.error || "Could not start wallet linking")
      }

      const signature = await signMessageAsync({ message: nonceRes.message })

      const verifyRes = await authService.verifyWalletConnection(
        address,
        signature,
        connector?.name,
      )
      if (!verifyRes.success) {
        throw new Error(verifyRes.error || "Signature verification failed")
      }

      onLinked?.(address)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to link wallet")
    } finally {
      setBusy(false)
    }
  }

  const disconnectWallet = async () => {
    setBusy(true)
    setError("")
    try {
      const res = await authService.disconnectExternalWallet()
      if (!res.success) throw new Error(res.error || "Failed to disconnect")
      onDisconnected?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect wallet")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Themed connect UI — replaces RainbowKit's default pills so it matches the site. */}
      <ConnectButton.Custom>
        {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
          const ready = mounted
          const connected = ready && account && chain

          if (!connected) {
            return (
              <Button
                onClick={openConnectModal}
                className="h-10 w-full rounded-xl bg-primary   text-white shadow-md  transition  "
              >
                <Wallet className="mr-2 h-4 w-4" />
                Connect wallet
              </Button>
            )
          }

          if (chain.unsupported) {
            return (
              <Button
                onClick={openChainModal}
                variant="destructive"
                className="h-10 w-full rounded-xl"
              >
                <AlertCircle className="mr-2 h-4 w-4" />
                Wrong network
              </Button>
            )
          }

          return (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openChainModal}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-sm shadow-sm  transition hover:bg-white"
              >
                {chain.hasIcon && chain.iconUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={chain.name ?? "chain"} src={chain.iconUrl} className="h-4 w-4 rounded-full" />
                )}
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
              </button>
              <button
                type="button"
                onClick={openAccountModal}
                className="flex h-10 flex-1 items-center justify-between rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm shadow-sm  transition hover:bg-white"
              >
                <span className="truncate">{account.displayName}</span>
                <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-slate-500" />
              </button>
            </div>
          )
        }}
      </ConnectButton.Custom>

      {isConnected && !isLinked && (
        <Button
          onClick={linkWallet}
          disabled={busy}
          className="h-10 w-full rounded-xl bg-slate-900 text-white transition hover:bg-slate-800"
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Waiting for signature...
            </>
          ) : (
            <>
              <Link2 className="mr-2 h-4 w-4" />
              Sign to link this wallet
            </>
          )}
        </Button>
      )}

      {isLinked && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 ">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle className="h-3.5 w-3.5" />
            Wallet linked
          </span>
          <Button
            onClick={disconnectWallet}
            disabled={busy}
            variant="outline"
            size="sm"
            className="h-7 border-emerald-300/70 bg-white text-xs hover:bg-white"
          >
            Disconnect
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="text-xs">
          <AlertCircle className="h-3.5 w-3.5" />
          <AlertDescription className="ml-2 text-xs">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
