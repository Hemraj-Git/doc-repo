"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Eye, ListChecks, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Field } from "@/components/field"
import type { AssignmentRow } from "@/lib/data/kpis"
import { formatDate } from "@/lib/format"
import { formatKpiScore, PROJECTED_SCORE_HINT } from "@/lib/kpis"
import { renewAssignments, setScoresReleased } from "../actions"
import { EmptyState } from "@/components/empty-state"

const addYear = (iso: string, days = 0) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function AssignmentsTable({ rows, canManage, today }: { rows: AssignmentRow[]; canManage: boolean; today: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renewing, setRenewing] = useState(false)
  const [dates, setDates] = useState({ start: "", end: "" })
  const [pending, startTransition] = useTransition()

  if (rows.length === 0) {
    return (
      <EmptyState icon={ListChecks}>
        <p className="font-medium">No KPI assignments match these filters</p>
      </EmptyState>
    )
  }

  const chosen = rows.filter((r) => selected.has(r.id))
  const openRenew = () => {
    const latest = chosen.reduce((m, r) => (r.endDate > m ? r.endDate : m), chosen[0]!.endDate)
    const start = nextDay(latest)
    setDates({ start, end: addYear(start, -1) })
    setRenewing(true)
  }
  const renew = () =>
    startTransition(async () => {
      const result = await renewAssignments(chosen.map((r) => r.id), dates.start, dates.end)
      if (!result.ok) return void toast.error(result.error)
      toast.success(`Renewed ${chosen.length} · ${result.data.created} periods opened`)
      setRenewing(false)
      setSelected(new Set())
    })
  const release = () =>
    startTransition(async () => {
      const result = await setScoresReleased(chosen.map((r) => r.id), true)
      if (!result.ok) return void toast.error(result.error)
      toast.success(`Scores released to ${chosen.length} ${chosen.length === 1 ? "person" : "people"}`)
      setSelected(new Set())
    })

  return (
    <>
      {canManage && chosen.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <span className="tabular-nums">{chosen.length} selected</span>
          <Button size="sm" variant="outline" onClick={openRenew}>
            <RefreshCw /> Renew for the next year
          </Button>
          <Button size="sm" variant="outline" onClick={release} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Eye />} Release scores
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canManage && (
                <TableHead className="w-0">
                  <Checkbox
                    aria-label="Select all"
                    checked={selected.size === rows.length}
                    onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </TableHead>
              )}
              <TableHead>Person</TableHead>
              <TableHead>KPI</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Submitted</TableHead>
              <TableHead className="text-right">Waiting</TableHead>
              <TableHead className="text-right">Missed</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Scores</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                {canManage && (
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${r.user.fullName}`}
                      checked={selected.has(r.id)}
                      onCheckedChange={(c) =>
                        setSelected((s) => {
                          const next = new Set(s)
                          if (c) next.add(r.id)
                          else next.delete(r.id)
                          return next
                        })
                      }
                    />
                  </TableCell>
                )}
                <TableCell>
                  <Link href={`/kpis/assignments/${r.id}`} className="font-medium hover:underline">
                    {r.user.fullName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {r.user.designation ?? "—"} · {r.department.code}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{r.kpiName}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {formatDate(r.startDate)} – {formatDate(r.endDate)}
                  {r.status === "active" && r.endDate < today && <div className="text-warning-text">Period over</div>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.summary.submitted + r.summary.approved + r.summary.scored}</TableCell>
                <TableCell className="text-right tabular-nums" title={`${r.summary.submitted} waiting for approval, ${r.summary.approved} waiting for score`}>
                  {r.summary.submitted + r.summary.approved}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${r.summary.overdue ? "font-medium text-destructive" : ""}`}>{r.summary.overdue}</TableCell>
                <TableCell className="text-right" title={r.summary.finalScore === null ? PROJECTED_SCORE_HINT : undefined}>
                  <div className="font-semibold tabular-nums">{formatKpiScore(r.summary.finalScore ?? r.summary.projectedScore)}</div>
                  <div className="text-xs text-muted-foreground">{r.summary.finalScore !== null ? (r.summary.finalRating ?? "Final") : "Projected"}</div>
                </TableCell>
                <TableCell className="text-xs">{r.scoresReleasedAt ? "Released" : "Hidden"}</TableCell>
                <TableCell>
                  <Badge variant={r.status === "active" ? "secondary" : "outline"}>{r.status === "active" ? "Active" : "Ended"}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={renewing} onOpenChange={setRenewing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renew {chosen.length} assignment{chosen.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              Creates a new assignment of the current KPI for the same people, reviewers and scorers, within one KPI year. Scores start hidden. The old ones stay as they are.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="rn-start" label="From">
              {(d) => <Input id="rn-start" type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} aria-describedby={d} />}
            </Field>
            <Field id="rn-end" label="To">
              {(d) => <Input id="rn-end" type="date" min={dates.start} value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })} aria-describedby={d} />}
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewing(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={renew} disabled={pending || !dates.start || !dates.end}>
              {pending && <Loader2 className="animate-spin" />}
              Renew
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
