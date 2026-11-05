"use client"

import { useState, useTransition } from "react"
import { CalendarRange, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/field"
import { setInstanceDates } from "../template-actions"

type Props = { instanceId: string; name: string; startDate: string; endDate: string | null; endRequired: boolean }

/** Corrects the start / end date of a program, semester, … */
export function InstanceDatesButton({ instanceId, name, startDate, endDate, endRequired }: Props) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(startDate)
  const [end, setEnd] = useState(endDate ?? "")
  const [pending, startTransition] = useTransition()

  const save = () =>
    startTransition(async () => {
      if (!start) return void toast.error("Enter the start date.")
      if (endRequired && !end) return void toast.error("Enter the end date.")
      if (end && end < start) return void toast.error("The end date must be after the start date.")
      const result = await setInstanceDates(instanceId, start, end || null)
      if (!result.ok) return void toast.error(result.error)
      toast.success(result.data.created ? `Dates saved · ${result.data.created} requirements created` : "Dates saved")
      setOpen(false)
    })

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setStart(startDate)
          setEnd(endDate ?? "")
          setOpen(true)
        }}
      >
        <CalendarRange /> Edit dates
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dates · {name}</DialogTitle>
            <DialogDescription>
              Recurring files inside run only between these dates. Folders inside that used the same dates (e.g. its subjects) are updated too.
              Moving the start earlier creates the periods that now fall inside it; moving it later keeps files already created.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="idates-start" label="Start date">
              {(d) => <Input id="idates-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-describedby={d} />}
            </Field>
            <Field id="idates-end" label="End date" optional={!endRequired}>
              {(d) => <Input id="idates-end" type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} aria-describedby={d} />}
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
