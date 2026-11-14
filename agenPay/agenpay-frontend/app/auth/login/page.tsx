"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { ensureOwnerKey, downloadOwnerKeyBackup } from "@/lib/near"
import { BusinessForm } from "@/components/app/business-form"
import { OnboardingShell, StepPanel, type StepId } from "@/components/onboarding/shell"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertCircle, ArrowRight, Check, CheckCircle2, Database, Download, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Vault,
} from "lucide-react"

type Step = "auth" | "business" | "notion" | "near"
const STEP_ID: Record<Step, StepId> = { auth: "account", business: "business", notion: "notion", near: "near" }
const MIN_PASSWORD = 8 // matches the backend rule in /api/auth/register

// Only same-site paths are allowed as post-login destinations.
const safeRedirect = (v: string | null) => (v && v.startsWith("/") && !v.startsWith("//") ? v : "/dashboard")

const primary = "press inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
const secondary = "press inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function Field({
  id, label, error, hint, children,
}: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

const inputCls = (invalid: boolean) =>
  `h-11 w-full rounded-lg border bg-card px-3 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 md:text-sm ${invalid ? "border-destructive" : "border-input"}`

function AuthPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login, register, isAuthenticated, user, refreshUser } = useAuth()
  const redirectTo = safeRedirect(searchParams.get("redirect"))

  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [step, setStep] = useState<Step>("auth")
  const [formData, setFormData] = useState({ email: "", password: "", name: "" })

  useEffect(() => {
    const urlStep = searchParams.get("step")
    if (urlStep === "auth" || urlStep === "business" || urlStep === "notion" || urlStep === "near") setStep(urlStep)
  }, [searchParams])

  useEffect(() => {
    if (!isAuthenticated || !user) return
    const { hasNotionIntegration, hasNearAccount, companyName } = user
    if (hasNearAccount && step === "auth") router.push(redirectTo)
    else if (!companyName && step === "auth") setStep("business")
    else if (!hasNotionIntegration && step === "auth") setStep("notion")
    else if (hasNotionIntegration && !hasNearAccount && step === "auth") setStep("near")
  }, [isAuthenticated, user, router, step, redirectTo])

  const updateFormData = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setFieldErrors((prev) => ({ ...prev, [field]: "" }))
    setError("")
  }

  const validate = (mode: "login" | "register") => {
    const e: Record<string, string> = {}
    if (mode === "register" && !formData.name.trim()) e.name = "Enter your name."
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) e.email = "Enter a valid email address."
    if (!formData.password) e.password = "Enter your password."
    else if (mode === "register" && formData.password.length < MIN_PASSWORD) e.password = `Use at least ${MIN_PASSWORD} characters.`
    setFieldErrors(e)
    return Object.keys(e).length === 0
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate("login")) return
    setIsLoading(true)
    setError("")
    try {
      const result = await login(formData.email.trim(), formData.password)
      if (!result.success) setError(result.error || "Sign in failed. Check your email and password.")
    } catch {
      setError("We could not reach SKYPay. Check your connection and try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate("register")) return
    setIsLoading(true)
    setError("")
    try {
      const result = await register(formData.email.trim(), formData.password, formData.name.trim())
      if (result.success) setStep("business")
      else setError(result.error || "Registration failed. Try again.")
    } catch {
      setError("We could not reach SKYPay. Check your connection and try again.")
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
        setError(response.error || "Could not start the Notion connection. Try again.")
        setIsLoading(false)
      }
    } catch {
      setError("Could not start the Notion connection. Try again.")
      setIsLoading(false)
    }
  }

  const passwordToggle = (
    <button
      type="button"
      onClick={() => setShowPassword((v) => !v)}
      aria-label={showPassword ? "Hide password" : "Show password"}
      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground"
    >
      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  )

  const describe = (id: string) => (fieldErrors[id] ? `${id}-error` : undefined)

  if (step === "auth") {
    return (
      <OnboardingShell step={STEP_ID.auth}>
        <StepPanel title="Welcome to SKYPay" description="Sign in, or create a workspace for your business.">
          <Tabs defaultValue="login" onValueChange={() => { setError(""); setFieldErrors({}) }}>
            <TabsList className="grid h-11 w-full grid-cols-2 rounded-lg bg-muted p-1">
              <TabsTrigger value="login" className="rounded-md text-sm data-[state=active]:bg-card data-[state=active]:shadow-none">Sign in</TabsTrigger>
              <TabsTrigger value="register" className="rounded-md text-sm data-[state=active]:bg-card data-[state=active]:shadow-none">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-6">
              <form onSubmit={handleLogin} noValidate className="grid gap-5">
                <Field id="email" label="Email" error={fieldErrors.email}>
                  <input id="email" type="email" autoComplete="email" value={formData.email} onChange={(e) => updateFormData("email", e.target.value)}
                    aria-invalid={!!fieldErrors.email} aria-describedby={describe("email")} className={inputCls(!!fieldErrors.email)} />
                </Field>
                <Field id="password" label="Password" error={fieldErrors.password}>
                  <div className="relative">
                    <input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={formData.password}
                      onChange={(e) => updateFormData("password", e.target.value)} aria-invalid={!!fieldErrors.password}
                      aria-describedby={describe("password")} className={`${inputCls(!!fieldErrors.password)} pr-11`} />
                    {passwordToggle}
                  </div>
                </Field>
                {error && <ErrorBox>{error}</ErrorBox>}
                <button type="submit" className={primary} disabled={isLoading}>
                  {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in</> : "Sign in"}
                </button>
              </form>
            </TabsContent>

            <TabsContent value="register" className="mt-6">
              <form onSubmit={handleRegister} noValidate className="grid gap-5">
                <Field id="name" label="Full name" error={fieldErrors.name}>
                  <input id="name" type="text" autoComplete="name" value={formData.name} onChange={(e) => updateFormData("name", e.target.value)}
                    aria-invalid={!!fieldErrors.name} aria-describedby={describe("name")} className={inputCls(!!fieldErrors.name)} />
                </Field>
                <Field id="reg-email" label="Work email" error={fieldErrors.email}>
                  <input id="reg-email" type="email" autoComplete="email" value={formData.email} onChange={(e) => updateFormData("email", e.target.value)}
                    aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? "reg-email-error" : undefined} className={inputCls(!!fieldErrors.email)} />
                </Field>
                <Field id="reg-password" label="Password" error={fieldErrors.password} hint={`At least ${MIN_PASSWORD} characters.`}>
                  <div className="relative">
                    <input id="reg-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={formData.password}
                      onChange={(e) => updateFormData("password", e.target.value)} aria-invalid={!!fieldErrors.password}
                      aria-describedby={fieldErrors.password ? "reg-password-error" : "reg-password-hint"} className={`${inputCls(!!fieldErrors.password)} pr-11`} />
                    {passwordToggle}
                  </div>
                </Field>
                {error && <ErrorBox>{error}</ErrorBox>}
                <button type="submit" className={primary} disabled={isLoading}>
                  {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating account</> : "Create account"}
                </button>
              </form>
            </TabsContent>
          </Tabs>
        </StepPanel>
      </OnboardingShell>
    )
  }

  if (step === "business") {
    return (
      <OnboardingShell step={STEP_ID.business}>
        <StepPanel title="Your business details" description="These appear as the seller on every invoice and invoice email. You can change them later in Finance, under Company.">
          <BusinessForm submitLabel="Save and continue" onSaved={() => setStep("notion")} />
          <button type="button" onClick={() => setStep("notion")} className={`${secondary} mt-3`}>Skip for now</button>
        </StepPanel>
      </OnboardingShell>
    )
  }

  if (step === "notion") {
    return (
      <OnboardingShell step={STEP_ID.notion}>
        <StepPanel title="Connect Notion" description="SKYPay keeps an invoice database in your workspace and updates it when payments settle.">
          <ul className="grid gap-4">
            {[
              "A SKYPay page with incoming and outgoing payment databases",
              "New rows become NEAR invoices with a checkout and x402 pay link",
              "Status changes to paid only after on-chain verification",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.25} />
                <span className="leading-relaxed">{t}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 rounded-lg bg-muted p-4 text-sm leading-relaxed text-muted-foreground">
            You will be sent to Notion to choose which workspace SKYPay can use. You can revoke access from Notion at any time.
          </p>
          <div className="mt-8 grid gap-3">
            {error && <ErrorBox>{error}</ErrorBox>}
            <button type="button" onClick={handleNotionConnect} className={primary} disabled={isLoading}>
              {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening Notion</> : <><Database className="h-4 w-4" /> Connect Notion</>}
            </button>
            <button type="button" onClick={() => setStep("near")} className={secondary} disabled={isLoading}>Skip for now</button>
          </div>
        </StepPanel>
      </OnboardingShell>
    )
  }

  return (
    <OnboardingShell step={STEP_ID.near}>
      <NearStep onDone={() => router.push(redirectTo)} onSkip={() => router.push("/dashboard")} refreshUser={refreshUser} />
    </OnboardingShell>
  )
}

type NearState =
  | { kind: "checking" }
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; company: string }
  | { kind: "error"; message: string; retry: boolean }

/** Creates the company account, vault and agent key. Same calls as the Finance setup screen. */
function NearStep({ onDone, onSkip, refreshUser }: { onDone: () => void; onSkip: () => void; refreshUser: () => Promise<void> }) {
  const { user } = useAuth()
  const [state, setState] = useState<NearState>({ kind: "checking" })
  const [backedUp, setBackedUp] = useState(false)

  const check = useCallback(async () => {
    setState({ kind: "checking" })
    try {
      const s = await authService.api<{ configured: boolean; company: string | null }>("/api/near/status")
      if (s.company) setState({ kind: "done", company: s.company })
      else if (!s.configured) setState({ kind: "error", message: "NEAR is not configured on this SKYPay server yet. An administrator needs to run the NEAR bootstrap.", retry: false })
      else setState({ kind: "idle" })
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Could not reach SKYPay.", retry: true })
    }
  }, [])

  useEffect(() => { if (user) check() }, [user, check])

  const create = async () => {
    if (!user) return
    setState({ kind: "working" })
    try {
      const { publicKey } = await ensureOwnerKey(user.id)
      const r = await authService.api<{ company: string }>("/api/near/provision", { method: "POST", body: JSON.stringify({ publicKey }) })
      await refreshUser()
      setState({ kind: "done", company: r.company })
    } catch (e) {
      // The account may exist even if this response was lost (the server answers 409 on a repeat).
      const s = await authService.api<{ company: string | null }>("/api/near/status").catch(() => null)
      if (s?.company) {
        await refreshUser()
        setState({ kind: "done", company: s.company })
      } else {
        setState({ kind: "error", message: e instanceof Error ? e.message : "Account creation failed.", retry: true })
      }
    }
  }

  const parts = [
    { Icon: KeyRound, t: "Company account", d: "Receives invoice payments. Its key is generated in this browser and never sent to SKYPay." },
    { Icon: Vault, t: "Operating vault", d: "A contract holding money the agent may spend. Only you can fund it, set limits or withdraw." },
    { Icon: ShieldCheck, t: "Agent key", d: "Can only call the vault's pay method, within your limits." },
  ]

  if (state.kind === "done") {
    return (
      <StepPanel title="Your NEAR account is ready" description="Back up the owner key now. It is the only way to manage the vault from another browser.">
        <div className="flex items-center gap-3 rounded-lg bg-success/10 p-4 text-sm text-success">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="min-w-0">Company account <span className="break-all font-mono">{state.company}</span></span>
        </div>
        <ol className="mt-6 grid gap-2 text-sm text-muted-foreground">
          <li><span className="font-semibold text-foreground">1. Download the backup file.</span> It holds the owner key; anyone with it controls the company account. SKYPay cannot recover it for you.</li>
          <li><span className="font-semibold text-foreground">2. Keep it somewhere safe</span> (password manager or offline). To use another browser, sign in there and import this file under Finance. SKYPay checks it is this company&apos;s key before saving it.</li>
        </ol>
        <div className="mt-6 grid gap-3">
          <button type="button" className={backedUp ? secondary : primary} onClick={() => setBackedUp(downloadOwnerKeyBackup(user!.id, state.company))}>
            <Download className="h-4 w-4" /> {backedUp ? "Key backup downloaded (download again)" : "Download owner key backup"}
          </button>
          <button type="button" className={backedUp ? primary : secondary} onClick={onDone} disabled={!backedUp}>Go to dashboard <ArrowRight className="h-4 w-4" /></button>
          {!backedUp && (
            <button type="button" className="text-sm text-muted-foreground underline" onClick={onDone}>
              Skip for now (Finance keeps reminding you until a backup is downloaded)
            </button>
          )}
        </div>
      </StepPanel>
    )
  }

  return (
    <StepPanel title="Create your NEAR company account" description="Free on testnet. SKYPay sponsors account creation and every network fee.">
      <ul className="grid gap-5">
        {parts.map(({ Icon, t, d }) => (
          <li key={t} className="flex gap-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
              {state.kind === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" strokeWidth={1.75} />}
            </span>
            <div>
              <p className="font-medium">{t}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-8 grid gap-3" aria-live="polite">
        {state.kind === "error" && (
          <ErrorBox>
            <p>{state.message}</p>
            {state.retry && <p className="mt-1 text-destructive/80">You can try again. Your browser key is kept, and setup continues with the accounts already created instead of making new ones.</p>}
          </ErrorBox>
        )}
        {state.kind === "working" && <p className="text-sm text-muted-foreground">Creating accounts on NEAR testnet. This takes about 30 seconds; keep this tab open.</p>}
        <button type="button" className={primary} onClick={state.kind === "error" && !state.retry ? check : create} disabled={state.kind === "working" || state.kind === "checking"}>
          {state.kind === "working" ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating accounts</>
            : state.kind === "checking" ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking</>
            : state.kind === "error" && !state.retry ? "Check again"
            : state.kind === "error" ? "Try again" : "Create NEAR account"}
        </button>
        <button type="button" className={secondary} onClick={onSkip} disabled={state.kind === "working"}>Skip for now</button>
      </div>
    </StepPanel>
  )
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthPageContent />
    </Suspense>
  )
}
