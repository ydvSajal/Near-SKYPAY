"use client"

import { Suspense, useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { Navbar } from "@/components/landing/navbar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ConnectWallet } from "@/components/wallet/connect-wallet"
import {
  CreditCard,
  Database,
  Wallet,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  ArrowLeft,
} from "lucide-react"

/* Shared theme — glassmorphism on an Indian tricolour gradient */
const pageShell =
  "relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_12%_-8%,#ffdcbc_0%,#fffaf4_40%,#f2faf6_68%,#d6efe1_100%)] px-4 py-24 sm:px-6 lg:px-12 flex items-center justify-center text-slate-900"

const glassCard =
  "w-full overflow-hidden rounded-3xl border border-white/70 bg-white/65 shadow-[0_24px_80px_rgba(154,52,18,0.14)] backdrop-blur-2xl"

const primaryCta =
  "h-11 w-full rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 text-white shadow-lg shadow-orange-500/25 transition hover:from-orange-700 hover:to-amber-600"

function Backdrop() {
  return (
    <>
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-orange-300/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-emerald-300/35 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-white/60 blur-3xl" />
    </>
  )
}

function TricolourStrip() {
  return (
    <div
      aria-hidden
      className="h-1 w-full bg-gradient-to-r from-orange-500 via-white to-green-600"
    />
  )
}

function BackHome() {
  return (
    <div className="mt-5 text-center">
      <Link
        href="/#hero"
        className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/60 px-4 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-slate-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to home
      </Link>
    </div>
  )
}

function AuthPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login, register, isAuthenticated, user } = useAuth()

  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [step, setStep] = useState<"auth" | "notion" | "wallet">("auth")

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
  })

  useEffect(() => {
    const urlStep = searchParams.get("step")
    if (urlStep && ["auth", "notion", "wallet"].includes(urlStep)) {
      setStep(urlStep as "auth" | "notion" | "wallet")
    }
  }, [searchParams])

  useEffect(() => {
    if (isAuthenticated && user) {
      const hasNotionIntegration = (user as { hasNotionIntegration?: boolean }).hasNotionIntegration
      const hasWallet = (user as { hasWallet?: boolean }).hasWallet

      if (hasNotionIntegration && hasWallet) {
        router.push("/dashboard")
      } else if (!hasNotionIntegration && step === "auth") {
        setStep("notion")
      } else if (hasNotionIntegration && !hasWallet && step === "auth") {
        setStep("wallet")
      }
    }
  }, [isAuthenticated, user, router, step])

  const updateFormData = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setError("")
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    try {
      const result = await login(formData.email, formData.password)
      if (!result.success) {
        setError(result.error || "Login failed")
      }
    } catch {
      setError("Login failed. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    if (formData.password.length < 6) {
      setError("Password must be at least 6 characters")
      setIsLoading(false)
      return
    }

    try {
      const result = await register(formData.email, formData.password, formData.name)
      if (result.success) {
        setStep("notion")
      } else {
        setError(result.error || "Registration failed")
      }
    } catch {
      setError("Registration failed. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleNotionConnect = async () => {
    setIsLoading(true)
    setError("")

    try {
      const response = await authService.getNotionAuthUrl()
      if (response.success && response.authUrl) {
        window.location.href = response.authUrl
      } else {
        setError(response.error || "Failed to get Notion auth URL")
        setIsLoading(false)
      }
    } catch {
      setError("Failed to initiate Notion authentication")
      setIsLoading(false)
    }
  }

  const handleWalletCreation = async () => {
    setIsLoading(true)
    setError("")

    try {
      const response = await authService.createWallet()
      if (response.success) {
        await authService.requestFaucet()
        router.push("/dashboard")
      } else {
        setError(response.error || "Wallet creation failed")
      }
    } catch {
      setError("Failed to create wallet")
    } finally {
      setIsLoading(false)
    }
  }

  if (step === "auth") {
    return (
      <div className={pageShell}>
        <Backdrop />
        <Navbar />
        <div className="relative mx-auto w-full max-w-6xl">
          <div className="grid w-full items-stretch gap-6 lg:grid-cols-2">
            <div className="relative hidden overflow-hidden rounded-3xl border border-white/70 bg-white/55 p-10 shadow-[0_24px_80px_rgba(154,52,18,0.12)] backdrop-blur-2xl md:block">
              <div className="absolute -right-24 -top-24 h-56 w-56 rounded-full bg-orange-200/70 blur-3xl" />
              <div className="absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-emerald-200/70 blur-3xl" />
              <div className="relative z-10">
                <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-200/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-orange-800">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-500" />
                  SKYPay Control Center
                </p>
                <h1 className="text-4xl font-semibold leading-tight text-slate-900">
                  Payments, ops, and automation in one place.
                </h1>
                <p className="mt-4 max-w-md text-sm leading-7 text-slate-600">
                  Sign in to run your AI payment operations. Connect Notion, create a wallet, and
                  manage invoicing flows from one modern workspace.
                </p>
                <div className="mt-8 space-y-4">
                  {[
                    { label: "Secure email authentication", dot: "bg-orange-500" },
                    { label: "Notion-first workflow setup", dot: "bg-blue-700" },
                    { label: "Instant wallet provisioning", dot: "bg-green-600" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center gap-3 rounded-xl border border-white/80 bg-white/70 px-4 py-3 text-sm text-slate-700 shadow-sm backdrop-blur"
                    >
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${item.dot}`} />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Card className={glassCard}>
              <TricolourStrip />
              <CardHeader className="space-y-4 border-b border-white/60 bg-white/40 text-center sm:text-left">
                <Link
                  href="/#hero"
                  aria-label="Back to SKYPay home"
                  className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg shadow-orange-500/30 transition hover:scale-105 sm:mx-0"
                >
                  <CreditCard className="h-8 w-8 text-white" />
                </Link>
                <div>
                  <CardTitle className="text-3xl font-semibold tracking-tight text-slate-900">
                    Welcome back
                  </CardTitle>
                  <CardDescription className="mt-1 text-slate-600">
                    Continue to your SKYPay agent workspace
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="p-6 sm:p-8">
                <Tabs defaultValue="login" className="space-y-5">
                  <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl bg-white/60 p-1 backdrop-blur">
                    <TabsTrigger
                      value="login"
                      className="rounded-lg text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-orange-700"
                    >
                      Login
                    </TabsTrigger>
                    <TabsTrigger
                      value="register"
                      className="rounded-lg text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-orange-700"
                    >
                      Register
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="login">
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="your@email.com"
                          value={formData.email}
                          onChange={(e) => updateFormData("email", e.target.value)}
                          required
                          className="h-11 rounded-xl border-white/80 bg-white/70 backdrop-blur focus-visible:ring-orange-400"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <div className="relative">
                          <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            value={formData.password}
                            onChange={(e) => updateFormData("password", e.target.value)}
                            required
                            className="h-11 rounded-xl border-white/80 bg-white/70 pr-11 backdrop-blur focus-visible:ring-orange-400"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>

                      {error && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}

                      <Button type="submit" className={primaryCta} disabled={isLoading}>
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Signing in...
                          </>
                        ) : (
                          "Sign In"
                        )}
                      </Button>
                    </form>
                  </TabsContent>

                  <TabsContent value="register">
                    <form onSubmit={handleRegister} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Full Name</Label>
                        <Input
                          id="name"
                          type="text"
                          placeholder="John Doe"
                          value={formData.name}
                          onChange={(e) => updateFormData("name", e.target.value)}
                          required
                          className="h-11 rounded-xl border-white/80 bg-white/70 backdrop-blur focus-visible:ring-orange-400"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="your@email.com"
                          value={formData.email}
                          onChange={(e) => updateFormData("email", e.target.value)}
                          required
                          className="h-11 rounded-xl border-white/80 bg-white/70 backdrop-blur focus-visible:ring-orange-400"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <div className="relative">
                          <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            value={formData.password}
                            onChange={(e) => updateFormData("password", e.target.value)}
                            required
                            className="h-11 rounded-xl border-white/80 bg-white/70 pr-11 backdrop-blur focus-visible:ring-orange-400"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                        <p className="text-xs text-slate-500">Minimum 6 characters</p>
                      </div>

                      {error && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}

                      <Button type="submit" className={primaryCta} disabled={isLoading}>
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Creating account...
                          </>
                        ) : (
                          "Create Account"
                        )}
                      </Button>
                    </form>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
          <BackHome />
        </div>
      </div>
    )
  }

  if (step === "notion") {
    return (
      <div className={pageShell}>
        <Backdrop />
        <Navbar />
        <div className="relative mx-auto w-full max-w-3xl">
          <Card className={glassCard}>
            <TricolourStrip />
            <CardHeader className="border-b border-white/60 bg-white/40">
              <div className="mb-4 flex items-center gap-2">
                <span className="rounded-full bg-gradient-to-r from-orange-600 to-amber-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-sm">
                  Step 2 of 3
                </span>
              </div>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 shadow-lg shadow-orange-500/30">
                <Database className="h-8 w-8 text-white" />
              </div>
              <CardTitle className="text-center text-3xl font-semibold text-slate-900">
                Connect Notion Workspace
              </CardTitle>
              <CardDescription className="text-center text-slate-600">
                Power your admin dashboard with live payment records and automations.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5 p-8">
              <div className="rounded-2xl border border-orange-200/70 bg-orange-50/60 p-5 backdrop-blur">
                <h3 className="mb-3 text-sm font-semibold text-orange-950">
                  What SKYPay sets up instantly
                </h3>
                <ul className="space-y-2 text-sm text-orange-900">
                  <li>Payments database for outgoing and incoming requests</li>
                  <li>Transactions ledger for on-chain settlement tracking</li>
                  <li>Invoice lifecycle workflow with statuses and reminders</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-white/80 bg-white/60 p-5 text-sm text-slate-600 backdrop-blur">
                OAuth-secured connection. You will be redirected to Notion to choose and authorize
                your workspace.
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button onClick={handleNotionConnect} className={primaryCta} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redirecting to Notion...
                  </>
                ) : (
                  <>
                    <Database className="mr-2 h-4 w-4" />
                    Connect with Notion
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
          <BackHome />
        </div>
      </div>
    )
  }

  if (step === "wallet") {
    return (
      <div className={pageShell}>
        <Backdrop />
        <Navbar />
        <div className="relative mx-auto w-full max-w-3xl">
          <Card className={glassCard}>
            <TricolourStrip />
            <CardHeader className="border-b border-white/60 bg-white/40">
              <div className="mb-4 flex items-center gap-2">
                <span className="rounded-full bg-gradient-to-r from-green-700 to-emerald-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-sm">
                  Step 3 of 3
                </span>
              </div>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-green-600 to-emerald-500 shadow-lg shadow-emerald-500/30">
                <Wallet className="h-8 w-8 text-white" />
              </div>
              <CardTitle className="text-center text-3xl font-semibold text-slate-900">
                Create Your Wallet
              </CardTitle>
              <CardDescription className="text-center text-slate-600">
                Final setup to activate transfers, collections, and automated refunds.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5 p-8">
              {/* Option 1 — managed wallet (powers the autonomous agent) */}
              <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/60 p-5 backdrop-blur">
                <h3 className="mb-1 text-sm font-semibold text-emerald-950">Managed agent wallet</h3>
                <p className="mb-3 text-xs text-emerald-800">
                  A secure wallet the AI agent controls, so it can send, collect, and auto-refund
                  payments on its own.
                </p>
                <ul className="space-y-2 text-sm text-emerald-900">
                  <li>Enables autonomous scheduled payments and refunds</li>
                  <li>Multi-asset support for ETH, stablecoins, and more</li>
                  <li>Development faucet support for rapid testing</li>
                </ul>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                onClick={handleWalletCreation}
                className="h-11 w-full rounded-xl bg-gradient-to-r from-green-700 to-emerald-500 text-white shadow-lg shadow-emerald-500/25 transition hover:from-green-800 hover:to-emerald-600"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating wallet...
                  </>
                ) : (
                  <>
                    <Wallet className="mr-2 h-4 w-4" />
                    Create Managed Wallet
                  </>
                )}
              </Button>

              {/* Divider */}
              <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-slate-400">
                <span className="h-px flex-1 bg-slate-300/60" />
                or
                <span className="h-px flex-1 bg-slate-300/60" />
              </div>

              {/* Option 2 — connect your own self-custody wallet */}
              <div className="rounded-2xl border border-orange-200/70 bg-orange-50/60 p-5 backdrop-blur">
                <h3 className="mb-1 text-sm font-semibold text-orange-950">Connect your own wallet</h3>
                <p className="mb-4 text-xs text-orange-800">
                  Link MetaMask or another wallet you control to receive payouts and withdraw. You
                  approve every transaction yourself.
                </p>
                <ConnectWallet
                  linkedAddress={(user as { externalWalletAddress?: string | null })?.externalWalletAddress}
                  onLinked={() => router.push("/dashboard")}
                />
              </div>

              <Button
                variant="outline"
                onClick={() => router.push("/dashboard")}
                className="h-11 w-full rounded-xl border-white/80 bg-white/60 backdrop-blur hover:bg-white"
                disabled={isLoading}
              >
                Skip for now
              </Button>

              <p className="text-center text-xs text-slate-500">
                You can set up wallets later from your dashboard.
              </p>
            </CardContent>
          </Card>
          <BackHome />
        </div>
      </div>
    )
  }

  return null
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthPageContent />
    </Suspense>
  )
}
