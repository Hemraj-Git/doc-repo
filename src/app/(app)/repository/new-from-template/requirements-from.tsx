"use client"

import { CalendarClock, History } from "lucide-react"
import { formatDate } from "@/lib/format"
import type { PastStartEntry, RequirementsFrom } from "@/lib/instance-entry"
import { cn } from "@/lib/utils"

const SHOWN = 3

const list = (names: string[]) => (names.length > SHOWN ? `${names.slice(0, SHOWN).join(", ")} and ${names.length - SHOWN} more` : names.join(", "))

type Props = {
  entries: PastStartEntry[]
  today: string
  value: RequirementsFrom | null
  onChange: (value: RequirementsFrom) => void
}

/** Asked when an entry with recurring items starts in the past: backfill those periods, or go forward from today. */
export function RequirementsFromQuestion({ entries, today, value, onChange }: Props) {
  const started = entries.slice(0, SHOWN).map((e) => `${e.name} started on ${formatDate(e.start)}.`)
  const more = entries.length - started.length
  const ended = entries.filter((e) => e.end && e.end < today).map((e) => e.name)

  const options: { value: RequirementsFrom; title: string; description: string; icon: typeof History }[] = [
    {
      value: "start_date",
      title: "Start date (backfill)",
      description: "Creates every period since the start date. Past periods show as overdue, and the uploader is notified about each one.",
      icon: History,
    },
    {
      value: "today",
      title: "Today (go-forward)",
      description:
        "Starts with the current period and continues to the end date. Past periods are not created." +
        (ended.length ? ` Already ended, so nothing recurring is created: ${list(ended)}.` : ""),
      icon: CalendarClock,
    },
  ]

  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Generate requirements from</legend>
      <p className="text-sm text-muted-foreground">
        {started.join(" ")}
        {more > 0 && ` ${more} more ${more === 1 ? "has" : "have"} also started.`}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 has-focus-visible:ring-2 has-focus-visible:ring-primary/40",
              value === o.value && "border-primary bg-primary/5 ring-2 ring-primary/20"
            )}
          >
            <input type="radio" name="requirements-from" className="sr-only" checked={value === o.value} onChange={() => onChange(o.value)} />
            <o.icon className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{o.title}</span>
              <span className="block text-xs text-muted-foreground">{o.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
