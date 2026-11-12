"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ConnectWallet } from "@/components/wallet/connect-wallet"
import {
  Send,
  RefreshCw,
  AlertCircle,
  LogOut,
  Wallet,
  Activity,
  Plus,
  Play,
  Square,
  Sparkles,
  ShieldCheck,
  Bot,
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Check,
  CreditCard,
} from "lucide-react"

interface DashboardData {
  user: {
    id: string
    email: string
    name: string
    hasNotionIntegration: boolean
    hasWallet: boolean
    externalWalletAddress?: string | null
    walletProvider?: string | null
  }
  wallet?: {
    address: string
    balance: {
      ETH: string
      USD: string
    }
  }
  externalWallet?: {
    address: string
    provider?: string | null
    balance?: {
      ETH: string
      USD: string
    } | null
  } | null
  agent: {
    isRunning: boolean
    totalProcessed: number
    lastActivity?: string
    threadId?: string
  }
  transactions: Array<{
    id: string
    type: string
    amount: string
    currency: string
    status: string
    createdAt: string
    description?: string
  }>
  analytics: {
    totalSent: number
    totalReceived: number
    totalTransactions: number
    successRate: number
  }
}

// Status colors follow a fixed, non-categorical palette so they never collide
// with series/identity colors elsewhere in the product.
const STATUS_META: Record<string, { dot: string; label: string }> = {
  completed: { dot: "#0ca30c", label: "Completed" },
  success: { dot: "#0ca30c", label: "Completed" },
  pending: { dot: "#fab219", label: "Pending" },
  processing: { dot: "#fab219", label: "Processing" },
  failed: { dot: "#d03b3b", label: "Failed" },
  error: { dot: "#d03b3b", label: "Failed" },
}

function getStatusMeta(status: string) {
  return STATUS_META[status.toLowerCase()] ?? { dot: "#898781", label: status }
}

function formatUsd(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
}

// Shared glass surface — matches the auth pages (tricolour glassmorphism).
const glassCard =
  "rounded-2xl border border-white/70 bg-white/65 shadow-[0_16px_50px_rgba(154,52,18,0.10)] backdrop-blur-2xl"

function StatTile({
  label,
  value,
  helper,
  icon: Icon,
  iconTint = "from-orange-500 to-amber-500",
  meter,
  action,
}: {
  label: string
  value: React.ReactNode
  helper?: React.ReactNode
  icon: React.ComponentType<{ className?: string }>
  iconTint?: string
  meter?: number
  action?: React.ReactNode
}) {
  return (
    <Card className={`${glassCard} gap-0 p-4`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${iconTint} shadow-sm`}>
          <Icon className="h-3.5 w-3.5 text-white" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {helper && <p className="mt-1 truncate text-xs text-slate-500">{helper}</p>}
      {typeof meter === "number" && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-green-600 transition-all"
            style={{ width: `${Math.min(100, Math.max(0, meter))}%` }}
          />
        </div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}

export default function Dashboard() {
  const { user, logout } = useAuth()
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [chatHistory, setChatHistory] = useState<Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
  }>>([])
  const [chatThreadId, setChatThreadId] = useState<string | undefined>(undefined)

  // Load dashboard data
  const loadDashboardData = async () => {
    try {
      setIsLoading(true)
      const response = await authService.getDashboard()

      if (response.success && response.data) {
        setDashboardData(response.data as DashboardData)
      } else {
        setError(response.error || "Failed to load dashboard data")
      }
    } catch (err) {
      setError("Failed to load dashboard data")
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  // Load initial data
  useEffect(() => {
    loadDashboardData()
  }, [])

  // Handle message processing
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || isProcessing) return

    setIsProcessing(true)
    setError("")

    const userMessage = message.trim()
    setMessage("")

    // Add user message to history
    setChatHistory(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }])

    try {
      const response = await authService.processPayment(
        userMessage,
        chatThreadId || dashboardData?.agent.threadId
      )

      if (response.success && response.data) {
        const data = response.data as { response: string; threadId?: string }

        // Store threadId for conversation continuity
        if (data.threadId) {
          setChatThreadId(data.threadId)
        }

        // Add AI response to history
        setChatHistory(prev => [...prev, {
          role: 'assistant',
          content: data.response,
          timestamp: new Date()
        }])
      } else {
        setError(response.error || "Failed to process message")
      }
    } catch (err) {
      setError("Failed to process message")
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  // Handle agent start/stop
  const handleAgentToggle = async () => {
    try {
      if (dashboardData?.agent.isRunning) {
        await authService.stopAgent()
      } else {
        await authService.startAgent(10) // 10 minute intervals
      }
      await loadDashboardData()
    } catch (err) {
      setError("Failed to toggle agent")
      console.error(err)
    }
  }

  // Handle wallet creation
  const handleCreateWallet = async () => {
    try {
      const response = await authService.createWallet()
      if (response.success) {
        await authService.requestFaucet() // Get some testnet tokens
        await loadDashboardData()
      } else {
        setError(response.error || "Failed to create wallet")
      }
    } catch (err) {
      setError("Failed to create wallet")
      console.error(err)
    }
  }

  // Handle faucet request. Automated funding is best-effort; when it isn't
  // available the backend returns the official faucet URL, which we open so the
  // user can complete it (captcha) with their address prefilled where possible.
  const handleRequestFaucet = async () => {
    setError("")
    try {
      const response = await authService.requestFaucet()
      if (!response.success) {
        setError(response.error || "Faucet request failed")
        return
      }
      const data = response.data as { autoFunded?: boolean; faucetUrl?: string } | undefined
      if (data && !data.autoFunded && data.faucetUrl) {
        window.open(data.faucetUrl, "_blank", "noopener,noreferrer")
      }
      await loadDashboardData()
    } catch (err) {
      setError("Faucet request failed")
      console.error(err)
    }
  }

  // Connect Notion from the dashboard (for users who skipped it during onboarding).
  const handleConnectNotion = async () => {
    setError("")
    try {
      const response = await authService.getNotionAuthUrl()
      if (response.success && response.authUrl) {
        window.location.href = response.authUrl
      } else {
        setError(response.error || "Failed to get Notion auth URL")
      }
    } catch (err) {
      setError("Failed to initiate Notion authentication")
      console.error(err)
    }
  }

  const handleCopyAddress = async () => {
    if (!dashboardData?.wallet?.address) return
    try {
      await navigator.clipboard.writeText(dashboardData.wallet.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error(err)
    }
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
  }

  const pageBg =
    "bg-[radial-gradient(circle_at_12%_-8%,#ffdcbc_0%,#fffaf4_40%,#f2faf6_68%,#d6efe1_100%)]"

  if (isLoading) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        <div className="text-center">
          <RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin text-orange-500" />
          <p className="text-sm text-slate-500">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (!dashboardData) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        <Card className={`${glassCard} w-full max-w-md`}>
          <CardContent className="pt-6">
            <div className="text-center">
              <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
              <p className="mb-4 text-slate-600">Failed to load dashboard</p>
              <Button
                onClick={loadDashboardData}
                className="rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 text-white hover:from-orange-700 hover:to-amber-600"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const walletUsd = Number(dashboardData.wallet?.balance.USD || 0)
  const recentTransactions = dashboardData.transactions.slice(0, 8)
  const initials = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase()

  return (
    <div className={`relative flex h-screen flex-col overflow-hidden ${pageBg} text-slate-900`}>
      {/* Ambient tricolour orbs */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full bg-orange-300/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-emerald-300/25 blur-3xl" />

      {/* Header */}
      <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-white/60 bg-white/55 px-6 backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <Link
            href="/#hero"
            aria-label="Back to SKYPay home"
            className="flex items-center gap-2 transition-opacity hover:opacity-70"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 shadow-sm">
              <CreditCard className="h-4 w-4 text-white" />
            </span>
            <span className="font-serif text-xl font-semibold">SKYPay</span>
          </Link>
          <span className="hidden text-sm text-slate-500 sm:inline">Dashboard</span>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 border-white/70 bg-white/60 py-1 text-xs font-medium text-slate-700 backdrop-blur"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: dashboardData.agent.isRunning ? "#0ca30c" : "#898781" }}
            />
            {dashboardData.agent.isRunning ? "Agent running" : "Agent stopped"}
          </Badge>

          <Button
            variant={dashboardData.agent.isRunning ? "destructive" : "default"}
            size="sm"
            onClick={handleAgentToggle}
            className={dashboardData.agent.isRunning ? "" : "bg-gradient-to-r from-orange-600 to-amber-500 text-white hover:from-orange-700 hover:to-amber-600"}
          >
            {dashboardData.agent.isRunning ? (
              <>
                <Square className="h-3.5 w-3.5" />
                Stop
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Start
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={loadDashboardData}
            aria-label="Refresh"
            className="border-white/70 bg-white/60 backdrop-blur hover:bg-white"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-6 w-px bg-slate-300/60" />

          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-600 text-xs font-semibold text-white">
              {initials}
            </div>
            <div className="hidden leading-tight md:block">
              <p className="max-w-[140px] truncate text-sm font-medium">{user?.name}</p>
              <p className="max-w-[140px] truncate text-xs text-slate-500">{user?.email}</p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            aria-label="Log out"
            className="hover:bg-white/60"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Content — fills the viewport; only inner panels scroll */}
      <main className="relative z-10 min-h-0 flex-1 overflow-hidden px-4 py-4 lg:px-6">
        <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-4">
          <div className="shrink-0">
            <h1 className="text-xl font-semibold tracking-tight">
              {getGreeting()}, {user?.name}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Here&apos;s the state of your payment agent and wallet.
            </p>
          </div>

          {/* KPI row */}
          <div className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-4">
            {dashboardData.wallet ? (
              <StatTile
                label="Wallet balance"
                icon={Wallet}
                iconTint="from-orange-500 to-amber-500"
                value={formatUsd(walletUsd)}
                helper={`${dashboardData.wallet.balance.ETH} ETH`}
              />
            ) : (
              <StatTile
                label="Wallet balance"
                icon={Wallet}
                iconTint="from-orange-500 to-amber-500"
                value="No wallet"
                helper="Create a wallet to start sending payments"
                action={
                  <Button
                    size="sm"
                    onClick={handleCreateWallet}
                    className="h-7 w-full rounded-lg bg-gradient-to-r from-orange-600 to-amber-500 text-xs text-white hover:from-orange-700 hover:to-amber-600"
                  >
                    <Plus className="h-3 w-3" />
                    Create wallet
                  </Button>
                }
              />
            )}

            <StatTile
              label="Total sent"
              icon={ArrowUpRight}
              iconTint="from-sky-500 to-blue-600"
              value={formatUsd(dashboardData.analytics.totalSent)}
              helper="All-time"
            />

            <StatTile
              label="Total received"
              icon={ArrowDownLeft}
              iconTint="from-green-600 to-emerald-500"
              value={formatUsd(dashboardData.analytics.totalReceived)}
              helper="All-time"
            />

            <StatTile
              label="Success rate"
              icon={ShieldCheck}
              iconTint="from-violet-500 to-indigo-600"
              value={`${dashboardData.analytics.successRate.toFixed(1)}%`}
              helper={`${dashboardData.analytics.totalTransactions} transactions`}
              meter={dashboardData.analytics.successRate}
            />
          </div>

          {/* Main grid — fills remaining height */}
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
            {/* Chat / mission control */}
            <div className="flex min-h-0 flex-col gap-4 lg:col-span-2">
              <Card className={`${glassCard} shrink-0 gap-3 p-4`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Mission control</p>
                    <h2 className="mt-0.5 text-base font-semibold">Natural-language payments</h2>
                  </div>
                  <Sparkles className="h-4 w-4 text-orange-500" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setMessage("Invoice SKY Corp for 0.15 ETH")}
                    className="border-white/80 bg-white/60 backdrop-blur hover:bg-white"
                  >
                    Invoice 0.15 ETH
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setMessage("Send 0.10 ETH to 0x123...")}
                    className="border-white/80 bg-white/60 backdrop-blur hover:bg-white"
                  >
                    Send 0.10 ETH
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setMessage("Show analytics for this week")}
                    className="border-white/80 bg-white/60 backdrop-blur hover:bg-white"
                  >
                    Weekly analytics
                  </Button>
                </div>
              </Card>

              <Card className={`${glassCard} flex min-h-0 flex-1 flex-col gap-0 p-4`}>
                <div className="mb-3 flex shrink-0 items-center justify-between">
                  <h2 className="text-sm font-semibold">Command chat</h2>
                  <p className="max-w-[50%] truncate text-xs text-slate-500">
                    Thread: {chatThreadId || dashboardData.agent.threadId || "new"}
                  </p>
                </div>

                <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/70 bg-white/45 p-3">
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {chatHistory.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-300/70 p-6 text-center">
                        <CreditCard className="mx-auto mb-2 h-6 w-6 text-orange-500" />
                        <h3 className="text-sm font-semibold">Welcome to SKYPay</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Use plain English to trigger secure payment operations.
                        </p>
                        <div className="mt-3 space-y-1 text-xs text-slate-500">
                          <p>&quot;Invoice SKY Corp for 0.15 ETH&quot;</p>
                          <p>&quot;Send 0.1 ETH to 0x123...&quot;</p>
                          <p>&quot;Show analytics&quot;</p>
                        </div>
                      </div>
                    )}

                    {chatHistory.map((msg, index) => (
                      <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[90%] rounded-xl px-3 py-2 text-sm shadow-sm sm:max-w-[78%] ${
                            msg.role === "user"
                              ? "bg-gradient-to-r from-orange-600 to-amber-500 text-white"
                              : "border border-white/70 bg-white/80 text-slate-900"
                          }`}
                        >
                          <div className="whitespace-pre-wrap leading-5">{msg.content}</div>
                          <div className={`mt-1 text-[11px] ${msg.role === "user" ? "text-white/70" : "text-slate-400"}`}>
                            {msg.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    ))}

                    {isProcessing && (
                      <div className="flex justify-start">
                        <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 text-xs shadow-sm">
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            <span>Processing...</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {error && (
                    <div className="mt-3 shrink-0">
                      <Alert variant="destructive" className="text-xs">
                        <AlertCircle className="h-3.5 w-3.5" />
                        <AlertDescription className="ml-2 text-xs">{error}</AlertDescription>
                      </Alert>
                    </div>
                  )}

                  <form onSubmit={handleSendMessage} className="mt-3 shrink-0">
                    <div className="flex gap-2">
                      <Input
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Type a command, e.g. Invoice SKY Corp for 0.15 ETH"
                        className="h-10 flex-1 border-white/80 bg-white/70 text-sm backdrop-blur focus-visible:ring-orange-400"
                        disabled={isProcessing}
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={isProcessing || !message.trim()}
                        className="h-10 w-10 bg-gradient-to-r from-orange-600 to-amber-500 text-white hover:from-orange-700 hover:to-amber-600"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </form>
                </div>
              </Card>
            </div>

            {/* Side column — scrolls when cards outgrow short viewports */}
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
              {/* Wallet */}
              {dashboardData.wallet ? (
                <Card className={`${glassCard} shrink-0 gap-2 p-4`}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-500">Managed agent wallet</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRequestFaucet}
                      className="h-7 border-white/80 bg-white/60 text-xs backdrop-blur hover:bg-white"
                    >
                      <Plus className="h-3 w-3" />
                      Faucet
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className="flex items-center gap-1.5 rounded-lg border border-white/80 bg-white/50 px-2.5 py-2 font-mono text-xs text-slate-600 transition-colors hover:bg-white"
                  >
                    <span className="truncate">{dashboardData.wallet.address}</span>
                    {copied ? <Check className="h-3 w-3 shrink-0 text-[#0ca30c]" /> : <Copy className="h-3 w-3 shrink-0" />}
                  </button>
                </Card>
              ) : null}

              {/* Connected (self-custody) wallet */}
              <Card className={`${glassCard} shrink-0 gap-3 p-4`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-green-600 to-emerald-500 shadow-sm">
                      <Wallet className="h-3.5 w-3.5 text-white" />
                    </span>
                    <p className="text-sm font-semibold">Connected wallet</p>
                  </div>
                  {dashboardData.externalWallet?.provider && (
                    <span className="rounded-full border border-white/70 bg-white/60 px-2 py-0.5 text-[11px] capitalize text-slate-600 backdrop-blur">
                      {dashboardData.externalWallet.provider}
                    </span>
                  )}
                </div>

                {dashboardData.externalWallet ? (
                  <div className="rounded-xl border border-white/70 bg-white/50 p-3">
                    <p className="truncate font-mono text-xs text-slate-600">
                      {dashboardData.externalWallet.address}
                    </p>
                    {dashboardData.externalWallet.balance && (
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {dashboardData.externalWallet.balance.ETH} ETH ·{" "}
                        {formatUsd(Number(dashboardData.externalWallet.balance.USD || 0))}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-slate-500">
                    Link MetaMask or another wallet you control to receive payouts and withdraw. You
                    approve every transaction yourself.
                  </p>
                )}

                <ConnectWallet
                  linkedAddress={dashboardData.externalWallet?.address ?? null}
                  onLinked={loadDashboardData}
                  onDisconnected={loadDashboardData}
                />
              </Card>

              {/* Integrations */}
              <Card className={`${glassCard} shrink-0 gap-3 p-4`}>
                <p className="text-xs font-medium text-slate-500">Integrations</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg border border-white/70 bg-white/50 px-3 py-2 text-sm">
                    <span className="text-slate-600">Notion</span>
                    {dashboardData.user.hasNotionIntegration ? (
                      <Badge className="bg-[#0ca30c] text-white">Connected</Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={handleConnectNotion}
                        className="h-7 rounded-lg bg-gradient-to-r from-orange-600 to-amber-500 text-xs text-white hover:from-orange-700 hover:to-amber-600"
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-white/70 bg-white/50 px-3 py-2 text-sm">
                    <span className="text-slate-600">Wallet</span>
                    {dashboardData.user.hasWallet ? (
                      <Badge className="bg-[#0ca30c] text-white">Created</Badge>
                    ) : (
                      <Badge variant="outline">Not created</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-white/70 bg-white/50 px-3 py-2 text-sm">
                    <span className="text-slate-600">Agent</span>
                    <Badge
                      className={dashboardData.agent.isRunning ? "bg-[#2a78d6] text-white" : ""}
                      variant={dashboardData.agent.isRunning ? "default" : "outline"}
                    >
                      {dashboardData.agent.isRunning ? "Running" : "Stopped"}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 border-t border-white/60 pt-2 text-xs text-slate-500">
                  <Bot className="h-3.5 w-3.5" />
                  {dashboardData.agent.lastActivity
                    ? `Last activity ${new Date(dashboardData.agent.lastActivity).toLocaleString()}`
                    : "No agent activity yet"}
                </div>
              </Card>

              {/* Recent transactions — flexes and scrolls internally */}
              <Card className={`${glassCard} flex min-h-[220px] flex-1 flex-col gap-0 overflow-hidden p-0`}>
                <CardHeader className="shrink-0 border-b border-white/60 px-4 py-3">
                  <CardTitle className="text-sm font-semibold">Recent transactions</CardTitle>
                </CardHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {recentTransactions.length > 0 ? (
                    <ul className="divide-y divide-white/60">
                      {recentTransactions.map((tx) => {
                        const meta = getStatusMeta(tx.status)
                        const isIncoming = tx.type.toLowerCase() === "incoming"
                        return (
                          <li key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
                            {isIncoming ? (
                              <ArrowDownLeft className="h-4 w-4 shrink-0 text-[#0ca30c]" />
                            ) : (
                              <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium capitalize">{tx.type}</p>
                              <p className="text-xs text-slate-500">
                                {new Date(tx.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-medium tabular-nums">
                                {tx.amount} {tx.currency}
                              </p>
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
                                {meta.label}
                              </span>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <Activity className="mx-auto mb-1 h-4 w-4 text-slate-400" />
                      <p className="text-xs text-slate-500">No transactions yet</p>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
