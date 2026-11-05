import { Construction } from "lucide-react"

/** Placeholder for screens delivered in a later build phase. */
export function ComingSoon({ phase, features }: { phase: number; features: string[] }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-muted/30 px-6 py-14 text-center">
      <span className="mb-4 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Construction className="size-5" />
      </span>
      <h2 className="font-medium">Arrives in Phase {phase}</h2>
      <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  )
}
