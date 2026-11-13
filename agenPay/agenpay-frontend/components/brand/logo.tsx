// Wordmark with a simple geometric mark (two offset squares: invoice and receipt).
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span aria-hidden className="relative h-6 w-6">
        <span className="absolute left-0 top-0 h-4 w-4 rounded-[4px] bg-primary" />
        <span className="absolute bottom-0 right-0 h-4 w-4 rounded-[4px] border-2 border-primary bg-background" />
      </span>
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-foreground">SKYPay</span>
    </span>
  )
}
