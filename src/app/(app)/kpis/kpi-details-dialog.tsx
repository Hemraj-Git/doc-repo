"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Pencil, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import { KPI_REVIEWER_LABELS, KPI_SCORER_PERSON, YEAR_PRESETS, type KpiReviewerRule } from "@/lib/kpis"
import { MONTHS } from "@/lib/validation/settings"
import { kpiDetailsSchema, type KpiDetailsInput } from "@/lib/validation/kpis"
import { createKpi, updateKpi } from "./actions"

type Props = {
  kpi?: { id: string } & KpiDetailsInput
  designations: string[]
  people: PersonItem[]
  /** Departments whose head can score, e.g. HR and Quality. */
  scorerDepartments: { id: string; name: string }[]
}

const EMPTY: KpiDetailsInput = {
  name: "",
  designation: "",
  description: "",
  yearStartMonth: 4,
  reviewerRule: "uploader_manager",
  reviewerUserId: null,
  scorer: null,
  scorerUserId: null,
  dueDays: 7,
}
const REVIEWER_OPTIONS = (Object.keys(KPI_REVIEWER_LABELS) as KpiReviewerRule[]).map((k) => ({ value: k, label: KPI_REVIEWER_LABELS[k] }))

/** Name, designation, year, reviewer, scorer and submission window of a KPI: create (button) or edit. */
export function KpiDetailsDialog({ kpi, designations, people, scorerDepartments }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const form = useForm<KpiDetailsInput>({ resolver: zodResolver(kpiDetailsSchema), defaultValues: kpi ?? EMPTY })
  const { errors } = form.formState
  const reviewerRule = useWatch({ control: form.control, name: "reviewerRule" })
  const scorer = useWatch({ control: form.control, name: "scorer" })
  const scorerOptions = [...scorerDepartments.map((d) => ({ value: d.id, label: `Head of ${d.name}` })), { value: KPI_SCORER_PERSON, label: "A specific person" }]

  useEffect(() => {
    if (open) form.reset(kpi ?? EMPTY)
  }, [open, kpi, form])

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = kpi ? await updateKpi(kpi.id, values) : await createKpi(values)
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([f, message]) => form.setError(f as keyof KpiDetailsInput, { message }))
        return void toast.error(result.error)
      }
      setOpen(false)
      if (kpi) toast.success("Saved")
      else {
        toast.success(`“${values.name}” created — now add its areas`)
        router.push(`/kpis/${(result.data as { id: string }).id}`)
      }
    })
  )

  return (
    <>
      {kpi ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Pencil /> Edit details
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus /> New KPI
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{kpi ? "KPI details" : "New KPI"}</DialogTitle>
              <DialogDescription>
                Name it by role, e.g. “Faculty KPI” or “Simulator Incharge KPI”. One KPI can be assigned to everyone in that role.
              </DialogDescription>
            </DialogHeader>
            <Field id="kpi-name" label="Name" error={errors.name?.message}>
              {(d) => <Input id="kpi-name" autoFocus placeholder="e.g. Faculty KPI" aria-describedby={d} {...form.register("name")} />}
            </Field>
            <Field
              id="kpi-designation"
              label="For designation"
              optional
              error={errors.designation?.message}
              hint="Used to pre-select people when assigning."
            >
              {(d) => (
                <>
                  <Input id="kpi-designation" list="kpi-designations" placeholder="e.g. Faculty" aria-describedby={d} {...form.register("designation")} />
                  <datalist id="kpi-designations">
                    {designations.map((x) => (
                      <option key={x} value={x} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field
              id="kpi-year"
              label="Year starts in"
              hint={`Quarters, halves and years follow this. ${YEAR_PRESETS.map((p) => p.label).join(" · ")}.`}
            >
              {(d) => (
                <Controller
                  control={form.control}
                  name="yearStartMonth"
                  render={({ field }) => (
                    <OptionSelect
                      id="kpi-year"
                      options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                      value={String(field.value)}
                      onChange={(v) => v && field.onChange(Number(v))}
                      aria-describedby={d}
                    />
                  )}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <Field id="kpi-reviewer" label="Reviewer" hint="Approves each period before it is scored. HR can choose someone else when assigning.">
                {(d) => (
                  <Controller
                    control={form.control}
                    name="reviewerRule"
                    render={({ field }) => (
                      <OptionSelect
                        id="kpi-reviewer"
                        options={REVIEWER_OPTIONS}
                        value={field.value}
                        onChange={(v) => {
                          field.onChange(v ?? "uploader_manager")
                          if (v !== "fixed") form.setValue("reviewerUserId", null)
                        }}
                        aria-describedby={d}
                      />
                    )}
                  />
                )}
              </Field>
              <Field id="kpi-due" label="Submit within" hint="Days after each period ends" error={errors.dueDays?.message}>
                {(d) => <Input id="kpi-due" type="number" min={0} max={90} aria-describedby={d} {...form.register("dueDays", { valueAsNumber: true })} />}
              </Field>
            </div>
            {reviewerRule === "fixed" && (
              <Field id="kpi-reviewer-person" label="Reviewer" error={errors.reviewerUserId?.message}>
                {(d) => (
                  <Controller
                    control={form.control}
                    name="reviewerUserId"
                    render={({ field }) => (
                      <PersonCombobox
                        id="kpi-reviewer-person"
                        people={people}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="e.g. the Quality Head"
                        aria-describedby={d}
                      />
                    )}
                  />
                )}
              </Field>
            )}
            <Field id="kpi-scorer" label="Scorer" error={errors.scorer?.message} hint="Scores each approved period from 1 to 10. HR can choose someone else when assigning.">
              {(d) => (
                <Controller
                  control={form.control}
                  name="scorer"
                  render={({ field }) => (
                    <OptionSelect
                      id="kpi-scorer"
                      options={scorerOptions}
                      value={field.value}
                      placeholder="Choose the scorer"
                      invalid={Boolean(errors.scorer)}
                      onChange={(v) => {
                        field.onChange(v)
                        if (v !== KPI_SCORER_PERSON) form.setValue("scorerUserId", null)
                      }}
                      aria-describedby={d}
                    />
                  )}
                />
              )}
            </Field>
            {scorer === KPI_SCORER_PERSON && (
              <Field id="kpi-scorer-person" label="Scorer" error={errors.scorerUserId?.message}>
                {(d) => (
                  <Controller
                    control={form.control}
                    name="scorerUserId"
                    render={({ field }) => (
                      <PersonCombobox id="kpi-scorer-person" people={people} value={field.value} onChange={field.onChange} placeholder="e.g. the HR Manager" aria-describedby={d} />
                    )}
                  />
                )}
              </Field>
            )}
            <Field id="kpi-description" label="Description" optional error={errors.description?.message}>
              {(d) => <Textarea id="kpi-description" rows={3} aria-describedby={d} {...form.register("description")} />}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {kpi ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
