// Semantic status pill shared by dashboard, finance and checkout. Color carries state, label carries meaning.
const TONE: Record<string, string> = {
  paid: "bg-success/10 text-success",
  settled: "bg-success/10 text-success",
  connected: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  authorized: "bg-warning/10 text-warning",
  reserved: "bg-warning/10 text-warning",
  submitted: "bg-warning/10 text-warning",
  processing: "bg-warning/10 text-warning",
  failed: "bg-destructive/10 text-destructive",
  refunded: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
}

export function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase()
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TONE[s] ?? TONE.unknown}`}>
      {s}
    </span>
  )
}
