"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { CalendarClock, Check, Loader2, MessageSquareWarning, PenLine, Send } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { KpiEntry } from "@/lib/data/kpis"
import { formatDate } from "@/lib/format"
import { saveEntry, submitEntries } from "../../actions"
import { EvidenceEditor } from "./evidence-files"

export type FillEntry = KpiEntry & { areaName: string; weightage: number; measured: string | null }

type SaveState = "idle" | "saving" | "saved" | "error"

/** One open period: details (autosaved), files, submit. */
function EntryCard({
  entry,
  details,
  onChange,
  onSubmit,
  submitting,
  canDownload,
  today,
}: {
  entry: FillEntry
  details: string
  onChange: (value: string) => void
  onSubmit: () => void
  submitting: boolean
  canDownload: boolean
  today: string
}) {
  const [save, setSave] = useState<SaveState>("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef(entry.details ?? "")
  const overdue = entry.dueDate < today

  const flush = async (value: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (value === lastSaved.current) return
    setSave("saving")
    const result = await saveEntry(entry.id, value)
    if (result.ok) {
      lastSaved.current = value
      setSave("saved")
    } else {
      setSave("error")
    }
  }
  const change = (value: string) => {
    onChange(value)
    setSave("idle")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(value), 900)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return (
    <li className={`grid gap-3 rounded-xl border p-4 ${entry.status === "changes_requested" ? "ring-2 ring-danger-line" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{entry.areaName}</h3>
            <Badge>{entry.weightage}%</Badge>
            <span className="text-sm text-muted-foreground">{entry.periodLabel}</span>
          </div>
          {entry.measured && <p className="text-sm whitespace-pre-line text-muted-foreground">What is measured: {entry.measured}</p>}
        </div>
        <span className={`flex shrink-0 items-center gap-1 text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
          <CalendarClock className="size-3.5" /> {overdue ? "Overdue, was due" : "Due"} {formatDate(entry.dueDate)}
        </span>
      </div>

      {entry.status === "changes_requested" && entry.returnedComment && (
        <div className="flex gap-2 rounded-lg border border-danger-line bg-danger-soft p-3 text-sm text-danger-text">
          <MessageSquareWarning className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">Your reviewer asked for changes</div>
            <p className="whitespace-pre-wrap">{entry.returnedComment}</p>
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={`entry-${entry.id}`}>What have you done to meet this requirement?</Label>
        <Textarea
          id={`entry-${entry.id}`}
          rows={4}
          maxLength={10000}
          placeholder="Describe what you did in this period"
          value={details}
          onChange={(e) => change(e.target.value)}
          onBlur={(e) => void flush(e.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">
          Supporting files <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <EvidenceEditor entryId={entry.id} files={entry.files} canDownload={canDownload} />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {save === "saving" && "Saving…"}
          {save === "saved" && (
            <span className="inline-flex items-center gap-1">
              <Check className="size-3" /> Saved
            </span>
          )}
          {save === "error" && <span className="text-destructive">Could not save. It will be saved when you submit.</span>}
        </span>
        <Button type="button" size="sm" onClick={onSubmit} disabled={submitting || !details.trim()} title={details.trim() ? undefined : "Write the details first"}>
          {submitting ? <Loader2 className="animate-spin" /> : <Send />} Submit
        </Button>
      </div>
    </li>
  )
}

/** Everything the person can fill in now. Drafts live here so "Submit all" sends what is on screen. */
export function FillSection({ entries, canDownload, today }: { entries: FillEntry[]; canDownload: boolean; today: string }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()
  const textOf = (e: FillEntry) => drafts[e.id] ?? e.details ?? ""
  const ready = entries.filter((e) => textOf(e).trim())

  const submit = (list: FillEntry[]) =>
    startTransition(async () => {
      const result = await submitEntries(list.map((e) => ({ id: e.id, details: textOf(e) })))
      if (!result.ok) return void toast.error(result.error)
      toast.success(result.data.submitted === 1 ? "Submitted to your reviewer" : `${result.data.submitted} periods submitted to your reviewer`)
    })

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 section-heading">
          <PenLine className="size-4" /> To fill in <span className="tabular-nums">({entries.length})</span>
        </h2>
        {ready.length > 1 && (
          <Button type="button" size="sm" onClick={() => submit(ready)} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />} Submit all ready ({ready.length})
          </Button>
        )}
      </div>
      <ul className="grid gap-3">
        {entries.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            details={textOf(e)}
            onChange={(value) => setDrafts((d) => ({ ...d, [e.id]: value }))}
            onSubmit={() => submit([e])}
            submitting={pending}
            canDownload={canDownload}
            today={today}
          />
        ))}
      </ul>
    </section>
  )
}
