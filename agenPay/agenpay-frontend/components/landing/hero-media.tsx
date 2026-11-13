"use client"

import { useEffect, useRef, useState } from "react"
import { Pause, Play, Volume2, VolumeX } from "lucide-react"
import { WorkflowStack } from "./workflow-stack"
import { prefersReducedMotion } from "@/lib/gsap"

const VIDEO_URL = process.env.NEXT_PUBLIC_HERO_VIDEO_URL?.trim() || ""
const POSTER_URL = process.env.NEXT_PUBLIC_HERO_VIDEO_POSTER?.trim() || undefined

/**
 * Hero media. When NEXT_PUBLIC_HERO_VIDEO_URL is set, the video is the main visual; the 3D workflow
 * stack shows while it loads and stays as the fallback if the video is missing or fails.
 * Reduced motion: the video does not autoplay; the viewer starts it with the play button.
 */
export function HeroMedia() {
  const video = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)

  useEffect(() => {
    const v = video.current
    if (!v || prefersReducedMotion()) return
    v.play().catch(() => setPlaying(false)) // autoplay can be blocked; controls stay available
  }, [])

  if (!VIDEO_URL || failed) return <WorkflowStack />

  const toggle = () => {
    const v = video.current
    if (!v) return
    if (v.paused) v.play().catch(() => setFailed(true))
    else v.pause()
  }
  const toggleMute = () => {
    const v = video.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  return (
    <div className="relative w-full">
      {!ready && (
        <div aria-hidden className="pointer-events-none">
          <WorkflowStack />
        </div>
      )}
      <div
        className={`overflow-hidden rounded-xl border border-border bg-card transition-opacity duration-500 ${ready ? "opacity-100" : "pointer-events-none absolute inset-0 opacity-0"}`}
      >
        <video
          ref={video}
          src={VIDEO_URL}
          poster={POSTER_URL}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="SKYPay product walkthrough"
          className="block aspect-video w-full bg-surface object-cover"
          onCanPlay={() => setReady(true)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
        />
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={toggle}
            aria-pressed={playing}
            aria-label={playing ? "Pause video" : "Play video"}
            className="press flex h-9 w-9 items-center justify-center rounded-lg text-foreground hover:bg-muted"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={!muted}
            aria-label={muted ? "Unmute video" : "Mute video"}
            className="press flex h-9 w-9 items-center justify-center rounded-lg text-foreground hover:bg-muted"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <span className="ml-1 text-xs text-muted-foreground">Product walkthrough</span>
        </div>
      </div>
    </div>
  )
}
