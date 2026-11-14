// "Is the company ready to get paid and pay people?" One row per account/precondition, each with what to do next.
// Every row comes from live chain reads via /api/near/status; nothing here is a stored flag except the backup reminder.
import { AlertCircle, CheckCircle2, CircleDashed } from "lucide-react"

export interface Readiness {
  isTestToken: boolean
  tokenShort: string
  companyBalance: number
  vaultAvailable: number
  keyState: "ok" | "missing" | "wrong"
  backupSaved: boolean
  agentPolicy: { revoked: boolean; expires_at_ms: number } | null | undefined
  agentKey?: { present: boolean; allowanceNear: string | null; low: boolean }
  vaultStorage?: { freeNear: string; approxPaymentsLeft: string }
  sponsor?: { account: string; balanceNear: string; low: boolean } | null
}

type Row = { label: string; state: "ok" | "todo" | "problem"; detail: string }

export function rows(r: Readiness): Row[] {
  const out: Row[] = []
  out.push(r.keyState === "ok"
    ? { label: "Owner key in this browser", state: "ok", detail: "Matches the company's registered owner key." }
    : r.keyState === "wrong"
      ? { label: "Owner key in this browser", state: "problem", detail: "The key here is NOT this company's owner key. Import the correct backup below; owner actions will be refused until then." }
      : { label: "Owner key in this browser", state: "todo", detail: "Import your key backup below to fund the vault, set limits or approve suppliers." })
  out.push(r.backupSaved
    ? { label: "Key backup", state: "ok", detail: "Downloaded from this browser. Keep it offline or in a password manager." }
    : { label: "Key backup", state: r.keyState === "ok" ? "problem" : "todo", detail: "Not downloaded from this browser yet. Without it, losing this browser means losing control of the company account. Vault tab: Download key backup." })
  out.push(r.companyBalance > 0
    ? { label: "Receiving account (collected funds)", state: "ok", detail: `${r.companyBalance.toFixed(2)} ${r.tokenShort} in your receiving account (where client payments land). The agent cannot spend it until you move some into the vault.` }
    : { label: "Receiving account (collected funds)", state: "todo", detail: r.isTestToken ? "Empty. Get paid on an invoice, or mint test tokens (Vault tab)." : "Empty. Client invoice payments land here." })
  out.push(r.vaultAvailable > 0
    ? { label: "Vault (allocated operating funds)", state: "ok", detail: `${r.vaultAvailable.toFixed(2)} ${r.tokenShort} the agent may spend within its limits.` }
    : { label: "Vault (allocated operating funds)", state: "todo", detail: "Empty. Fund it from the receiving account (Vault tab) before paying anyone." })
  const p = r.agentPolicy
  out.push(!p
    ? { label: "Agent spending policy", state: "todo", detail: "Not authorized yet. Set per-payment and daily limits (Vault tab)." }
    : p.revoked
      ? { label: "Agent spending policy", state: "problem", detail: "Revoked: every agent payment is refused on chain. Set limits again in the Vault tab to turn it back on." }
      : p.expires_at_ms < Date.now()
        ? { label: "Agent spending policy", state: "problem", detail: "Expired. Renew it in the Vault tab, step: Set the agent's limits." }
        : { label: "Agent spending policy", state: "ok", detail: `Active until ${new Date(p.expires_at_ms).toLocaleDateString()}.` })
  if (r.agentKey) {
    out.push(!r.agentKey.present
      ? { label: "Agent gas allowance", state: "problem", detail: "The agent's restricted pay key is missing; agent payments cannot be sent." }
      : r.agentKey.low
        ? { label: "Agent gas allowance", state: "problem", detail: `${r.agentKey.allowanceNear} NEAR left on the agent's pay-only key. Sending NEAR to the agent account does not refill it; a replacement agent key is needed soon.` }
        : { label: "Agent gas allowance", state: "ok", detail: `${r.agentKey.allowanceNear ?? "unlimited"} NEAR of gas left on the pay-only key (each payment uses a tiny fraction).` })
  }
  if (r.vaultStorage) {
    const left = Number(r.vaultStorage.approxPaymentsLeft)
    out.push({ label: "Vault storage reserve", state: left < 20 ? "problem" : "ok",
      detail: `${r.vaultStorage.freeNear} NEAR free, roughly ${left} more payment records. Anyone can top it up with a plain NEAR transfer to the vault account.` })
  }
  if (r.sponsor !== undefined) {
    out.push(!r.sponsor
      ? { label: "SKYPay gas sponsor", state: "problem", detail: "Unavailable. Owner actions and setup cannot be sponsored right now." }
      : { label: "SKYPay gas sponsor", state: r.sponsor.low ? "problem" : "ok",
        detail: `${r.sponsor.balanceNear} NEAR on ${r.sponsor.account}. It pays gas for your owner actions; you never buy NEAR.${r.sponsor.low ? " Running low: ask the SKYPay operator to top it up." : ""}` })
  }
  return out
}

export function ReadinessPanel(props: Readiness) {
  const list = rows(props)
  const open = list.filter((x) => x.state !== "ok").length
  return (
    <details open={open > 0} className="rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-3">
        <span className="font-bold">Readiness</span>
        <span className="text-sm text-muted-foreground">
          {open ? `${open} item${open > 1 ? "s" : ""} need attention` : "Everything is ready"}
          {props.isTestToken && " · tUSDC is a testnet test token with no monetary value"}
        </span>
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {list.map((x) => (
          <li key={x.label} className="flex gap-3 px-5 py-2.5">
            {x.state === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              : x.state === "problem" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">{x.label}</p>
              <p className="text-sm text-muted-foreground">{x.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}
