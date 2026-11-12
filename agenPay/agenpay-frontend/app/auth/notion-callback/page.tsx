"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { authService } from "@/lib/auth"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Database,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ArrowRight
} from "lucide-react"

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
                // Workspace setup complete, refresh user and redirect to wallet
                await refreshUserRef.current()
                router.push('/auth/login?step=wallet')
              }
            } catch (err) {
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
            // Redirect to wallet anyway after timeout
            router.push('/auth/login?step=wallet')
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
          
          // Automatically redirect to wallet setup
          timeoutRef.current = setTimeout(() => {
            if (!isMounted) return
            router.push('/auth/login?step=wallet')
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
      <div className="min-h-screen bg-[radial-gradient(circle_at_12%_-8%,#ffdcbc_0%,#fffaf4_40%,#f2faf6_68%,#d6efe1_100%)] flex items-center justify-center p-4 text-slate-900">
        <Card className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white/65 shadow-[0_24px_80px_rgba(154,52,18,0.14)] backdrop-blur-2xl">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/30">
                <RefreshCw className="h-8 w-8 text-white animate-spin" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Setting Up Your Notion Workspace
              </h2>
              <p className="text-gray-600 mb-4">
                Creating your payment tracking databases and workspace...
              </p>
              <div className="text-sm text-gray-500">
                This may take 10-15 seconds
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_12%_-8%,#ffdcbc_0%,#fffaf4_40%,#f2faf6_68%,#d6efe1_100%)] flex items-center justify-center p-4 text-slate-900">
        <Card className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white/65 shadow-[0_24px_80px_rgba(154,52,18,0.14)] backdrop-blur-2xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-br from-green-600 to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <CheckCircle className="h-8 w-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-green-900">
              Workspace Created Successfully!
            </CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <h3 className="font-semibold text-green-900 mb-2">Created in your Notion:</h3>
              <ul className="space-y-1 text-sm text-green-800">
                <li>✅ AgenPay Workspace Page</li>
                <li>✅ Incoming Payment Requests Database</li>
                <li>✅ Outgoing Scheduled Payments Database</li>
                <li>✅ All Transactions Database</li>
              </ul>
            </div>

            <div className="text-center">
              <p className="text-gray-600 mb-4">
                Redirecting to wallet setup...
              </p>
              <Button onClick={() => router.push('/auth/login?step=wallet')} className="w-full">
                <ArrowRight className="mr-2 h-4 w-4" />
                Continue to Wallet Setup
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_12%_-8%,#ffdcbc_0%,#fffaf4_40%,#f2faf6_68%,#d6efe1_100%)] flex items-center justify-center p-4 text-slate-900">
        <Card className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white/65 shadow-[0_24px_80px_rgba(154,52,18,0.14)] backdrop-blur-2xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-r from-red-600 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-red-500/25">
              <AlertCircle className="h-8 w-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-red-900">
              Connection Failed
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>

            <div className="space-y-3">
              <Button onClick={handleRetry} className="w-full">
                <Database className="mr-2 h-4 w-4" />
                Try Again
              </Button>

              <Button
                variant="outline"
                onClick={() => router.push('/auth/login')}
                className="w-full"
              >
                Back to Login
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
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
