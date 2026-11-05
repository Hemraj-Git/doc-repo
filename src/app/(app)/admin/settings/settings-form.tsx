"use client"

import { useTransition } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { CalendarRange, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import { academicYearSummary, instituteSettingsSchema, MONTHS, type InstituteSettingsInput } from "@/lib/validation/settings"
import { updateInstituteSettings } from "./actions"

export function SettingsForm({ initial, canEdit }: { initial: InstituteSettingsInput; canEdit: boolean }) {
  const [pending, startTransition] = useTransition()
  const form = useForm({ resolver: zodResolver(instituteSettingsSchema), defaultValues: initial })
  const { errors, isDirty } = form.formState
  const startMonth = useWatch({ control: form.control, name: "academicYearStartMonth" })
  const year = academicYearSummary(startMonth)

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await updateInstituteSettings(values)
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) =>
          form.setError(field as keyof InstituteSettingsInput, { message })
        )
        toast.error(result.error)
        return
      }
      toast.success("Settings saved")
      form.reset(values)
    })
  )

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Institute</CardTitle>
          <CardDescription>Shown on verification slips and the public verification portal.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field id="set-name" label="Institute name" error={errors.instituteName?.message}>
            {(d) => <Input id="set-name" disabled={!canEdit} aria-describedby={d} {...form.register("instituteName")} />}
          </Field>
          <Field id="set-address" label="Address" optional error={errors.address?.message}>
            {(d) => <Textarea id="set-address" rows={2} disabled={!canEdit} aria-describedby={d} {...form.register("address")} />}
          </Field>
          <Field
            id="set-email"
            label="Contact email"
            optional
            error={errors.contactEmail?.message}
            hint="Where verifiers can send questions."
          >
            {(d) => <Input id="set-email" type="email" disabled={!canEdit} aria-describedby={d} {...form.register("contactEmail")} />}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarRange className="size-4" /> Academic year
          </CardTitle>
          <CardDescription>
            Recurring requirements are filed by academic year and semester. Semester 1 is the first six months of the
            academic year and Semester 2 the second six.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[14rem_1fr] sm:items-end">
          <Field id="set-month" label="Academic year starts in" error={errors.academicYearStartMonth?.message}>
            {(d) => (
              <Controller
                control={form.control}
                name="academicYearStartMonth"
                render={({ field }) => (
                  <OptionSelect
                    id="set-month"
                    options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                    value={String(field.value)}
                    onChange={(v) => v && field.onChange(Number(v))}
                    disabled={!canEdit}
                    aria-describedby={d}
                  />
                )}
              />
            )}
          </Field>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
            <dt className="text-muted-foreground">Academic year</dt>
            <dd>{year.span}</dd>
            <dt className="text-muted-foreground">Semester 1</dt>
            <dd>{year.semester1}</dd>
            <dt className="text-muted-foreground">Semester 2</dt>
            <dd>{year.semester2}</dd>
          </dl>
        </CardContent>
      </Card>

      {canEdit && (
        <div>
          <Button type="submit" disabled={pending || !isDirty}>
            {pending && <Loader2 className="animate-spin" />}
            Save settings
          </Button>
        </div>
      )}
    </form>
  )
}
