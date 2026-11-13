"use client"

// Single place that registers GSAP plugins, so every client component imports from here.
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger, useGSAP)

export const EASE = "power3.out"

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function isCoarsePointer() {
  return typeof window !== "undefined" && window.matchMedia("(hover: none), (pointer: coarse)").matches
}

export { gsap, ScrollTrigger, useGSAP }
