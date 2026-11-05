"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { CircleStop, Loader2, MoreHorizontal, Pause, Play, Repeat, RotateCcw, UserCog } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import type { SeriesRow } from "@/lib/data/instances"
import { formatDate, todayIso } from "@/lib/format"
import { RECURRENCE_LABELS } from "@/lib/templates"
import { reassignSeries, setSeriesEnd, setSeriesPaused } from "../template-actions"

type Props = { series: SeriesRow[]; departmentCode: string; canManage: boolean; people: PersonItem[] }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function SeriesList({ series, departmentCode, canManage, people }: Props) {
  const [editing, setEditing] = useState<SeriesRow | null>(null)
  const [uploader, setUploader] = useState<string | null>(null)
  const [moveOpen, setMoveOpen] = useState(true)
  const [pending, startTransition] = useTransition()

  if (series.length === 0) return null
  const today = todayIso()

  const save = () =>
    startTransition(async () => {
      if (!editing || !uploader) return
      const result = await reassignSeries(editing.id, uploader, moveOpen)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Uploader changed")
      setEditing(null)
    })

  const control = (action: () => Promise<{ ok: true; data: { created: number } } | { ok: false; error: string }>, done: string) =>
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.data.created ? `${done} · ${plural(result.data.created, "requirement")} created` : done)
    })

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
        <Repeat className="size-4" /> Recurring files <span className="tabular-nums">({series.length})</span>
      </h2>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Repeats</TableHead>
              <TableHead>Uploader</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">Done</TableHead>
              <TableHead>Created up to</TableHead>
              {canManage && (
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {series.map((s) => {
              const ended = Boolean(s.endDate && s.endDate <= today)
              return (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <Link href={`/repository/${departmentCode}/${s.folder.id}`} className="text-xs text-muted-foreground hover:underline">
                      {s.folder.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{RECURRENCE_LABELS[s.recurrence]}</Badge>
                    {s.isPaused && (
                      <Badge variant="outline" className="ml-1">
                        Paused
                      </Badge>
                    )}
                    {s.requirementsFrom && (
                      <Badge variant="outline" className="ml-1" title="Requirements before this date were not created">
                        From {formatDate(s.requirementsFrom)}
                      </Badge>
                    )}
                    {s.endDate && (
                      <Badge variant="outline" className="ml-1">
                        {ended ? "Ended" : "Ends"} {formatDate(s.endDate)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{s.uploader.fullName}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.openCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.closedCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.lastPeriodEnd ? formatDate(s.lastPeriodEnd) : "—"}</TableCell>
                  {canManage && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`} disabled={pending} />}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditing(s)
                              setUploader(s.uploader.id)
                              setMoveOpen(true)
                            }}
                          >
                            <UserCog /> Change uploader
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {s.isPaused ? (
                            <DropdownMenuItem onClick={() => control(() => setSeriesPaused(s.id, false), "Resumed from the current period")}>
                              <Play /> Resume
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => control(() => setSeriesPaused(s.id, true), "Paused")}>
                              <Pause /> Pause
                            </DropdownMenuItem>
                          )}
                          {s.endDate ? (
                            <DropdownMenuItem onClick={() => control(() => setSeriesEnd(s.id, null), "End date removed")}>
                              <RotateCcw /> Remove end date
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => control(() => setSeriesEnd(s.id, today), "Ended after the current period")}
                            >
                              <CircleStop /> End after this period
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Paused or ended files restart from the current period; missed periods are not created.
      </p>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change uploader · {editing?.name}</DialogTitle>
            <DialogDescription>Applies to every future period of “{editing?.name}” in {editing?.folder.name}.</DialogDescription>
          </DialogHeader>
          <PersonCombobox people={people} value={uploader} onChange={setUploader} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={moveOpen} onCheckedChange={(c) => setMoveOpen(Boolean(c))} />
            Also move the {plural(editing?.openCount ?? 0, "open requirement")} to them
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!uploader || pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
