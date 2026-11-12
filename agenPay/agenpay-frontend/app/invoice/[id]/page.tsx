"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { authService } from "@/lib/auth"
import { fromBaseUnits } from "@/lib/near"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CheckCircle2, Clock, ExternalLink, CreditCard, AlertCircle, Loader2 } from "lucide-react"

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

  // keep status live while unpaid
  useEffect(() => {
    if (inv?.status !== "pending") return
    const t = setInterval(load, 8000)
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
                Send exactly <b className="tabular-nums">{inv.amountFormatted} {tokenName}</b> on {net} to the merchant account below,
                then paste the transaction hash. SkyPay verifies it on-chain; nothing here can mark the invoice paid without a real transfer.
              </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <dt className="text-slate-500">Receiver</dt>
              <dd className="break-all font-mono">{inv.receiver}</dd>
              <dt className="text-slate-500">Token contract</dt>
              <dd className="break-all font-mono">{inv.assetContract}</dd>
              <dt className="text-slate-500">Memo</dt>
              <dd className="font-mono">{inv.number}</dd>
            </dl>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input placeholder="Your NEAR account (sender)" value={sender} onChange={(e) => setSender(e.target.value)} />
              <Input placeholder="Transaction hash" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
              <Button onClick={confirm} disabled={busy || !txHash || !sender} className="bg-primary text-white">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify payment"}
              </Button>
            </div>

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

            <p className="text-xs text-slate-500">
              Paying from another chain (NEAR Intents) is planned for mainnet and is not enabled on this testnet invoice.
            </p>
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
