"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { PersonCombobox } from "@/components/person-combobox"
import type { PersonOption, UserRow } from "@/lib/data/org"
import { getOpenWork, handOverAndDeactivate, setUserActive, type OpenWork } from "./actions"

type Props = { user: UserRow | null; people: PersonOption[]; onClose: () => void }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Deactivating someone with open work first asks who takes it over, so their
 * uploads and reviews are not left waiting on an account nobody can sign in to.
 */
export function DeactivateDialog({ user, people, onClose }: Props) {
  const [pending, setPending] = useState(false)
  return (
    <AlertDialog open={Boolean(user)} onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent>
        {/* Keyed by user, so each opening starts with fresh state. */}
        {user && <DeactivateBody key={user.id} user={user} people={people} onClose={onClose} onPending={setPending} />}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeactivateBody({ user, people, onClose, onPending }: Props & { user: UserRow; onPending: (p: boolean) => void }) {
  const [work, setWork] = useState<OpenWork | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [successor, setSuccessor] = useState<string | null>(null)
  const [moveReports, setMoveReports] = useState(true)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    getOpenWork(user.id).then((r) => {
      if (cancelled) return
      if (r.ok) setWork(r.data)
      else setLoadError(r.error)
    })
    return () => {
      cancelled = true
    }
  }, [user.id])

  useEffect(() => onPending(pending), [pending, onPending])

  const candidates = useMemo(
    () => people.filter((p) => p.id !== user.id).map((p) => ({ value: p.id, label: p.fullName, hint: p.designation })),
    [people, user.id]
  )

  const handOver = work ? work.uploads + work.reviews + work.series + work.kpi_reviews + work.kpi_scores : 0
  const reports = work?.reports ?? 0
  const needsSuccessor = handOver > 0 || (reports > 0 && moveReports)
  const items = work
    ? [
        work.uploads && plural(work.uploads, "open upload"),
        work.reviews && plural(work.reviews, "review"),
        work.series && plural(work.series, "recurring series", "recurring series"),
        work.kpi_reviews && plural(work.kpi_reviews, "KPI to review", "KPIs to review"),
        work.kpi_scores && plural(work.kpi_scores, "KPI to score", "KPIs to score"),
        work.reports && plural(work.reports, "direct report"),
        work.kpis && `${plural(work.kpis, "active KPI")} (these end; periods not yet submitted become not applicable)`,
      ].filter(Boolean)
    : []
  const loading = !work && !loadError

  const confirm = () =>
    startTransition(async () => {
      const result =
        needsSuccessor && successor
          ? await handOverAndDeactivate(user.id, successor, moveReports && reports > 0)
          : await setUserActive(user.id, false)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(needsSuccessor ? `${user.fullName} deactivated; their work was handed over` : `${user.fullName} deactivated`)
      onClose()
    })

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Deactivate {user.fullName}?</AlertDialogTitle>
        <AlertDialogDescription>
          They are signed out and can no longer sign in. Their documents and history are kept. Department heads must be replaced first.
        </AlertDialogDescription>
      </AlertDialogHeader>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Checking their open work…
        </p>
      )}
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {items.length > 0 && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
          <p>
            Still waiting on them: <span className="font-medium">{items.join(", ")}</span>.
          </p>
          {(handOver > 0 || reports > 0) && (
            <div className="space-y-1.5">
              <Label htmlFor="successor">Hand over to</Label>
              <PersonCombobox id="successor" people={candidates} value={successor} onChange={setSuccessor} />
              <p className="text-xs text-muted-foreground">
                Their open uploads, review steps, recurring series and KPIs to review move to this person, who is notified.
              </p>
            </div>
          )}
          {reports > 0 && (
            <label className="flex items-center gap-2">
              <Checkbox checked={moveReports} onCheckedChange={(c) => setMoveReports(Boolean(c))} />
              Their direct reports report to this person from now on
            </label>
          )}
        </div>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
        <Button variant="destructive" onClick={confirm} disabled={pending || loading || (needsSuccessor && !successor)}>
          {pending && <Loader2 className="animate-spin" />}
          {needsSuccessor ? "Hand over and deactivate" : "Deactivate"}
        </Button>
      </AlertDialogFooter>
    </>
  )
}
