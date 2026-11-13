"use client"

import { useEffect } from "react"
import Lenis from "lenis"
import { gsap, ScrollTrigger, prefersReducedMotion } from "@/lib/gsap"

/**
 * Lenis smooth scrolling for the marketing page only. Mount it inside the landing page tree:
 * leaving the route unmounts it, which destroys Lenis and returns the app to native scrolling.
 * Skipped entirely when the user prefers reduced motion.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return

    const lenis = new Lenis({
      lerp: 0.11,
      anchors: { offset: -80 },
      stopInertiaOnNavigate: true,
    })
    lenis.on("scroll", ScrollTrigger.update)
    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    ScrollTrigger.refresh()

    return () => {
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33)
      lenis.destroy()
      ScrollTrigger.refresh()
    }
  }, [])

  return null
}
