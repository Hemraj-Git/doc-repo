"use client"

import { useEffect, useMemo, useTransition } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Crown, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import { PersonCombobox } from "@/components/person-combobox"
import type { DepartmentRow, PersonOption, UserRow } from "@/lib/data/org"
import { userSchema } from "@/lib/validation/org"
import { createUser, updateUser } from "./actions"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Omit to add a new user. */
  user?: UserRow
  departments: DepartmentRow[]
  people: PersonOption[]
  canAssignHead: boolean
  defaultDepartmentId?: string
  onCreated: (credentials: { email: string; password: string }) => void
}

/** Ids of everyone below `rootId` (so a user cannot report to their own subordinate). */
function subtreeOf(rootId: string, people: PersonOption[]) {
  const below = new Set<string>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const p of people) {
      if (p.reportsToId && below.has(p.reportsToId) && !below.has(p.id)) {
        below.add(p.id)
        grew = true
      }
    }
  }
  return below
}

const EMPTY = {
  fullName: "",
  email: "",
  employeeCode: "",
  designation: "",
  phone: "",
  departmentId: "",
  reportsToId: null as string | null,
  makeHead: false,
}

export function UserDialog({
  open,
  onOpenChange,
  user,
  departments,
  people,
  canAssignHead,
  defaultDepartmentId,
  onCreated,
}: Props) {
  const editing = Boolean(user)
  const [pending, startTransition] = useTransition()

  const form = useForm({ resolver: zodResolver(userSchema), defaultValues: EMPTY })
  const { errors } = form.formState
  const departmentId = useWatch({ control: form.control, name: "departmentId" })
  const makeHead = useWatch({ control: form.control, name: "makeHead" })

  useEffect(() => {
    if (!open) return
    form.reset(
      user
        ? {
            fullName: user.fullName,
            email: user.email,
            employeeCode: user.employeeCode ?? "",
            designation: user.designation ?? "",
            phone: user.phone ?? "",
            departmentId: user.department.id,
            reportsToId: user.manager?.id ?? null,
            makeHead: user.isHead,
          }
        : { ...EMPTY, departmentId: defaultDepartmentId ?? "" }
    )
  }, [open, user, defaultDepartmentId, form])

  const department = departments.find((d) => d.id === departmentId)
  const excluded = useMemo(() => (user ? subtreeOf(user.id, people) : new Set<string>()), [user, people])
  // Staff report within their department; a head may report to someone outside it (e.g. the Director).
  const managers = useMemo(() => {
    const deptName = new Map(departments.map((d) => [d.id, d.name]))
    return people
      .filter((p) => !excluded.has(p.id) && (makeHead ? p.departmentId !== departmentId : p.departmentId === departmentId))
      .map((p) => ({
        value: p.id,
        label: p.fullName,
        hint: makeHead ? [p.designation, deptName.get(p.departmentId)].filter(Boolean).join(" · ") : p.designation,
      }))
  }, [people, departments, departmentId, excluded, makeHead])
  const replacingHead = makeHead && department?.head && department.head.id !== user?.id

  // A department's first member is normally its head.
  useEffect(() => {
    if (editing || !department) return
    form.setValue("makeHead", canAssignHead && !department.head && department.memberCount === 0)
  }, [department, editing, canAssignHead, form])

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      if (user) {
        const result = await updateUser(user.id, values)
        if (!result.ok) return showErrors(result)
        toast.success(`${values.fullName} updated`)
        onOpenChange(false)
        return
      }
      const result = await createUser(values)
      if (!result.ok) return showErrors(result)
      if (result.data.warning) toast.warning(result.data.warning)
      else toast.success(`${values.fullName} added`)
      onOpenChange(false)
      onCreated({ email: result.data.email, password: result.data.password })
    })
  )

  function showErrors(result: { error: string; fieldErrors?: Record<string, string> }) {
    Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) =>
      form.setError(field as keyof typeof EMPTY, { message })
    )
    toast.error(result.error)
  }

  const activeDepartments = departments
    .filter((d) => d.isActive || d.id === user?.department.id)
    .map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${user!.fullName}` : "Add user"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes are recorded in the audit log."
                : "Add people top-down: a manager must exist before the people who report to them. A temporary password is generated."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="user-name" label="Full name" error={errors.fullName?.message}>
              {(d) => <Input id="user-name" aria-describedby={d} aria-invalid={!!errors.fullName || undefined} {...form.register("fullName")} />}
            </Field>
            <Field id="user-email" label="Email" error={errors.email?.message}>
              {(d) => (
                <Input
                  id="user-email"
                  type="email"
                  autoComplete="off"
                  aria-describedby={d}
                  aria-invalid={!!errors.email || undefined}
                  {...form.register("email")}
                />
              )}
            </Field>
            <Field id="user-designation" label="Designation" optional error={errors.designation?.message}>
              {(d) => <Input id="user-designation" placeholder="e.g. Senior Lecturer" aria-describedby={d} {...form.register("designation")} />}
            </Field>
            <Field id="user-code" label="Employee code" optional error={errors.employeeCode?.message}>
              {(d) => <Input id="user-code" aria-describedby={d} aria-invalid={!!errors.employeeCode || undefined} {...form.register("employeeCode")} />}
            </Field>
            <Field id="user-phone" label="Phone" optional error={errors.phone?.message}>
              {(d) => <Input id="user-phone" type="tel" aria-describedby={d} {...form.register("phone")} />}
            </Field>
            <Field id="user-dept" label="Department" error={errors.departmentId?.message}>
              {(d) => (
                <Controller
                  control={form.control}
                  name="departmentId"
                  render={({ field }) => (
                    <OptionSelect
                      id="user-dept"
                      options={activeDepartments}
                      value={field.value || null}
                      onChange={(v) => {
                        field.onChange(v ?? "")
                        form.setValue("reportsToId", null)
                      }}
                      placeholder="Select department"
                      invalid={!!errors.departmentId}
                      aria-describedby={d}
                    />
                  )}
                />
              )}
            </Field>
          </div>

          {canAssignHead && department && (
            <label className="flex items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary/40 has-data-checked:bg-primary/5">
              <Controller
                control={form.control}
                name="makeHead"
                render={({ field }) => (
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(c) => {
                      field.onChange(Boolean(c))
                      // The valid managers differ for heads and staff.
                      form.setValue("reportsToId", null)
                    }}
                    className="mt-0.5"
                  />
                )}
              />
              <span className="grid gap-0.5 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <Crown className="size-3.5" /> Head of {department.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {replacingHead
                    ? `Replaces the current head, ${department.head!.fullName}.`
                    : "Owns the department's documents and sees all of them."}
                </span>
              </span>
            </label>
          )}

          <Field
            id="user-manager"
            label="Reports to"
            optional={makeHead}
            error={errors.reportsToId?.message}
            hint={
              !departmentId
                ? "Select a department first."
                : makeHead
                  ? "A department head can report to someone in another department, such as the Director, who then sees everything below them."
                  : managers.length === 0
                    ? "No one in this department yet. Add the department head first."
                    : "Seniors can see the documents of everyone below them."
            }
          >
            {(d) => (
              <Controller
                control={form.control}
                name="reportsToId"
                render={({ field }) => (
                  <PersonCombobox
                    id="user-manager"
                    people={managers}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder={makeHead ? "No manager (top level)" : "Search by name…"}
                    disabled={!departmentId || managers.length === 0}
                    invalid={!!errors.reportsToId}
                    aria-describedby={d}
                  />
                )}
              />
            )}
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {editing ? "Save changes" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
