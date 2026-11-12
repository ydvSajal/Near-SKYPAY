import type React from "react"
import type { Metadata } from "next"
import { Inter, Cormorant_Garamond } from "next/font/google"
import { AuthProvider } from "@/lib/auth-context"
import { Web3Provider } from "@/lib/web3-provider"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
})

export const metadata: Metadata = {
  title: "SKYPay - Agentic Payment Infrastructure",
  description:
    "SKYPay is the first agentic payment infrastructure. An AI agent that automatically schedules, sends, receives, and manages all your crypto payments.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${cormorant.variable} ${inter.className} min-h-screen bg-background text-foreground antialiased`} suppressHydrationWarning={true}>
        <Web3Provider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </Web3Provider>
      </body>
    </html>
  )
}
