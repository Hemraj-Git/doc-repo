"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CircleStop, Eye, EyeOff, Loader2, Play, RefreshCw, Send, UserCog } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import { changeReviewer, changeScorer, pushKpiUpdates, renewAssignments, setAssignmentStatus, setScoresReleased } from "../../actions"

type Props = {
  id: string
  status: "active" | "ended"
  /** HR: end, reopen, renew, change the reviewer or scorer, hide scores. */
  canChange: boolean
  /** The scorer or HR. */
  canRelease: boolean
  released: boolean
  undecided: number
  outdated: boolean
  endDate: string
  reviewerId: string | null
  scorerId: string | null
  people: PersonItem[]
  personId: string
  legacy: boolean
}

const shift = (iso: string, years: number, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + years)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function AssignmentActions({ id, status, canChange, canRelease, released, undecided, outdated, endDate, reviewerId, scorerId, people, personId, legacy }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [ending, setEnding] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [changing, setChanging] = useState(false)
  const [nextReviewer, setNextReviewer] = useState<string | null>(reviewerId)
  const [changingScorer, setChangingScorer] = useState(false)
  const [nextScorer, setNextScorer] = useState<string | null>(scorerId)
  const [dates, setDates] = useState({ start: shift(endDate, 0, 1), end: shift(endDate, 1, 0) })

  const reopen = () =>
    startTransition(async () => {
      const result = await setAssignmentStatus(id, true)
      if (!result.ok) return void toast.error(result.error)
      toast.success(result.data.created ? `Reopened · ${result.data.created} periods opened` : "Reopened")
    })
  const push = () =>
    startTransition(async () => {
      const result = await pushKpiUpdates([id])
      if (!result.ok) return void toast.error(result.error)
      toast.success(result.data.added ? `Added ${result.data.added} new area${result.data.added === 1 ? "" : "s"}` : "Updated to the KPI's current weights")
    })
  const renew = () =>
    startTransition(async () => {
      const result = await renewAssignments([id], dates.start, dates.end)
      if (!result.ok) return void toast.error(result.error)
      toast.success(`Renewed · ${result.data.created} periods opened`)
      setRenewing(false)
      router.push("/kpis/assignments")
    })
  const hide = () =>
    startTransition(async () => {
      const result = await setScoresReleased([id], false)
      if (!result.ok) return void toast.error(result.error)
      toast.success("Scores hidden from the person")
    })
  const saveReviewer = () =>
    startTransition(async () => {
      if (!nextReviewer) return
      const result = await changeReviewer(id, nextReviewer)
      if (!result.ok) return void toast.error(result.error)
      toast.success("Reviewer changed. They have been notified.")
      setChanging(false)
    })
  const saveScorer = () =>
    startTransition(async () => {
      if (!nextScorer) return
      const result = await changeScorer(id, nextScorer)
      if (!result.ok) return void toast.error(result.error)
      toast.success("Scorer changed. They have been notified.")
      setChangingScorer(false)
    })

  if (legacy) return null

  return (
    <div className="flex flex-wrap gap-2">
      {canRelease && !released && (
        <Button onClick={() => setReleasing(true)} disabled={pending}>
          <Eye /> Release scores
        </Button>
      )}
      {canChange && released && (
        <Button variant="outline" onClick={hide} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <EyeOff />} Hide scores
        </Button>
      )}
      {outdated && status === "active" && canChange && (
        <Button variant="outline" onClick={push} disabled={pending} title="The KPI has changed since this was assigned">
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          Apply KPI changes
        </Button>
      )}
      {canChange && (
        <>
          <Button variant="outline" onClick={() => setChanging(true)} disabled={pending}>
            <UserCog /> Change reviewer
          </Button>
          <Button variant="outline" onClick={() => setChangingScorer(true)} disabled={pending}>
            <UserCog /> {scorerId ? "Change scorer" : "Set scorer"}
          </Button>
          <Button variant="outline" onClick={() => setRenewing(true)} disabled={pending}>
            <RefreshCw /> Renew
          </Button>
          {status === "active" ? (
            <Button variant="outline" onClick={() => setEnding(true)} disabled={pending}>
              <CircleStop /> End
            </Button>
          ) : (
            <Button variant="outline" onClick={reopen} disabled={pending}>
              <Play /> Reopen
            </Button>
          )}
        </>
      )}
      <ConfirmDialog
        open={releasing}
        onOpenChange={setReleasing}
        title="Release scores to this person?"
        description={
          undecided > 0
            ? `${undecided} ${undecided === 1 ? "period is" : "periods are"} still undecided. Once released, they can see every score and comment, including any added later, and they are notified.`
            : "They can see every score and comment, including any added later, and they are notified."
        }
        confirmLabel="Release"
        onConfirm={async () => {
          const result = await setScoresReleased([id], true)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success("Scores released")
        }}
      />
      <ConfirmDialog
        open={ending}
        onOpenChange={setEnding}
        title="End this KPI assignment?"
        description="No new periods open and the person can no longer submit. The reviewer and scorer can still decide the remaining periods; the Final Score is generated once they are all decided."
        confirmLabel="End"
        destructive
        onConfirm={async () => {
          const result = await setAssignmentStatus(id, false)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success("Ended")
        }}
      />
      <Dialog open={changing} onOpenChange={setChanging}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change the reviewer</DialogTitle>
            <DialogDescription>The new reviewer approves everything still waiting and any period after this. Approvals already given stay as they are.</DialogDescription>
          </DialogHeader>
          <PersonCombobox people={people.filter((p) => p.value !== personId)} value={nextReviewer} onChange={setNextReviewer} placeholder="Reviewer" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setChanging(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={saveReviewer} disabled={pending || !nextReviewer || nextReviewer === reviewerId}>
              {pending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={changingScorer} onOpenChange={setChangingScorer}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{scorerId ? "Change the scorer" : "Set the scorer"}</DialogTitle>
            <DialogDescription>The scorer gives everything already approved, and any period after this, a score from 1 to 10. Scores already given stay as they are.</DialogDescription>
          </DialogHeader>
          <PersonCombobox people={people.filter((p) => p.value !== personId)} value={nextScorer} onChange={setNextScorer} placeholder="Scorer" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangingScorer(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={saveScorer} disabled={pending || !nextScorer || nextScorer === scorerId}>
              {pending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={renewing} onOpenChange={setRenewing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renew for the next year</DialogTitle>
            <DialogDescription>A new assignment of the current KPI, with the same reviewer and scorer. It must fall within one KPI year, and its scores start hidden.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="arn-start" label="From">
              {(d) => <Input id="arn-start" type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} aria-describedby={d} />}
            </Field>
            <Field id="arn-end" label="To">
              {(d) => <Input id="arn-end" type="date" min={dates.start} value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })} aria-describedby={d} />}
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewing(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={renew} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Renew
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
