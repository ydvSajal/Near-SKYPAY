"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { authService } from "@/lib/auth"
import { fromBaseUnits } from "@/lib/near"
import { payWithWallet } from "@/lib/nearWallet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CheckCircle2, Clock, ExternalLink, CreditCard, AlertCircle, Loader2, Wallet } from "lucide-react"

interface PublicInvoice {
  id: string
  number: string
  merchant: string
  customerName: string | null
  description: string | null
  lineItems: Array<{ description: string; quantity: number; unitAmount: string; unitFormatted: string }>
  amount: string
  amountFormatted: string
  asset: string
  assetContract: string
  decimals: number
  network: string
  receiver: string
  dueDate: string
  createdAt: string
  status: "pending" | "paid" | "refunded" | "cancelled"
  settledAmount: string | null
  settledAt: string | null
  settledTxHash: string | null
  txUrl: string | null
  isTestToken: boolean
}

const card = "rounded-lg border border-slate-200 bg-white p-5"
const fmtDate = (s: string) => new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })

function StatusPill({ status }: { status: PublicInvoice["status"] }) {
  const meta = {
    pending: { c: "#fab219", t: "Awaiting payment", I: Clock },
    paid: { c: "#0ca30c", t: "Paid", I: CheckCircle2 },
    refunded: { c: "#2a78d6", t: "Refunded", I: CheckCircle2 },
    cancelled: { c: "#898781", t: "Cancelled", I: AlertCircle },
  }[status]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
      <meta.I className="h-3.5 w-3.5" style={{ color: meta.c }} />
      {meta.t}
    </span>
  )
}

interface SourceAsset { assetId: string; symbol: string; blockchain: string; decimals: number }
interface DryQuote {
  note: string
  source: SourceAsset
  destination: { recipient: string }
  amountInFormatted: string
  amountInUsd: string
  amountOutFormatted: string
  timeEstimateSec: number
  appFees: Array<{ fee: number }>
  deadline: string
  correlationId: string
}

// NEAR Intents 1Click price preview. Dry quote only: no deposit address, nothing can be paid from here.
function CrossChainQuote({ invoiceId, total }: { invoiceId: string; total: string }) {
  const [assets, setAssets] = useState<SourceAsset[]>([])
  const [asset, setAsset] = useState("")
  const [refundTo, setRefundTo] = useState("")
  const [quote, setQuote] = useState<DryQuote | null>(null)
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    authService
      .api<{ assets: SourceAsset[] }>("/api/public/intents/assets")
      .then((r) => {
        setAssets(r.assets)
        setAsset(r.assets.find((a) => a.blockchain === "base" && a.symbol === "USDC")?.assetId || r.assets[0]?.assetId || "")
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Cross-chain quotes unavailable"))
  }, [])

  const getQuote = async () => {
    setBusy(true)
    setErr("")
    setQuote(null)
    try {
      const r = await authService.api<{ quote: DryQuote }>(`/api/public/invoices/${invoiceId}/intents-quote`, {
        method: "POST",
        body: JSON.stringify({ originAsset: asset, refundTo: refundTo.trim() }),
      })
      setQuote(r.quote)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Quote failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs font-semibold text-slate-700">Pay from another chain · NEAR Intents (quote preview)</p>
      <p className="mt-1 text-xs text-slate-600">
        See what it would cost to deliver exactly {total} USDC on NEAR from another chain. This is a live 1Click <b>dry quote</b>:
        no deposit address is issued and nothing can be paid here. NEAR Intents has no testnet.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_auto]">
        <select
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          aria-label="Source asset"
          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          {assets.map((a) => (
            <option key={a.assetId} value={a.assetId}>
              {a.symbol} on {a.blockchain}
            </option>
          ))}
        </select>
        <Input placeholder="Your refund address on that chain" value={refundTo} onChange={(e) => setRefundTo(e.target.value)} />
        <Button onClick={getQuote} disabled={busy || !asset || !refundTo} variant="outline" size="sm" className="h-9 border-slate-300 bg-white">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Get quote"}
        </Button>
      </div>
      {quote && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 text-xs">
          <dt className="text-slate-500">You would send</dt>
          <dd className="tabular-nums">
            {quote.amountInFormatted} {quote.source.symbol} on {quote.source.blockchain} (~${Number(quote.amountInUsd).toFixed(2)})
          </dd>
          <dt className="text-slate-500">Merchant receives</dt>
          <dd className="tabular-nums">{quote.amountOutFormatted} USDC on NEAR</dd>
          <dt className="text-slate-500">Provider fee</dt>
          <dd>{quote.appFees.map((f) => `${f.fee / 100}%`).join(" + ") || "none"} (included above)</dd>
          <dt className="text-slate-500">Est. time</dt>
          <dd>~{quote.timeEstimateSec}s</dd>
          <dt className="text-slate-500">Quote expires</dt>
          <dd>{new Date(quote.deadline).toLocaleTimeString()}</dd>
          <dt className="text-slate-500">Reference</dt>
          <dd className="break-all font-mono">{quote.correlationId}</dd>
          <dd className="col-span-2 mt-1 text-slate-500">{quote.note}</dd>
        </dl>
      )}
      {err && <p className="mt-2 text-xs text-[#d03b3b]">{err}</p>}
    </div>
  )
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>()
  const [inv, setInv] = useState<PublicInvoice | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [txHash, setTxHash] = useState("")
  const [sender, setSender] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    try {
      setInv(await authService.api<PublicInvoice>(`/api/public/invoices/${id}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invoice not found")
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // keep status live while unpaid (also catches a payment made in another tab or wallet)
  useEffect(() => {
    if (inv?.status !== "pending") return
    const t = setInterval(load, 2000) // live: flips to Paid within 2 s of settlement
    return () => clearInterval(t)
  }, [inv?.status, load])

  const confirm = async () => {
    setBusy(true)
    setNotice("")
    try {
      await authService.api(`/api/public/invoices/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ txHash: txHash.trim(), senderAccountId: sender.trim() }),
      })
      await load()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Verification failed")
    } finally {
      setBusy(false)
    }
  }

  const demoPay = async () => {
    setBusy(true)
    setNotice("")
    try {
      await authService.api(`/api/public/invoices/${id}/demo-pay`, { method: "POST" })
      await load()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Demo payment failed")
    } finally {
      setBusy(false)
    }
  }

  // Redirect wallets return with ?transactionHashes=<hash>: verify it automatically, then clean the URL.
  useEffect(() => {
    if (inv?.status !== "pending") return
    const hash = new URLSearchParams(window.location.search).get("transactionHashes")?.split(",").pop()
    if (!hash) return
    window.history.replaceState(null, "", window.location.pathname)
    verify(hash, "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv?.status])

  async function verify(hash: string, from: string) {
    setBusy(true)
    setNotice("")
    try {
      await authService.api(`/api/public/invoices/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ txHash: hash, senderAccountId: from }),
      })
      await load()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Verification failed")
    } finally {
      setBusy(false)
    }
  }

  const walletPay = async () => {
    if (!inv) return
    setBusy(true)
    setNotice("")
    try {
      const { txHash, sender: from } = await payWithWallet(inv)
      await verify(txHash, from)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Wallet payment failed")
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className={`${card} max-w-md text-center`}>
          <AlertCircle className="mx-auto mb-2 h-5 w-5 text-[#d03b3b]" />
          <p className="text-sm text-slate-700">{error}</p>
        </div>
      </div>
    )
  }
  if (!inv) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  const tokenName = inv.isTestToken ? "tUSDC (testnet test token)" : inv.asset
  const net = inv.network.replace("near:", "NEAR ")

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
            <CreditCard className="h-4 w-4 text-white" />
          </span>
          <span className="text-lg font-semibold">SKYPay</span>
          <span className="ml-auto text-xs text-slate-500">Secure invoice · {net}</span>
        </div>

        <div className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Invoice {inv.number} from</p>
              <h1 className="text-xl font-semibold">{inv.merchant}</h1>
              {inv.customerName && <p className="mt-1 text-sm text-slate-500">Billed to {inv.customerName}</p>}
            </div>
            <StatusPill status={inv.status} />
          </div>

          {inv.description && <p className="mt-4 text-sm text-slate-600">{inv.description}</p>}

          <table className="mt-5 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Unit</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lineItems.map((li, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2">{li.description}</td>
                  <td className="py-2 text-right tabular-nums">{li.quantity}</td>
                  <td className="py-2 text-right tabular-nums">{li.unitFormatted}</td>
                  <td className="py-2 text-right tabular-nums">
                    {fromBaseUnits((BigInt(li.unitAmount) * BigInt(li.quantity)).toString(), inv.decimals)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex items-end justify-between">
            <div className="text-xs text-slate-500">
              <p>Issued {fmtDate(inv.createdAt)}</p>
              <p>Due {fmtDate(inv.dueDate)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Total due</p>
              <p className="text-2xl font-semibold tabular-nums">
                {inv.amountFormatted} <span className="text-base font-medium text-slate-500">{inv.asset}</span>
              </p>
            </div>
          </div>
        </div>

        {inv.status === "paid" ? (
          <div className={card}>
            <div className="flex items-center gap-2 text-[#0ca30c]">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-semibold">Payment verified on NEAR</p>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Received</dt>
              <dd className="tabular-nums">{fromBaseUnits(inv.settledAmount, inv.decimals)} {tokenName}</dd>
              <dt className="text-slate-500">Settled</dt>
              <dd>{inv.settledAt && new Date(inv.settledAt).toLocaleString()}</dd>
              <dt className="text-slate-500">Transaction</dt>
              <dd className="truncate">
                <a href={inv.txUrl || "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-[#2a78d6] hover:underline">
                  {inv.settledTxHash} <ExternalLink className="h-3 w-3" />
                </a>
              </dd>
            </dl>
            <p className="mt-3 text-xs text-slate-500">A receipt has been emailed. SkyPay checked the token contract, receiver and amount on-chain before marking this paid.</p>
          </div>
        ) : inv.status === "pending" ? (
          <div className={`${card} flex flex-col gap-4`}>
            <div>
              <p className="font-semibold">Pay this invoice</p>
              <p className="mt-1 text-sm text-slate-600">
                Connect your NEAR wallet and approve one transfer of <b className="tabular-nums">{inv.amountFormatted} {tokenName}</b> on {net}.
                SkyPay then verifies it on-chain and closes the invoice automatically; nothing can mark it paid without a real transfer.
              </p>
            </div>
            <Button onClick={walletPay} disabled={busy} className="h-11 bg-primary text-white">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Wallet className="mr-2 h-4 w-4" /> Connect wallet &amp; pay</>}
            </Button>
            {inv.isTestToken && (
              <p className="-mt-2 text-xs text-slate-500">
                Testnet: the transaction first mints you {inv.amountFormatted} test tUSDC (no value), then pays the invoice, so you only need a testnet account.
              </p>
            )}
            <details className="rounded-lg border border-slate-200 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-slate-700">Paid another way? Verify by transaction hash</summary>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <dt className="text-slate-500">Receiver</dt>
                <dd className="break-all font-mono">{inv.receiver}</dd>
                <dt className="text-slate-500">Token contract</dt>
                <dd className="break-all font-mono">{inv.assetContract}</dd>
                <dt className="text-slate-500">Memo</dt>
                <dd className="font-mono">{inv.number}</dd>
              </dl>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input placeholder="Your NEAR account (sender)" value={sender} onChange={(e) => setSender(e.target.value)} />
                <Input placeholder="Transaction hash" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
                <Button onClick={confirm} disabled={busy || !txHash || !sender} className="bg-primary text-white">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify payment"}
                </Button>
              </div>
            </details>

            {inv.isTestToken && (
              <div className="rounded-lg border border-dashed border-[#fab219] bg-[#fab219]/5 p-3">
                <p className="text-xs font-semibold text-slate-700">Testnet demo</p>
                <p className="mt-1 text-xs text-slate-600">
                  No testnet wallet? SkyPay&apos;s demo payer will send a <b>real testnet transaction</b> of the test token (no monetary value),
                  and the invoice is then verified exactly like any other payment.
                </p>
                <Button onClick={demoPay} disabled={busy} variant="outline" size="sm" className="mt-2 border-slate-300 bg-white">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Pay with testnet demo wallet"}
                </Button>
              </div>
            )}

            <CrossChainQuote invoiceId={inv.id} total={inv.amountFormatted} />
            {notice && <p className="text-sm text-[#d03b3b]">{notice}</p>}
          </div>
        ) : (
          <div className={card}>
            <p className="text-sm text-slate-600">This invoice is {inv.status}.</p>
          </div>
        )}
      </div>
    </div>
  )
}
