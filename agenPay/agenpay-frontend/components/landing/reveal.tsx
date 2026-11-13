"use client"

import { useRef, type ReactNode } from "react"
import { gsap, useGSAP, EASE, prefersReducedMotion } from "@/lib/gsap"

/**
 * Scroll reveal. Content renders visible on the server; the from-state is applied only after
 * hydration and only when motion is allowed, so a failed script never hides content.
 * With `stagger`, direct children marked `data-reveal-item` enter in sequence.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
  stagger = false,
  as: Tag = "div",
}: {
  children: ReactNode
  className?: string
  delay?: number
  stagger?: boolean
  as?: "div" | "section" | "ul" | "ol"
}) {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (!ref.current || prefersReducedMotion()) return
      const targets = stagger ? ref.current.querySelectorAll("[data-reveal-item]") : ref.current
      gsap.from(targets, {
        opacity: 0,
        y: 22,
        duration: 0.8,
        ease: EASE,
        delay: delay / 1000,
        stagger: stagger ? 0.08 : 0,
        scrollTrigger: { trigger: ref.current, start: "top 85%", once: true },
      })
    },
    { scope: ref },
  )

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} className={className}>
      {children}
    </Tag>
  )
}
