"use client"

import { Fragment, useState, useTransition } from "react"
import { Ban, ChevronDown, ChevronRight, Loader2, MessageSquareWarning, Pencil, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate, formatDateTime } from "@/lib/format"
import { entryStatusClass, entryStatusLabel, formatScore, KPI_RECURRENCE_LABELS, type KpiRecurrence } from "@/lib/kpis"
import { cn } from "@/lib/utils"
import { markEntryNotApplicable, reopenEntry } from "../../actions"
import { EntryApproval, EntryEvidence, ScoreCard, type ScoreEntry } from "./score-card"

export type HistoryArea = {
  id: string
  name: string
  weightage: number
  description: string | null
  recurrence: KpiRecurrence | null
  score: number | null
  entries: ScoreEntry[]
}

type Props = {
  area: HistoryArea
  today: string
  canDownload: boolean
  /** Scores are hidden from this viewer until they are released. */
  scoresVisible: boolean
  /** May change an existing score. */
  canCorrect: boolean
  /** May mark periods not applicable, and reopen them (the reviewer, the scorer or HR). */
  canDecide: boolean
}

function RowActions({ entry, canDecide, canCorrect, onCorrect }: { entry: ScoreEntry; canDecide: boolean; canCorrect: boolean; onCorrect: () => void }) {
  const [pending, startTransition] = useTransition()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState("")
  const reopen = () =>
    startTransition(async () => {
      const result = await reopenEntry(entry.id)
      if (!result.ok) return void toast.error(result.error)
      toast.success("Reopened")
    })
  const notApplicable = () =>
    startTransition(async () => {
      const result = await markEntryNotApplicable(entry.id, reason)
      if (!result.ok) return void toast.error(result.error)
      toast.success("Marked not applicable")
      setAsking(false)
    })
  return (
    <span className="flex justify-end gap-1">
      {canCorrect && entry.status === "scored" && (
        <Button type="button" variant="ghost" size="sm" onClick={onCorrect}>
          <Pencil /> Change
        </Button>
      )}
      {canDecide && entry.status === "not_applicable" && (
        <Button type="button" variant="ghost" size="sm" onClick={reopen} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reopen
        </Button>
      )}
      {canDecide && (entry.status === "open" || entry.status === "changes_requested" || entry.status === "submitted" || entry.status === "approved") && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(true)}>
          <Ban /> Not applicable
        </Button>
      )}
      <Dialog open={asking} onOpenChange={(o) => !pending && setAsking(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {entry.areaName} · {entry.periodLabel}: not applicable?
            </DialogTitle>
            <DialogDescription>This period won&apos;t count towards the score. The person sees the reason. You can reopen it later.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`na-${entry.id}`}>Reason</Label>
            <Textarea id={`na-${entry.id}`} rows={3} maxLength={1000} placeholder="e.g. On approved leave" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={notApplicable} disabled={pending || !reason.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              Mark not applicable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  )
}

/** Every period of one area: status, score if visible, and the evidence on expanding a row. */
export function AreaHistory({ area, today, canDownload, scoresVisible, canCorrect, canDecide }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState<string | null>(null)

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-6 border-b bg-muted/20 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{area.name}</h3>
            <Badge>{area.weightage}%</Badge>
            {area.recurrence && <Badge variant="outline">{KPI_RECURRENCE_LABELS[area.recurrence]}</Badge>}
          </div>
          {area.description && <p className="text-sm whitespace-pre-line text-muted-foreground">{area.description}</p>}
        </div>
        {scoresVisible && (
          <div className="shrink-0 text-right">
            <div className="text-lg font-semibold tabular-nums">{formatScore(area.score)}</div>
            <div className="text-xs text-muted-foreground">Area score / 10</div>
          </div>
        )}
      </div>
      {area.entries.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No periods have opened yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {area.entries.map((e) => {
              const open = expanded === e.id
              return (
                <Fragment key={e.id}>
                  <TableRow>
                    <TableCell>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left text-sm font-medium hover:underline"
                        aria-expanded={open}
                        onClick={() => setExpanded(open ? null : e.id)}
                      >
                        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                        {e.periodLabel}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(entryStatusClass(e.status, e.dueDate, today))}>
                        {entryStatusLabel(e.status, e.dueDate, today)}
                      </Badge>
                      {e.submittedLate && <span className="ml-1.5 text-xs text-danger-text">Late</span>}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatDate(e.dueDate)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {e.score ? <span className="font-medium">{e.score.value}</span> : e.status === "scored" && !scoresVisible ? <span className="text-xs text-muted-foreground">Not released yet</span> : "—"}
                    </TableCell>
                    <TableCell>
                      <RowActions entry={e} canDecide={canDecide} canCorrect={canCorrect} onCorrect={() => setCorrecting(e.id)} />
                    </TableCell>
                  </TableRow>
                  {(open || correcting === e.id) && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="whitespace-normal">
                        {correcting === e.id ? (
                          <ul>
                            <ScoreCard entry={e} canDownload={canDownload} onDone={() => setCorrecting(null)} />
                          </ul>
                        ) : (
                          <div className="grid gap-2 py-1">
                            {e.status === "not_applicable" && e.notApplicableReason && <p className="text-sm">Not applicable: {e.notApplicableReason}</p>}
                            {e.status === "changes_requested" && e.returnedComment && (
                              <p className="flex gap-2 text-sm text-danger-text">
                                <MessageSquareWarning className="mt-0.5 size-4 shrink-0" /> {e.returnedComment}
                              </p>
                            )}
                            {e.submittedAt || e.status === "scored" || e.status === "approved" ? (
                              <EntryEvidence entry={e} canDownload={canDownload} />
                            ) : (
                              <p className="text-sm text-muted-foreground">Nothing has been submitted yet.</p>
                            )}
                            <EntryApproval entry={e} />
                            {e.score && (
                              <p className="text-sm">
                                <span className="font-medium">Score {e.score.value}</span>
                                {e.score.comment && <span> · {e.score.comment}</span>}
                                <span className="block text-xs text-muted-foreground">
                                  {e.score.by ?? "Scorer"} · {formatDateTime(e.score.at)}
                                </span>
                              </p>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
