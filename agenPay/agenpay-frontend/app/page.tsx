import { Navbar } from "@/components/landing/navbar"
import { Hero } from "@/components/landing/hero"
import { HowItWorks } from "@/components/landing/how-it-works"
import { Features } from "@/components/landing/features"
import { NotionShowcase } from "@/components/landing/notion-showcase"
import { Pricing } from "@/components/landing/pricing"
import { CTA } from "@/components/landing/cta"
import { Footer } from "@/components/landing/footer"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background font-sans text-[#0f0f0f]">
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <NotionShowcase />
        <Pricing />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
