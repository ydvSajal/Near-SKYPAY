export interface User {
  id: string
  email: string
  name: string
  hasNotionIntegration?: boolean
  hasNearAccount?: boolean
  companyName?: string | null
  companyAddress?: string | null
  country?: string | null
  taxId?: string | null
  invoiceNotes?: string | null
}

export interface AuthResponse {
  success: boolean
  token?: string
  user?: User
  error?: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface NotionOAuthResponse {
  success: boolean
  authUrl?: string
  error?: string
}

const LOCAL_API_BASE_URL = 'http://localhost:3001'
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || LOCAL_API_BASE_URL

class AuthService {
  private token: string | null = null
  private initialized = false
  private readonly inFlightGetRequests = new Map<string, Promise<unknown>>()

  private shouldUseLocalFallback() {
    if (typeof window === 'undefined') return false
    const host = window.location.hostname
    const isLocalHost = host === 'localhost' || host === '127.0.0.1'
    return isLocalHost && API_BASE_URL !== LOCAL_API_BASE_URL
  }

  constructor() {
    // Don't initialize token on server side to prevent hydration issues
    // Token will be initialized when first accessed on client side
  }

  private initializeToken() {
    if (this.initialized || typeof window === 'undefined') return
    
    this.token = this.getTokenFromCookie()
    this.initialized = true
    console.log('🔧 Auth service initialized on client side')
  }

  private getTokenFromCookie(): string | null {
    if (typeof document === 'undefined') return null
    
    try {
      const cookies = document.cookie.split(';')
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=')
        if (name === 'token' && value) {
          console.log('🍪 Token found in cookie')
          return decodeURIComponent(value)
        }
      }
      console.log('🍪 No token found in cookies')
      return null
    } catch (error) {
      console.error('❌ Error reading token from cookie:', error)
      return null
    }
  }

  private setTokenCookie(token: string) {
    if (typeof document === 'undefined') return
    
    try {
      // Set cookie with 7 days expiry
      const expires = new Date()
      expires.setDate(expires.getDate() + 7)
      const secureAttribute = window.location.protocol === 'https:' ? '; Secure' : ''
      const cookieValue = `token=${encodeURIComponent(token)}; expires=${expires.toUTCString()}; path=/; SameSite=Strict${secureAttribute}`
      document.cookie = cookieValue
      console.log('🍪 Token cookie set successfully')
    } catch (error) {
      console.error('❌ Error setting token cookie:', error)
    }
  }

  private removeTokenCookie() {
    if (typeof document === 'undefined') return
    
    try {
      const expiredCookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; Max-Age=0; path=/; SameSite=Strict'
      document.cookie = expiredCookie
      if (window.location.protocol === 'https:') {
        document.cookie = `${expiredCookie}; Secure`
      }
      console.log('🍪 Token cookie removed successfully')
    } catch (error) {
      console.error('❌ Error removing token cookie:', error)
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Initialize token if not already done
    this.initializeToken()
    
    const url = `${API_BASE_URL}${endpoint}`
    
    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...(this.token && { Authorization: `Bearer ${this.token}` }),
        ...options.headers,
      },
      ...options,
    }

    const method = (config.method || 'GET').toUpperCase()
    const getRequestKey = method === 'GET' ? `${method}:${endpoint}` : null

    if (getRequestKey) {
      const pendingRequest = this.inFlightGetRequests.get(getRequestKey)
      if (pendingRequest) {
        return pendingRequest as Promise<T>
      }
    }

    const executeRequest = async (): Promise<T> => {
      try {
        let response: Response

        try {
          response = await fetch(url, config)
        } catch (error) {
          if (!this.shouldUseLocalFallback()) {
            throw error
          }

          const fallbackUrl = `${LOCAL_API_BASE_URL}${endpoint}`
          console.warn(`Primary API unreachable, retrying with local backend: ${fallbackUrl}`)
          response = await fetch(fallbackUrl, config)
        }

        let data: unknown = null
        try {
          data = await response.json()
        } catch {
          data = null
        }

        if (!response.ok) {
          const errorMessage =
            (typeof data === 'object' && data !== null && 'error' in data
              ? (data as { error?: string }).error
              : undefined) ||
            `HTTP error! status: ${response.status}`

          // Stale/expired token (e.g. JWT from an old database): clear it so the
          // app falls back to logged-out instead of looping on 401s.
          if (response.status === 401 || response.status === 403) {
            this.removeToken()
          }
          throw new Error(errorMessage)
        }

        return data as T
      } catch (error) {
        // Expected for logged-out / expired sessions — warn (not error) so it
        // doesn't surface as a Next.js dev error overlay.
        console.warn(`API request failed: ${endpoint}`, error instanceof Error ? error.message : error)
        throw error
      }
    }

    const requestPromise = executeRequest()

    if (getRequestKey) {
      this.inFlightGetRequests.set(getRequestKey, requestPromise)
      requestPromise.finally(() => {
        this.inFlightGetRequests.delete(getRequestKey)
      })
    }

    return requestPromise
  }

  async register(email: string, password: string, name: string): Promise<AuthResponse> {
    try {
      const response = await this.request<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      })

      if (response.success && response.token) {
        this.token = response.token
        this.setTokenCookie(response.token)
        this.initialized = true // Mark as initialized after successful registration
      }

      return response
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      }
    }
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    try {
      const response = await this.request<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })

      if (response.success && response.token) {
        this.token = response.token
        this.setTokenCookie(response.token)
        this.initialized = true // Mark as initialized after successful login
      }

      return response
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Login failed',
      }
    }
  }

  async getNotionAuthUrl(): Promise<NotionOAuthResponse> {
    try {
      const response = await this.request<NotionOAuthResponse>('/api/notion/auth-url', {
        method: 'GET',
      })

      return response
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get Notion auth URL',
      }
    }
  }

  /** Current user, used to restore the session on page load. */
  async getMe(): Promise<ApiResponse<{ user: User }>> {
    try {
      return await this.request<ApiResponse<{ user: User }>>('/api/me')
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to load user' }
    }
  }

  async startAgent(intervalMinutes: number = 10): Promise<ApiResponse> {
    try {
      const response = await this.request<ApiResponse>('/api/agent/start', {
        method: 'POST',
        body: JSON.stringify({ intervalMinutes }),
      })

      return response
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start agent',
      }
    }
  }

  async stopAgent(): Promise<ApiResponse> {
    try {
      const response = await this.request<ApiResponse>('/api/agent/stop', {
        method: 'POST',
      })

      return response
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop agent',
      }
    }
  }

  async processPayment(message: string, threadId?: string): Promise<ApiResponse> {
    try {
      const response = await this.request<ApiResponse>('/api/agent/process', {
        method: 'POST',
        body: JSON.stringify({ message, threadId }),
      })

      return response
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Payment processing failed',
      }
    }
  }

  setToken(token: string) {
    this.token = token
    this.setTokenCookie(token)
    this.initialized = true
  }

  /** Generic JSON call to the SkyPay API (throws with the server's error message). */
  api<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, options)
  }

  get apiBaseUrl(): string {
    return API_BASE_URL
  }

  getToken(): string | null {
    // Initialize token if not already done
    this.initializeToken()
    return this.token
  }

  removeToken() {
    console.log('🗑️ Removing auth token')
    this.token = null
    this.removeTokenCookie()
    this.initialized = true // Keep initialized but with null token
    console.log('✅ Token removed successfully')
  }

  isAuthenticated(): boolean {
    // Initialize token if not already done
    this.initializeToken()
    return !!this.token
  }

  logout() {
    console.log('🚪 Logging out and redirecting')
    this.removeToken()
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login'
    }
  }
}

export const authService = new AuthService()
export default authService 