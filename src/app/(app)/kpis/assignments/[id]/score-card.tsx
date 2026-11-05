"use client"

import { useState, useTransition } from "react"
import { Ban, ClipboardCheck, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { KpiEntry } from "@/lib/data/kpis"
import { formatDate, formatDateTime } from "@/lib/format"
import { formatScore, SCORE_VALUES } from "@/lib/kpis"
import { cn } from "@/lib/utils"
import { markEntryNotApplicable, scoreEntry } from "../../actions"
import { EvidenceList } from "./evidence-files"

export type ScoreEntry = KpiEntry & {
  areaName: string
  weightage: number
  measured: string | null
  /** Scored periods of the same area, for context. */
  earlier: { label: string; value: number }[]
  areaScore: number | null
}

/** What the person wrote and attached, or that nothing was submitted. */
export function EntryEvidence({ entry, canDownload }: { entry: KpiEntry; canDownload: boolean }) {
  if (!entry.submittedAt) return <p className="text-sm font-medium text-rose-800">Nothing submitted. The due date was {formatDate(entry.dueDate)}.</p>
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        Submitted {formatDateTime(entry.submittedAt)}
        {entry.submittedLate && <Badge variant="outline" className="ml-2 border-rose-600/30 bg-rose-50 text-rose-800">Late</Badge>}
      </p>
      {entry.details && <p className="rounded-lg border bg-muted/20 p-3 text-sm whitespace-pre-wrap">{entry.details}</p>}
      <EvidenceList files={entry.files} canDownload={canDownload} />
    </div>
  )
}

/** Who approved or forwarded a period, and what they said. */
export function EntryApproval({ entry }: { entry: KpiEntry }) {
  if (!entry.approval) return null
  return (
    <p className="text-xs text-muted-foreground">
      {entry.submittedAt ? "Approved" : "Forwarded"} by {entry.approval.by ?? "the reviewer"} · {formatDateTime(entry.approval.at)}
      {entry.approval.comment && <span className="mt-1 block text-sm text-foreground">{entry.approval.comment}</span>}
    </p>
  )
}

/** The scorer's decision: score 1–10 or mark not applicable. Also used to correct an existing score. */
export function ScoreCard({ entry, canDownload, onDone }: { entry: ScoreEntry; canDownload: boolean; onDone?: () => void }) {
  const [score, setScore] = useState<number | null>(entry.score?.value ?? null)
  const [comment, setComment] = useState(entry.score?.comment ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [acting, setActing] = useState<"score" | "na" | null>(null)
  const correcting = entry.status === "scored"
  const missed = !entry.submittedAt

  const act = (kind: "score" | "na") =>
    startTransition(async () => {
      setError(null)
      if (kind === "score" && score === null) return setError("Choose a score from 1 to 10.")
      if (kind === "na" && !comment.trim()) return setError("Write the reason it is not applicable.")
      setActing(kind)
      const result = kind === "score" ? await scoreEntry(entry.id, score!, comment) : await markEntryNotApplicable(entry.id, comment)
      setActing(null)
      if (!result.ok) {
        setError(result.error)
        return void toast.error(result.error)
      }
      toast.success(kind === "score" ? (correcting ? "Score changed" : "Score saved") : "Marked not applicable")
      onDone?.()
    })

  return (
    <li className="grid gap-3 rounded-xl border p-4 ring-2 ring-sky-500/20">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          <h3 className="font-medium">{entry.areaName}</h3>
          <Badge>{entry.weightage}%</Badge>
          <span className="text-sm text-muted-foreground">{entry.periodLabel}</span>
        </div>
        {entry.measured && <p className="text-sm whitespace-pre-line text-muted-foreground">What is measured: {entry.measured}</p>}
      </div>

      <EntryEvidence entry={entry} canDownload={canDownload} />
      <EntryApproval entry={entry} />

      {entry.earlier.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Earlier periods: {entry.earlier.map((e) => `${e.label} ${e.value}`).join(" · ")}
          {entry.areaScore !== null && ` → Area average ${formatScore(entry.areaScore)}`}
        </p>
      )}

      <div className="grid gap-1.5">
        <span id={`score-${entry.id}`} className="text-sm font-medium">
          Score <span className="font-normal text-muted-foreground">(1 to 10)</span>
        </span>
        <div role="radiogroup" aria-labelledby={`score-${entry.id}`} className="flex flex-wrap gap-1">
          {SCORE_VALUES.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={score === v}
              disabled={pending}
              onClick={() => setScore(v)}
              className={cn(
                "flex size-9 items-center justify-center rounded-md border text-sm font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                score === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`comment-${entry.id}`}>
          Comment{" "}
          <span className="font-normal text-muted-foreground">
            ({[correcting ? null : "required for not applicable", "optional with a score"].filter(Boolean).join(", ")})
          </span>
        </Label>
        <Textarea id={`comment-${entry.id}`} rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} disabled={pending} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => act("score")} disabled={pending}>
          {acting === "score" && <Loader2 className="animate-spin" />}
          {correcting ? "Change score" : "Save score"}
        </Button>
        {!correcting && (
          <Button type="button" size="sm" variant="outline" onClick={() => act("na")} disabled={pending}>
            {acting === "na" ? <Loader2 className="animate-spin" /> : <Ban />} {missed ? "Mark not applicable" : "Not applicable"}
          </Button>
        )}
        {onDone && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </li>
  )
}
