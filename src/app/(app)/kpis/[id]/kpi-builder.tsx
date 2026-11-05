"use client"

import { useState, useTransition } from "react"
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import type { Kpi, KpiArea } from "@/lib/data/kpis"
import { KPI_RECURRENCE_LABELS, kpiPeriodExample, type KpiRecurrence } from "@/lib/kpis"
import { cn } from "@/lib/utils"
import { deleteArea, moveArea, saveArea } from "../actions"

type Props = { kpi: Kpi; canManage: boolean }

const INTERVALS = (Object.keys(KPI_RECURRENCE_LABELS) as KpiRecurrence[]).map((k) => ({ value: k, label: KPI_RECURRENCE_LABELS[k] }))
const BAR_COLOURS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"]

export function KpiBuilder({ kpi, canManage }: Props) {
  const [pending, startTransition] = useTransition()
  const [areaDialog, setAreaDialog] = useState<KpiArea | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<KpiArea | null>(null)
  const total = kpi.areas.reduce((s, a) => s + a.weightage, 0)

  const move = (id: string, direction: "up" | "down") =>
    startTransition(async () => {
      const result = await moveArea(kpi.id, id, direction)
      if (!result.ok) toast.error(result.error)
    })

  return (
    <div className="grid gap-6">
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">Weightage</span>
          <span className={cn("tabular-nums", total === 100 ? "text-success-text" : "text-warning-text")}>
            {total}% of 100%{total !== 100 && ` · ${total < 100 ? `${100 - total}% left to assign` : `${total - 100}% too much`}`}
          </span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted">
          {kpi.areas.map((a, i) => (
            <div key={a.id} title={`${a.name} ${a.weightage}%`} className={cn("h-full", BAR_COLOURS[i % BAR_COLOURS.length])} style={{ width: `${Math.min(a.weightage, 100)}%` }} />
          ))}
        </div>
      </section>

      {kpi.areas.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          No areas yet. Add the areas this role is measured on, e.g. Teaching 40% monthly, Research 30% quarterly, Administration 30% annually.
        </div>
      ) : (
        <ul className="grid gap-3">
          {kpi.areas.map((area, i) => (
            <li key={area.id} className="flex flex-wrap items-start gap-3 rounded-xl border bg-card p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{area.name}</h2>
                  <Badge>{area.weightage}%</Badge>
                  <Badge variant={area.recurrence === "once" ? "outline" : "secondary"}>{KPI_RECURRENCE_LABELS[area.recurrence]}</Badge>
                </div>
                {area.description ? (
                  <p className="text-sm whitespace-pre-line text-muted-foreground">{area.description}</p>
                ) : (
                  <p className="text-sm text-warning-text">Say what is measured.</p>
                )}
              </div>
              {canManage && (
                <span className="flex items-center">
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${area.name} up`} disabled={i === 0 || pending} onClick={() => move(area.id, "up")}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${area.name} down`} disabled={i === kpi.areas.length - 1 || pending} onClick={() => move(area.id, "down")}>
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${area.name}`} onClick={() => setAreaDialog(area)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${area.name}`} onClick={() => setDeleting(area)}>
                    <Trash2 />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div>
          <Button variant="outline" onClick={() => setAreaDialog(null)}>
            <Plus /> Add area
          </Button>
        </div>
      )}

      {areaDialog !== undefined && (
        <AreaDialog
          kpiId={kpi.id}
          yearStartMonth={kpi.yearStartMonth}
          area={areaDialog}
          remaining={100 - total + (areaDialog?.weightage ?? 0)}
          onClose={() => setAreaDialog(undefined)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete area “${deleting?.name ?? ""}”?`}
        description="People already assigned keep their records; new assignments won't include it."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          const result = await deleteArea(kpi.id, deleting.id)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success("Deleted")
        }}
      />
    </div>
  )
}

function AreaDialog({ kpiId, yearStartMonth, area, remaining, onClose }: { kpiId: string; yearStartMonth: number; area: KpiArea | null; remaining: number; onClose: () => void }) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(area?.name ?? "")
  const [weightage, setWeightage] = useState(String(area?.weightage ?? Math.max(remaining, 0)))
  const [description, setDescription] = useState(area?.description ?? "")
  const [recurrence, setRecurrence] = useState<KpiRecurrence>(area?.recurrence ?? "monthly")
  const [errors, setErrors] = useState<Record<string, string>>({})

  const save = () =>
    startTransition(async () => {
      const result = await saveArea(kpiId, area?.id ?? null, { name, weightage: Number(weightage), description, recurrence })
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {})
        return void toast.error(result.error)
      }
      toast.success(area ? "Area saved" : "Area added")
      onClose()
    })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{area ? `Edit ${area.name}` : "Add area"}</DialogTitle>
          <DialogDescription>A requirement the person is measured on. All areas together must total 100%.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
          <Field id="area-name" label="Area" error={errors.name}>
            {(d) => <Input id="area-name" autoFocus placeholder="e.g. Teaching" value={name} onChange={(e) => setName(e.target.value)} aria-describedby={d} />}
          </Field>
          <Field id="area-weight" label="Weight %" error={errors.weightage}>
            {(d) => <Input id="area-weight" type="number" min={0.5} max={100} step={0.5} value={weightage} onChange={(e) => setWeightage(e.target.value)} aria-describedby={d} />}
          </Field>
        </div>
        <Field id="area-description" label="What is measured" error={errors.description}>
          {(d) => (
            <Textarea
              id="area-description"
              rows={3}
              placeholder="e.g. Lessons delivered, student feedback, results"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby={d}
            />
          )}
        </Field>
        <Field id="area-interval" label="Interval" hint={`The person fills in ${kpiPeriodExample(recurrence, yearStartMonth)}.`}>
          {(d) => (
            <OptionSelect id="area-interval" options={INTERVALS} value={recurrence} onChange={(v) => v && setRecurrence(v as KpiRecurrence)} aria-describedby={d} />
          )}
        </Field>
        {!area && remaining > 0 && <p className="text-xs text-muted-foreground">{remaining}% is still unassigned.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
