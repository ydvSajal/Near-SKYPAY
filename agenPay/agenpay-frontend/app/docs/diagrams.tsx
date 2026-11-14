// Docs diagrams: plain inline SVG, no chart library. Colours come from the product tokens so they match the app.
type Tone = "neutral" | "primary" | "ok" | "bad"

const TONE: Record<Tone, string> = {
  neutral: "fill-white stroke-slate-300",
  primary: "fill-primary/10 stroke-primary",
  ok: "fill-emerald-50 stroke-emerald-600",
  bad: "fill-red-50 stroke-red-500",
}

function Svg({ w, h, label, children }: { w: number; h: number; label: string; children: React.ReactNode }) {
  return (
    <figure className="my-8 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="mx-auto h-auto w-full min-w-[640px]">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="fill-slate-500" />
          </marker>
        </defs>
        {children}
      </svg>
    </figure>
  )
}

function Box({ x, y, w, h, title, sub, tone = "neutral" }: { x: number; y: number; w: number; h: number; title: string; sub?: string; tone?: Tone }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={12} strokeWidth={2} className={TONE[tone]} />
      <text x={x + w / 2} y={sub ? y + h / 2 - 4 : y + h / 2 + 6} textAnchor="middle" className="fill-slate-900 text-[20px] font-semibold">
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 19} textAnchor="middle" className="fill-slate-600 text-[15.5px]">
          {sub}
        </text>
      )}
    </g>
  )
}

function Line({ d, dashed }: { d: string; dashed?: boolean }) {
  return <path d={d} fill="none" strokeWidth={2} strokeDasharray={dashed ? "6 5" : undefined} markerEnd="url(#arr)" className="stroke-slate-500" />
}

function Tag({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <text x={x} y={y} textAnchor="middle" className="fill-slate-600 text-[16px] font-medium">
      {children}
    </text>
  )
}

/** Who holds what: browser, server, and the three NEAR accounts. */
export function ArchitectureDiagram() {
  return (
    <Svg w={900} h={420} label="SkyPay architecture: your browser, the SkyPay server, a sponsor relayer, Notion, and three NEAR accounts">
      <rect x={600} y={14} width={286} height={392} rx={16} strokeWidth={2} strokeDasharray="8 6" className="fill-slate-50 stroke-slate-300" />
      <text x={620} y={40} className="fill-slate-600 text-[17px] font-semibold">NEAR testnet</text>
      <Box x={14} y={160} w={200} h={100} title="Your browser" sub="owner key made here" tone="primary" />
      <Box x={300} y={160} w={210} h={100} title="SkyPay server" sub="invoices · agent · exports" />
      <Box x={300} y={30} w={210} h={80} title="Sponsor relayer" sub="pays the gas" />
      <Box x={300} y={310} w={210} h={80} title="Notion" sub="rows ⇄ pay links" />
      <Box x={630} y={56} w={230} h={80} title="Company account" sub="receives your money" />
      <Box x={630} y={166} w={230} h={90} title="Operating vault" sub="limits · payee list" tone="primary" />
      <Box x={630} y={296} w={230} h={80} title="Agent account" sub="key can only call vault.pay" />
      <Line d="M214 210 H300" />
      <Tag x={257} y={198}>signed</Tag>
      <Line d="M405 160 V110" />
      <Line d="M510 70 H570 V96 H630" />
      <Line d="M510 210 H570 V211 H630" />
      <Line d="M405 260 V310" />
      <Line d="M745 296 V256" />
      <Tag x={800} y={282}>pay only</Tag>
    </Svg>
  )
}

/** The four things provisioning does, in order. */
export function SetupDiagram() {
  const steps = [
    { t: "1  Owner key", s: "made in your browser" },
    { t: "2  Company", s: "account, sponsored" },
    { t: "3  Vault", s: "deployed, keys deleted" },
    { t: "4  Agent key", s: "allowed to call pay only" },
  ]
  return (
    <Svg w={900} h={150} label="Setup in four steps: owner key, company account, vault, agent key">
      {steps.map((s, i) => (
        <g key={s.t}>
          <Box x={10 + i * 224} y={30} w={190} h={90} title={s.t} sub={s.s} tone={i === 0 ? "primary" : "neutral"} />
          {i < 3 && <Line d={`M${200 + i * 224} 75 H${234 + i * 224}`} />}
        </g>
      ))}
    </Svg>
  )
}

/** What the vault contract checks before money leaves. */
export function GuardrailDiagram() {
  const checks = [
    { t: "Payee approved?", s: "on the allowlist" },
    { t: "Payment limit?", s: "owner-set cap" },
    { t: "Daily limit?", s: "owner-set cap" },
  ]
  return (
    <Svg w={960} h={350} label="The vault checks payee, payment limit and daily limit. Any failed check refuses the payment.">
      <rect x={145} y={60} width={650} height={276} rx={16} strokeWidth={2} strokeDasharray="8 6" className="fill-slate-50 stroke-slate-300" />
      <text x={165} y={92} className="fill-slate-600 text-[17px] font-semibold">Vault contract (checked on chain)</text>
      <Box x={10} y={120} w={110} h={90} title="Agent" sub="asks to pay" />
      {checks.map((c, i) => (
        <g key={c.t}>
          <Box x={160 + i * 220} y={120} w={180} h={90} title={c.t} sub={c.s} tone="primary" />
          <Line d={`M${250 + i * 220} 210 V256`} />
          <Tag x={270 + i * 220} y={240}>no</Tag>
          <Box x={190 + i * 220} y={258} w={120} h={54} title="Refused" tone="bad" />
          {i < 2 && <Line d={`M${340 + i * 220} 165 H${380 + i * 220}`} />}
        </g>
      ))}
      <Line d="M120 165 H160" />
      <Line d="M780 165 H820" />
      <Tag x={800} y={146}>yes</Tag>
      <Box x={820} y={120} w={130} h={90} title="Paid" sub="on chain" tone="ok" />
    </Svg>
  )
}

/** Invoice to "paid", with the checks that gate the last step. */
export function InvoiceDiagram() {
  const steps = [
    { t: "Invoice", s: "pending", tone: "neutral" as Tone },
    { t: "Pay link", s: "client opens it", tone: "neutral" as Tone },
    { t: "Transfer", s: "tUSDC + memo", tone: "neutral" as Tone },
    { t: "Verify", s: "on-chain check", tone: "primary" as Tone },
    { t: "Paid", s: "record + link", tone: "ok" as Tone },
  ]
  return (
    <Svg w={920} h={150} label="An invoice is created, opened by the client, paid on NEAR, verified by SkyPay, then marked paid">
      {steps.map((s, i) => (
        <g key={s.t}>
          <Box x={6 + i * 182} y={28} w={142} h={94} title={s.t} sub={s.s} tone={s.tone} />
          {i < 4 && <Line d={`M${148 + i * 182} 75 H${188 + i * 182}`} />}
        </g>
      ))}
    </Svg>
  )
}

/** The x402 pay-link handshake for AI agents. */
export function X402Diagram() {
  const X = [130, 450, 770]
  const names = ["Paying agent", "SkyPay /x402pay", "NEAR"]
  const msg = (x1: number, x2: number, y: number, text: string, dashed?: boolean) => (
    <g key={y}>
      <Line d={`M${x1} ${y} H${x2}`} dashed={dashed} />
      <Tag x={(x1 + x2) / 2} y={y - 9}>{text}</Tag>
    </g>
  )
  return (
    <Svg w={900} h={430} label="x402 handshake: the agent requests, gets 402, signs a transfer, retries with payment, SkyPay relays and verifies on NEAR, then returns 200">
      {X.map((x, i) => (
        <g key={x}>
          <Box x={x - 105} y={10} w={210} h={50} title={names[i]} tone={i === 1 ? "primary" : "neutral"} />
          <line x1={x} y1={60} x2={x} y2={415} strokeWidth={2} strokeDasharray="5 6" className="stroke-slate-300" />
        </g>
      ))}
      {msg(X[0], X[1], 108, "GET /x402pay/<invoiceId>")}
      {msg(X[1], X[0], 154, "402 + amount, token, receiver", true)}
      <path d={`M${X[0]} 204 h60 v34 h-60`} fill="none" strokeWidth={2} markerEnd="url(#arr)" className="stroke-slate-500" />
      <text x={X[0] + 74} y={226} className="fill-slate-700 text-[16px] font-medium">signs one ft_transfer</text>
      {msg(X[0], X[1], 282, "retry + X-PAYMENT header")}
      {msg(X[1], X[2], 322, "relay (SkyPay pays gas)")}
      {msg(X[2], X[1], 362, "transfer event on chain", true)}
      {msg(X[1], X[0], 402, "200 + receipt", true)}
    </Svg>
  )
}
