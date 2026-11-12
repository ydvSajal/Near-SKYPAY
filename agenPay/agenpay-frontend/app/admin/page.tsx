"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Loader2, Trash2, RefreshCw } from "lucide-react"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
const TOKEN_KEY = "adminToken"

type User = {
  id: string; email: string; name: string | null
  walletAddress: string | null; externalWalletAddress: string | null
  notionWorkspaceId: string | null; createdAt: string
  _count: { transactions: number; paymentRequests: number }
}
type ConfigEntry = { id: string; key: string; value: string; description: string | null; updatedAt: string }
type Admin = { id: string; email: string; createdAt: string }

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null
}

async function adminFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_BASE_URL}/api/admin${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() || ""}`,
      ...(opts.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!getToken()) { setChecking(false); return }
    adminFetch("/me").then(() => setAuthed(true)).catch(() => localStorage.removeItem(TOKEN_KEY)).finally(() => setChecking(false))
  }, [])

  if (checking) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }
  return authed ? <Dashboard onLogout={() => { localStorage.removeItem(TOKEN_KEY); setAuthed(false) }} /> : <Login onLogin={() => setAuthed(true)} />
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(""); setLoading(true)
    try {
      const data = await adminFetch("/login", { method: "POST", body: JSON.stringify({ email, password }) })
      localStorage.setItem(TOKEN_KEY, data.token)
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>Admin Portal</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Admin Portal</h1>
          <Button variant="outline" onClick={onLogout}>Log out</Button>
        </div>
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="config">API / Config</TabsTrigger>
            <TabsTrigger value="admins">Admins</TabsTrigger>
          </TabsList>
          <TabsContent value="users"><UsersPanel /></TabsContent>
          <TabsContent value="config"><ConfigPanel /></TabsContent>
          <TabsContent value="admins"><AdminsPanel /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function useList<T>(path: string, extract: (d: Record<string, unknown>) => T[]) {
  const [items, setItems] = useState<T[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError("")
    try { setItems(extract(await adminFetch(path))) }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to load") }
    finally { setLoading(false) }
  }, [path, extract])
  useEffect(() => { load() }, [load])
  return { items, error, loading, reload: load, setError }
}

function PanelShell({ title, error, loading, onReload, children }: {
  title: string; error: string; loading: boolean; onReload: () => void; children: React.ReactNode
}) {
  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{title}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onReload}><RefreshCw className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent>
        {error && <Alert variant="destructive" className="mb-4"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : children}
      </CardContent>
    </Card>
  )
}

const extractUsers = (d: Record<string, unknown>) => d.users as User[]
function UsersPanel() {
  const { items, error, loading, reload, setError } = useList<User>("/users", extractUsers)
  async function del(id: string, email: string) {
    if (!confirm(`Delete ${email} and all their data? This cannot be undone.`)) return
    try { await adminFetch(`/users/${id}`, { method: "DELETE" }); reload() }
    catch (err) { setError(err instanceof Error ? err.message : "Delete failed") }
  }
  return (
    <PanelShell title={`Users (${items.length})`} error={error} loading={loading} onReload={reload}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500">
            <th className="py-2 pr-4">Email</th><th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Wallet</th><th className="py-2 pr-4">Txns</th>
            <th className="py-2 pr-4">Joined</th><th></th>
          </tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2 pr-4">{u.email}</td>
                <td className="py-2 pr-4">{u.name || "—"}</td>
                <td className="py-2 pr-4 font-mono text-xs">{(u.walletAddress || u.externalWalletAddress || "—").slice(0, 10)}</td>
                <td className="py-2 pr-4">{u._count.transactions}</td>
                <td className="py-2 pr-4">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="py-2"><Button variant="ghost" size="sm" onClick={() => del(u.id, u.email)}><Trash2 className="h-4 w-4 text-red-600" /></Button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="py-4 text-slate-400">No users</td></tr>}
          </tbody>
        </table>
      </div>
    </PanelShell>
  )
}

const extractConfig = (d: Record<string, unknown>) => d.config as ConfigEntry[]
function ConfigPanel() {
  const { items, error, loading, reload, setError } = useList<ConfigEntry>("/config", extractConfig)
  const [key, setKey] = useState("")
  const [value, setValue] = useState("")
  const [desc, setDesc] = useState("")

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!key) return
    try {
      await adminFetch(`/config/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value, description: desc || undefined }) })
      setKey(""); setValue(""); setDesc(""); reload()
    } catch (err) { setError(err instanceof Error ? err.message : "Save failed") }
  }
  async function del(k: string) {
    if (!confirm(`Delete config "${k}"?`)) return
    try { await adminFetch(`/config/${encodeURIComponent(k)}`, { method: "DELETE" }); reload() }
    catch (err) { setError(err instanceof Error ? err.message : "Delete failed") }
  }
  return (
    <PanelShell title={`Config (${items.length})`} error={error} loading={loading} onReload={reload}>
      <Alert className="mb-4"><AlertCircle className="h-4 w-4" /><AlertDescription>
        Stored in the database. The running agent reads live provider keys from environment variables, so changes here are for reference/config until wired to env.
      </AlertDescription></Alert>
      <form onSubmit={save} className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Input placeholder="key" value={key} onChange={(e) => setKey(e.target.value)} />
        <Input placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
        <Input placeholder="description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <Button type="submit">Save</Button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500">
            <th className="py-2 pr-4">Key</th><th className="py-2 pr-4">Value</th><th className="py-2 pr-4">Description</th><th></th>
          </tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-2 pr-4 font-mono text-xs">{c.key}</td>
                <td className="py-2 pr-4 font-mono text-xs break-all">{c.value}</td>
                <td className="py-2 pr-4 text-slate-500">{c.description || "—"}</td>
                <td className="py-2"><Button variant="ghost" size="sm" onClick={() => del(c.key)}><Trash2 className="h-4 w-4 text-red-600" /></Button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={4} className="py-4 text-slate-400">No config entries</td></tr>}
          </tbody>
        </table>
      </div>
    </PanelShell>
  )
}

const extractAdmins = (d: Record<string, unknown>) => d.admins as Admin[]
function AdminsPanel() {
  const { items, error, loading, reload, setError } = useList<Admin>("/admins", extractAdmins)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  async function add(e: React.FormEvent) {
    e.preventDefault()
    try {
      await adminFetch("/admins", { method: "POST", body: JSON.stringify({ email, password }) })
      setEmail(""); setPassword(""); reload()
    } catch (err) { setError(err instanceof Error ? err.message : "Add failed") }
  }
  async function del(id: string, em: string) {
    if (!confirm(`Remove admin ${em}?`)) return
    try { await adminFetch(`/admins/${id}`, { method: "DELETE" }); reload() }
    catch (err) { setError(err instanceof Error ? err.message : "Delete failed") }
  }
  return (
    <PanelShell title={`Admins (${items.length})`} error={error} loading={loading} onReload={reload}>
      <form onSubmit={add} className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input type="email" placeholder="new admin email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input type="password" placeholder="password (min 8)" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Button type="submit">Add admin</Button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500">
            <th className="py-2 pr-4">Email</th><th className="py-2 pr-4">Added</th><th></th>
          </tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b">
                <td className="py-2 pr-4">{a.email}</td>
                <td className="py-2 pr-4">{new Date(a.createdAt).toLocaleDateString()}</td>
                <td className="py-2"><Button variant="ghost" size="sm" onClick={() => del(a.id, a.email)}><Trash2 className="h-4 w-4 text-red-600" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  )
}
