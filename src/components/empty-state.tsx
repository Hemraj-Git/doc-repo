import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Shown in place of a list with nothing in it: an icon, then the message and any action as children. */
export function EmptyState({ icon: Icon, className, children }: { icon: LucideIcon; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col items-center gap-1 rounded-xl border border-dashed bg-card/60 px-6 py-12 text-center", className)}>
      <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      {children}
    </div>
  )
}
