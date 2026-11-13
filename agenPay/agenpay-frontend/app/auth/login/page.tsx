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

/* Shared authentication surfaces. */
const pageShell =
  "relative min-h-screen overflow-hidden bg-slate-50 px-4 py-24 sm:px-6 lg:px-12 flex items-center justify-center text-slate-900"

const glassCard =
  "w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm "

const primaryCta =
  "h-11 w-full rounded-xl bg-primary   text-white shadow-lg  transition  "


function AccentStrip() {
  return (
    <div
      aria-hidden
      className="h-1 w-full bg-primary  via-white "
    />
  )
}

function BackHome() {
  return (
    <div className="mt-5 text-center">
      <Link
        href="/#hero"
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 shadow-sm  transition hover:bg-white hover:text-slate-900"
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
  const [step, setStep] = useState<"auth" | "notion" | "near">("auth")

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
  })

  useEffect(() => {
    const urlStep = searchParams.get("step")
    if (urlStep && ["auth", "notion", "near"].includes(urlStep)) {
      setStep(urlStep as "auth" | "notion" | "near")
    }
  }, [searchParams])

  useEffect(() => {
    if (isAuthenticated && user) {
      const hasNotionIntegration = (user as { hasNotionIntegration?: boolean }).hasNotionIntegration
      const hasNearAccount = (user as { hasNearAccount?: boolean }).hasNearAccount

      if (hasNotionIntegration && hasNearAccount) {
        router.push("/dashboard")
      } else if (!hasNotionIntegration && step === "auth") {
        setStep("notion")
      } else if (hasNotionIntegration && !hasNearAccount && step === "auth") {
        setStep("near")
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

  if (step === "auth") {
    return (
      <div className={pageShell}>
        <Navbar />
        <div className="relative mx-auto w-full max-w-6xl">
          <div className="grid w-full items-stretch gap-6 lg:grid-cols-2">
            <div className="relative hidden overflow-hidden rounded-xl border border-slate-200 bg-white p-10 shadow-sm  md:block">
              <div className="absolute -right-24 -top-24 h-56 w-56 rounded-full bg-secondary blur-3xl" />
              <div className="absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-emerald-200/70 blur-3xl" />
              <div className="relative z-10">
                <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-secondary" />
                  SKYPay Control Center
                </p>
                <h1 className="text-4xl font-semibold leading-tight text-slate-900">
                  Payments, ops, and automation in one place.
                </h1>
                <p className="mt-4 max-w-md text-sm leading-7 text-slate-600">
                  Sign in to run your AI payment operations. Connect Notion, create a NEAR account, and
                  manage invoicing flows from one modern workspace.
                </p>
                <div className="mt-8 space-y-4">
                  {[
                    { label: "Secure email authentication", dot: "bg-secondary" },
                    { label: "Notion-first workflow setup", dot: "bg-blue-700" },
                    { label: "Sponsored NEAR account setup", dot: "bg-green-600" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm "
                    >
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${item.dot}`} />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Card className={glassCard}>
              <AccentStrip />
              <CardHeader className="space-y-4 border-b border-slate-200 bg-white text-center sm:text-left">
                <Link
                  href="/#hero"
                  aria-label="Back to SKYPay home"
                  className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary   shadow-lg  transition hover:scale-105 sm:mx-0"
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
                  <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl bg-white p-1 ">
                    <TabsTrigger
                      value="login"
                      className="rounded-lg text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-primary"
                    >
                      Login
                    </TabsTrigger>
                    <TabsTrigger
                      value="register"
                      className="rounded-lg text-sm font-semibold data-[state=active]:bg-white data-[state=active]:text-primary"
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
                          className="h-11 rounded-xl border-slate-200 bg-white  focus-visible:ring-ring"
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
                            className="h-11 rounded-xl border-slate-200 bg-white pr-11  focus-visible:ring-ring"
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
                          className="h-11 rounded-xl border-slate-200 bg-white  focus-visible:ring-ring"
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
                          className="h-11 rounded-xl border-slate-200 bg-white  focus-visible:ring-ring"
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
                            className="h-11 rounded-xl border-slate-200 bg-white pr-11  focus-visible:ring-ring"
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
        <Navbar />
        <div className="relative mx-auto w-full max-w-3xl">
          <Card className={glassCard}>
            <AccentStrip />
            <CardHeader className="border-b border-slate-200 bg-white">
              <div className="mb-4 flex items-center gap-2">
                <span className="rounded-full bg-primary   px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-sm">
                  Step 2 of 3
                </span>
              </div>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary  to-rose-500 shadow-lg ">
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
              <div className="rounded-2xl border border-slate-200 bg-secondary p-5 ">
                <h3 className="mb-3 text-sm font-semibold text-primary">
                  What SKYPay sets up instantly
                </h3>
                <ul className="space-y-2 text-sm text-primary">
                  <li>Payments database for outgoing and incoming requests</li>
                  <li>Transactions ledger for on-chain settlement tracking</li>
                  <li>Invoice lifecycle workflow with statuses and reminders</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 ">
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

  if (step === "near") {
    return (
      <div className={pageShell}>
        <Navbar />
        <div className="relative mx-auto w-full max-w-3xl">
          <Card className={glassCard}>
            <AccentStrip />
            <CardHeader className="border-b border-slate-200 bg-white">
              <div className="mb-4 flex items-center gap-2">
                <span className="rounded-full bg-primary   px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-sm">
                  Step 3 of 3
                </span>
              </div>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary   shadow-lg">
                <Wallet className="h-8 w-8 text-white" />
              </div>
              <CardTitle className="text-center text-3xl font-semibold text-slate-900">
                Create your NEAR company account
              </CardTitle>
              <CardDescription className="text-center text-slate-600">
                Receive invoice payments in USDC and let the agent pay approved suppliers within your limits.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5 p-8">
              <div className="rounded-2xl border border-slate-200 bg-secondary p-5 ">
                <h3 className="mb-3 text-sm font-semibold text-primary">What gets created (NEAR testnet, sponsored)</h3>
                <ul className="space-y-2 text-sm text-primary">
                  <li>Your company account. Its key is generated in this browser and never sent to SkyPay.</li>
                  <li>An immutable vault contract that holds the funds the agent may spend.</li>
                  <li>An agent key that can only call the vault&apos;s pay method, within your limits.</li>
                </ul>
              </div>

              <Button onClick={() => router.push("/finance")} className={primaryCta}>
                <Wallet className="mr-2 h-4 w-4" />
                Set up NEAR account
              </Button>

              <Button
                variant="outline"
                onClick={() => router.push("/dashboard")}
                className="h-11 w-full rounded-xl border-slate-200 bg-white  hover:bg-white"
              >
                Skip for now
              </Button>

              <p className="text-center text-xs text-slate-500">
                You can set this up later from Finance.
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
