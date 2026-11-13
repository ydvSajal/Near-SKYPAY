"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Menu, X, ShieldCheck, Command, FileText, Send, CheckCheck } from "lucide-react"
import { gsap, useGSAP } from "@/lib/gsap"
import { SmoothScroll } from "@/components/motion/smooth-scroll"
import { useAuth } from "@/lib/auth-context"
const stages = [
 { name: "Connect", title: "Start in your workspace.", description: "Connect your Notion database. Add a client, an amount and a due date. Your payment workflow starts where you already work.", status: "Ready to invoice", detail: "Notion row connected", icon: FileText },
 { name: "Create", title: "An invoice, in a sentence.", description: "Ask your agent to create an invoice. It adds a checkout link to your database, ready to share with your client or another agent.", status: "Payment requested", detail: "Checkout link created", icon: Send },
 { name: "Settle", title: "Paid. Verified. Recorded.", description: "SKYPay verifies the token, recipient and full amount on NEAR. The payment status returns to Notion, with a transaction you can check.", status: "Payment verified", detail: "Notion status updated", icon: CheckCheck },
]
export function LandingExperience() {
 const root = useRef<HTMLDivElement>(null)
 const [menu, setMenu] = useState(false)
 const [stage, setStage] = useState(0)
 const { isAuthenticated } = useAuth()
 const destination = isAuthenticated ? "/dashboard" : "/auth/login"
 const current = stages[stage]
 const StageIcon = current.icon
 useEffect(() => {
  if (!menu) return
  const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false) }
  window.addEventListener("keydown", close)
  return () => window.removeEventListener("keydown", close)
 }, [menu])
 useGSAP(() => {
  const media = gsap.matchMedia()
  media.add("(prefers-reduced-motion: no-preference)", () => {
   gsap.from(".sky-hero-copy > *", { y: 24, opacity: 0, duration: .8, stagger: .09, ease: "power3.out" })
   gsap.from(".sky-workspace", { y: 35, opacity: 0, duration: 1, delay: .25, ease: "power3.out" })
   gsap.utils.toArray<HTMLElement>("[data-sky-reveal]").forEach(el => gsap.from(el, { y: 28, opacity: 0, duration: .75, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 93%", once: true } }))
   gsap.to(".sky-receipt", { y: -22, rotate: -2, ease: "none", scrollTrigger: { trigger: ".sky-workspace", start: "top 80%", end: "bottom top", scrub: 1 } })
  })
  return () => media.revert()
 }, { scope: root })
 return <div ref={root} className="sky-landing">
 <SmoothScroll /><a className="sky-skip" href="#main">Skip to content</a>
 <header className="sky-header"><nav className="sky-nav sky-wrap" aria-label="Main navigation">
 <Link className="sky-wordmark" href="/" aria-label="SKYPay home">sky<span>pay</span><sup>®</sup></Link>
 <div className="sky-desktop-links"><a href="#how-it-works">How it works</a><a href="#features">Features</a><a href="#pricing">Pricing</a><Link href="/docs">Docs <ArrowUpRight size={13} /></Link></div>
 <div className="sky-nav-actions"><Link className="sky-sign-in" href={destination}>{isAuthenticated ? "Dashboard" : "Sign in"}</Link><Link className="sky-button sky-button-small" href={destination}>Start your agent <ArrowUpRight size={16} /></Link><button className="sky-menu-toggle" onClick={() => setMenu(!menu)} aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} aria-controls="sky-mobile-menu">{menu ? <X /> : <Menu />}</button></div>
 </nav>{menu && <nav id="sky-mobile-menu" className="sky-mobile-menu" aria-label="Mobile navigation">{[["How it works", "#how-it-works"], ["Features", "#features"], ["Pricing", "#pricing"], ["Docs", "/docs"], ["Sign in", destination]].map(([label, href]) => <Link key={label} href={href} onClick={() => setMenu(false)}>{label}<ArrowUpRight size={18} /></Link>)}</nav>}</header>
 <main id="main"><section className="sky-hero sky-wrap" id="hero"><div className="sky-hero-copy">
 <p className="sky-eyebrow"><span className="sky-status-dot" /> YOUR WORKSPACE. YOUR AGENT. YOUR RULES.</p>
 <h1>Payments,<br /><em>on autopilot.</em><span className="sky-inline-receipt" aria-hidden="true"><CheckCheck /><span>Settled</span></span></h1>
 <div className="sky-hero-bottom"><p>Your AI payment agent. Turn Notion rows into invoices, collect USDC, and pay approved suppliers. You set the limits.</p><Link href={destination} className="sky-button">Start your agent <ArrowUpRight size={19} /></Link></div></div>
 <div className="sky-workspace" data-ui><div className="sky-workspace-top"><span><Command size={16} /> SKYPay workspace</span><span>Example workspace</span></div>
 <div className="sky-workspace-body"><div className="sky-ledger"><div className="sky-ledger-heading"><span className="sky-notion-mark">N</span><div><strong>Your client invoices</strong><span>Notion / Finance workspace</span></div><ArrowUpRight size={18} /></div>
 <div className="sky-ledger-row sky-ledger-label"><span>Client / invoice</span><span>Amount</span><span>Status</span></div>
 {[["Harbor & Pine", "Brand identity · INV-042", "150.00", "Paid"], ["Northfield Labs", "Monthly retainer · INV-043", "250.00", "Pending"], ["Okafor Studio", "Design sprint · INV-044", "80.00", "Draft"]].map(([client, invoice, amount, status]) => <div className="sky-ledger-row" key={client}><div><strong>{client}</strong><small>{invoice}</small></div><span>{amount}<small>USDC</small></span><span className={`sky-payment-status sky-status-${status.toLowerCase()}`}>{status === "Paid" && <Check size={12} />}{status}</span></div>)}
 <div className="sky-ledger-note"><span className="sky-status-dot" /> Your workspace stays the source of truth.</div></div>
 <div className="sky-agent"><div className="sky-agent-label"><Command className="sky-agent-symbol" size={25} /><strong>Your agent</strong><span>Preview</span></div><p className="sky-prompt">“Invoice Harbor & Pine<br />150 USDC for brand identity.”</p>{["Invoice created", "Payment link added to Notion", "Settlement verified on NEAR"].map(text => <div className="sky-agent-action" key={text}><Check size={15} /><span>{text}</span></div>)}<a href="#how-it-works">Explore the workflow <ArrowRight size={16} /></a></div></div>
 <div className="sky-receipt"><span><CheckCheck size={18} /> Payment received</span><strong>150.00 <small>USDC</small></strong><span>Harbor & Pine · Example payment</span></div></div>
 <div className="sky-hero-foot"><span>Built on <strong>NEAR</strong><span className="sky-foot-divider" />Connected to <strong>Notion</strong></span><a href="#how-it-works">Less admin. More possibility. <ArrowDown size={16} /></a></div></section>
 <section className="sky-how" id="how-it-works"><div className="sky-wrap"><div className="sky-section-heading" data-sky-reveal><p className="sky-eyebrow">FROM A ROW TO A RECEIPT</p><h2>One small setup.<br /><em>A lot off your plate.</em></h2></div>
 <div className="sky-workflow"><div className="sky-workflow-copy" data-sky-reveal><div className="sky-tabs" role="tablist" aria-label="Payment workflow">{stages.map((item, index) => <button key={item.name} id={`workflow-tab-${index}`} role="tab" aria-selected={stage === index} aria-controls="workflow-panel" tabIndex={stage === index ? 0 : -1} onClick={() => setStage(index)} onKeyDown={event => { const next = event.key === "ArrowRight" ? (stage + 1) % 3 : event.key === "ArrowLeft" ? (stage + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null; if (next !== null) { event.preventDefault(); setStage(next); document.getElementById(`workflow-tab-${next}`)?.focus() } }}><span>{index + 1}</span>{item.name}</button>)}</div><div id="workflow-panel" role="tabpanel" aria-labelledby={`workflow-tab-${stage}`} tabIndex={0}><h3>{current.title}</h3><p>{current.description}</p></div><Link href={destination} className="sky-text-link">Connect your workspace <ArrowUpRight size={18} /></Link></div>
 <div className="sky-workflow-preview" data-sky-reveal data-ui><div className="sky-preview-top"><span>EXAMPLE WORKFLOW</span><span>{stage + 1} / 3</span></div><div className="sky-invoice" key={stage}><div className="sky-invoice-heading"><span className="sky-notion-mark">N</span><StageIcon size={23} /></div><span className="sky-invoice-caption">HARBOR & PINE</span><p>Brand identity</p><strong>150.00 <span>USDC</span></strong><div className="sky-invoice-status"><StageIcon size={17} />{current.status}</div><div className="sky-invoice-footer"><Check size={14} />{current.detail}</div></div><p className="sky-preview-caption">Notion → SKYPay → NEAR → Notion</p></div></div></div></section>
 <section id="features" className="sky-features sky-wrap"><div className="sky-section-heading" data-sky-reveal><p className="sky-eyebrow">AUTONOMY, WITH BOUNDARIES</p><h2>Let it work.<br /><em>Stay in control.</em></h2><p>Give your agent the busywork. Keep the decisions that matter.</p></div>
 <div className="sky-feature-grid"><article className="sky-feature-main" data-sky-reveal><ShieldCheck size={30} strokeWidth={1.4} /><h3>Your money.<br />Your ground rules.</h3><p>Set per-payment and daily caps. Approve your payees. Revoke access whenever you need. Your vault contract enforces every limit.</p><div className="sky-limits" data-ui><div><span>Per-payment limit</span><strong>50 USDC</strong></div><div><span>Daily spending cap</span><strong>200 USDC</strong></div><div><span>Payee permissions</span><strong>Approved only <Check size={14} /></strong></div><small>Example agent policy</small></div></article>
 <div className="sky-feature-side"><article data-sky-reveal><div className="sky-feature-title"><h3>Speak human.</h3><Command size={22} /></div><p>Create invoices, check payments and ask for a summary in plain English.</p><div className="sky-chat" data-ui><span>“Is invoice INV-042 paid?”</span><span><CheckCheck size={16} /> Paid. 150 USDC, verified on NEAR.</span></div></article><article data-sky-reveal><div className="sky-feature-title"><h3>Agent commerce.</h3><ArrowUpRight size={23} /></div><p>Every invoice supports x402 payments. Another agent can pay with one signed transfer, with gas sponsored by SKYPay.</p><Link href="/docs" className="sky-text-link">Explore the docs <ArrowRight size={17} /></Link></article></div></div>
 <div className="sky-feature-notes"><div data-sky-reveal><CheckCheck /><h3>Verified, not assumed.</h3><p>Token, recipient and full amount checked on chain. A transaction can only settle once.</p></div><div data-sky-reveal><FileText /><h3>Books that close.</h3><p>Export invoice and payment CSVs with exact amounts, UTC times and transaction links.</p></div><div data-sky-reveal><ArrowRight /><h3>Right back to Notion.</h3><p>Pay links and verified status return to your database. Your team stays in its flow.</p></div></div></section>
 <section className="sky-pricing" id="pricing"><div className="sky-wrap sky-pricing-inner"><div data-sky-reveal><p className="sky-eyebrow">ROOM TO EXPERIMENT</p><h2>Start freely.<br /><em>Find your flow.</em></h2><p>Explore the full workflow on NEAR testnet. Test tokens have no monetary value. Mainnet pricing will be announced separately.</p></div><div className="sky-price" data-sky-reveal><p>THE TESTNET EDITION</p><div className="sky-price-amount">Free<span>while on testnet</span></div><ul>{["Unlimited invoices & checkout pages", "Sponsored NEAR gas", "Agent with on-chain spending limits", "Notion sync, x402 links & CSV exports"].map(text => <li key={text}><Check size={16} />{text}</li>)}</ul><Link href={destination} className="sky-button">Get started for free <ArrowUpRight size={19} /></Link></div></div></section>
 <section className="sky-closing sky-wrap"><div data-sky-reveal><p className="sky-eyebrow">A LITTLE LESS TO DO</p><h2>Make room for<br /><em>your next big thing.</em></h2><Link href={destination} className="sky-button">Meet your payment agent <ArrowUpRight size={19} /></Link><Link href="/docs" className="sky-text-link">Read the documentation <ArrowRight size={16} /></Link></div></section>
 </main><footer className="sky-footer"><div className="sky-wrap"><div className="sky-footer-top"><p>Payments in motion.<br />You, moving forward.</p><nav aria-label="Footer product"><span>Explore</span><a href="#how-it-works">How it works</a><a href="#features">Features</a><a href="#pricing">Pricing</a></nav><nav aria-label="Footer resources"><span>Build with us</span><Link href="/docs">Documentation <ArrowUpRight size={14} /></Link><Link href={destination}>Your workspace <ArrowUpRight size={14} /></Link><Link href="/finance">Finance</Link></nav><a className="sky-back-top" href="#hero" aria-label="Back to top"><ArrowUpRight /></a></div><div className="sky-footer-wordmark" aria-label="SKYPay">skypay<span>®</span></div><div className="sky-footer-bottom"><span>© {new Date().getFullYear()} SKYPay. MIT licensed.</span><span><span className="sky-status-dot" /> Built on NEAR testnet</span><span>Made for a little more freedom.</span></div></div></footer>
 </div>
}

