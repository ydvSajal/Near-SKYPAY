"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { OnboardingShell, StepPanel } from "@/components/onboarding/shell"
import { Database, CheckCircle, AlertCircle, ArrowRight, Loader2 } from "lucide-react"

function NotionCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshUser } = useAuth()
  const refreshUserRef = useRef(refreshUser)
  const hasHandledCallback = useRef(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing')
  const [error, setError] = useState("")

  useEffect(() => {
    refreshUserRef.current = refreshUser
  }, [refreshUser])

  useEffect(() => {
    if (hasHandledCallback.current) {
      return
    }
    hasHandledCallback.current = true

    let isMounted = true

    const handleNotionCallback = async () => {
      try {
        const success = searchParams.get('success')
        const error = searchParams.get('error')
        const processing = searchParams.get('processing')
        const userId = searchParams.get('userId')
        const token = searchParams.get('token')

        // Handle OAuth errors
        if (error) {
          if (!isMounted) return
          setStatus('error')
          setError(`Notion OAuth error: ${decodeURIComponent(error)}`)
          return
        }

        // Handle processing state - show loading and poll for completion
        if (processing === 'true' && userId) {
          if (!isMounted) return
          setStatus('processing')
          
          // Store auth token if provided
          if (token) {
            authService.setToken(token)
            console.log('✅ Auth token stored, user re-authenticated')
          }
          
          // Poll for workspace setup completion using public endpoint
          pollIntervalRef.current = setInterval(async () => {
            try {
              const currentToken = authService.getToken()
              const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/workspace-status/${userId}`, {
                headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {},
              })
              const data = await response.json()
              
              if (data.success && data.workspaceReady) {
                if (pollIntervalRef.current) {
                  clearInterval(pollIntervalRef.current)
                  pollIntervalRef.current = null
                }
                if (!isMounted) return
                // Workspace setup complete, refresh user and redirect to NEAR account setup
                await refreshUserRef.current()
                router.push('/auth/login?step=near')
              }
            } catch {
              console.log('Still setting up workspace...')
            }
          }, 2000) // Poll every 2 seconds

          // Timeout after 30 seconds
          timeoutRef.current = setTimeout(() => {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current)
              pollIntervalRef.current = null
            }
            if (!isMounted) return
            // Redirect to NEAR account setup anyway after timeout
            router.push('/auth/login?step=near')
          }, 30000)
          
          return
        }

        // Handle success
        if (success === 'true') {
          if (!isMounted) return
          setStatus('success')
          
          // Store auth token if provided
          if (token) {
            authService.setToken(token)
          }
          
          await refreshUserRef.current() // Refresh user data to show Notion integration
          
          // Automatically redirect to NEAR account setup setup
          timeoutRef.current = setTimeout(() => {
            if (!isMounted) return
            router.push('/auth/login?step=near')
          }, 2000)
        } else {
          if (!isMounted) return
          // No valid parameters - redirect to login
          router.push('/auth/login?step=notion')
        }
      } catch (err) {
        if (!isMounted) return
        setStatus('error')
        setError('An unexpected error occurred during Notion authentication')
        console.error('Notion callback error:', err)
      }
    }

    handleNotionCallback()

    return () => {
      isMounted = false
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [searchParams, router])

  const handleRetry = () => {
    router.push('/auth/login?step=notion')
  }



  if (status === 'processing') {
    return (
      <OnboardingShell step="notion">
        <StepPanel title="Setting up your Notion workspace" description="Creating the SKYPay page and payment databases. This usually takes 10 to 15 seconds.">
          <div role="status" className="grid gap-3">
            {[72, 56, 64].map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                <span className="skeleton h-3" style={{ width: `${w}%` }} />
              </div>
            ))}
            <span className="sr-only">Setting up your Notion workspace</span>
          </div>
        </StepPanel>
      </OnboardingShell>
    )
  }

  if (status === 'success') {
    return (
      <OnboardingShell step="notion">
        <StepPanel title="Notion is connected" description="Next, create your NEAR company account. Redirecting in a moment.">
          <ul className="grid gap-3">
            {['SKYPay workspace page', 'Incoming payment requests database', 'Outgoing payments database', 'All transactions database'].map((t) => (
              <li key={t} className="flex gap-3"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />{t}</li>
            ))}
          </ul>
          <button type="button" onClick={() => router.push('/auth/login?step=near')} className="press mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Continue to NEAR account setup <ArrowRight className="h-4 w-4" />
          </button>
        </StepPanel>
      </OnboardingShell>
    )
  }

  if (status === 'error') {
    return (
      <OnboardingShell step="notion">
        <StepPanel title="Notion connection failed" description="You can try again, or continue without Notion and connect it later from the dashboard.">
          <div role="alert" className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </div>
          <div className="mt-8 grid gap-3">
            <button type="button" onClick={handleRetry} className="press inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Database className="h-4 w-4" /> Try again
            </button>
            <button type="button" onClick={() => router.push('/auth/login?step=near')} className="press inline-flex h-11 w-full items-center justify-center rounded-lg border border-border bg-card px-5 text-sm font-medium hover:bg-muted">
              Continue without Notion
            </button>
          </div>
        </StepPanel>
      </OnboardingShell>
    )
  }

  return null
}

export default function NotionCallbackPage() {
  return (
    <Suspense fallback={null}>
      <NotionCallbackContent />
    </Suspense>
  )
}
