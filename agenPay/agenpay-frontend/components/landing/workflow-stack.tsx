"use client"

import { useRef } from "react"
import { CheckCircle2, FileText, ShieldCheck, Table2 } from "lucide-react"
import { gsap, useGSAP, prefersReducedMotion, isCoarsePointer } from "@/lib/gsap"

// Example data only. Shown as a labelled illustration of the flow, never as live account data.
const DEPTH = [-90, 0, 90] // back (Notion), middle (NEAR check), front (invoice)
const REST = { rotationX: 12, rotationY: -18 }

export function WorkflowStack() {
  const scene = useRef<HTMLDivElement>(null)

  useGSAP(
    (_, contextSafe) => {
      const rig = scene.current?.querySelector<HTMLElement>("[data-rig]")
      const layers = gsap.utils.toArray<HTMLElement>("[data-layer]", scene.current)
      if (!rig || !layers.length) return

      gsap.set(rig, REST)
      layers.forEach((l, i) => gsap.set(l, { z: DEPTH[i] }))
      if (prefersReducedMotion()) return

      // Assemble: the invoice arrives, NEAR verifies it, Notion records it.
      gsap.from(layers, { z: 0, y: 36, opacity: 0, duration: 1, ease: "power3.out", stagger: { each: 0.14, from: "end" }, delay: 0.35 })
      gsap.from(rig, { rotationX: 24, rotationY: -32, duration: 1.4, ease: "power3.out", delay: 0.2 })

      if (isCoarsePointer() || !contextSafe) return
      const rx = gsap.quickTo(rig, "rotationX", { duration: 0.6, ease: "power3.out" })
      const ry = gsap.quickTo(rig, "rotationY", { duration: 0.6, ease: "power3.out" })
      const el = scene.current!

      const move = contextSafe((e: PointerEvent) => {
        const r = el.getBoundingClientRect()
        const px = (e.clientX - r.left) / r.width - 0.5
        const py = (e.clientY - r.top) / r.height - 0.5
        ry(REST.rotationY + px * 16)
        rx(REST.rotationX - py * 12)
      })
      const enter = contextSafe(() => gsap.to(layers, { z: (i) => DEPTH[i] * 1.45, duration: 0.6, ease: "power3.out", overwrite: "auto" }))
      const leave = contextSafe(() => {
        rx(REST.rotationX)
        ry(REST.rotationY)
        gsap.to(layers, { z: (i) => DEPTH[i], duration: 0.6, ease: "power3.out", overwrite: "auto" })
      })

      el.addEventListener("pointermove", move)
      el.addEventListener("pointerenter", enter)
      el.addEventListener("pointerleave", leave)
      return () => {
        el.removeEventListener("pointermove", move)
        el.removeEventListener("pointerenter", enter)
        el.removeEventListener("pointerleave", leave)
      }
    },
    { scope: scene },
  )

  return (
    <figure className="w-full">
      <div ref={scene} className="stack-scene relative mx-auto aspect-[4/5] w-full max-w-[520px] sm:aspect-[5/4] select-none">
        <div
          data-rig
          className="stack-rig absolute inset-0"
          style={{ transform: `rotateX(${REST.rotationX}deg) rotateY(${REST.rotationY}deg)` }}
        >
          {/* Back: Notion row */}
          <div
            data-layer
            className="stack-layer absolute right-0 top-0 w-[74%] rounded-xl border border-border bg-card p-4"
            style={{ transform: `translateZ(${DEPTH[0]}px)` }}
          >
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Table2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Notion payments database
            </div>
            <div className="grid grid-cols-[1.3fr_1fr_0.9fr] gap-2 border-b border-border pb-2 text-[11px] text-muted-foreground">
              <span>Client</span><span className="text-right">Amount</span><span className="text-right">Status</span>
            </div>
            <div className="grid grid-cols-[1.3fr_1fr_0.9fr] items-center gap-2 pt-2 text-xs">
              <span className="font-medium">Harbor &amp; Pine</span>
              <span className="tabular text-right">150.00</span>
              <span className="justify-self-end rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">Paid</span>
            </div>
          </div>

          {/* Middle: on-chain verification */}
          <div
            data-layer
            className="stack-layer absolute left-0 top-[30%] w-[70%] rounded-xl border border-border bg-card p-4"
            style={{ transform: `translateZ(${DEPTH[1]}px)` }}
          >
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} /> Verified on NEAR
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Token</dt><dd className="text-right font-mono">tUSDC</dd>
              <dt className="text-muted-foreground">Receiver</dt><dd className="truncate text-right font-mono">harborpine.testnet</dd>
              <dt className="text-muted-foreground">Amount</dt><dd className="tabular text-right font-mono">150.000000</dd>
            </dl>
          </div>

          {/* Front: the invoice */}
          <div
            data-layer
            className="stack-layer absolute bottom-0 left-[16%] w-[72%] rounded-xl border border-primary/25 bg-card p-5"
            style={{ transform: `translateZ(${DEPTH[2]}px)`, boxShadow: "0 24px 48px -24px rgb(20 35 33 / 0.28)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileText className="h-3.5 w-3.5" strokeWidth={1.75} /> INV-0042</p>
                <p className="mt-1 text-sm font-semibold">Brand refresh, phase 2</p>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                <CheckCircle2 className="h-3 w-3" /> Paid
              </span>
            </div>
            <div className="mt-4 flex items-end justify-between border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Total due</span>
              <span className="tabular text-xl font-semibold tracking-tight">150.00 <span className="text-xs font-medium text-muted-foreground">USDC</span></span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-center text-xs text-muted-foreground">Example invoice on NEAR testnet. Test tokens, no real funds.</figcaption>
    </figure>
  )
}
