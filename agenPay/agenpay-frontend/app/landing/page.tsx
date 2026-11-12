import { permanentRedirect } from "next/navigation"

// Legacy route — the landing page now lives at "/".
export default function LandingRedirect() {
  permanentRedirect("/")
}
