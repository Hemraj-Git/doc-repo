"use client"

import { useTransition } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Lock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import type { PermissionRow, RoleRow } from "@/lib/data/org"
import { roleSchema } from "@/lib/validation/org"
import { createRole, updateRole } from "./actions"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Omit to create a custom role. */
  role?: RoleRow
  permissions: PermissionRow[]
  myPermissions: readonly string[]
}

export function RoleDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {props.open && <RoleForm key={props.role?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function RoleForm({ onOpenChange, role, permissions, myPermissions }: Props) {
  const [pending, startTransition] = useTransition()
  const isSystem = Boolean(role?.isSystem)
  const form = useForm({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      name: role?.name ?? "",
      description: role?.description ?? "",
      permissions: role?.permissions ?? [],
    },
  })
  const { errors } = form.formState

  const categories = [...new Set(permissions.map((p) => p.category))]

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = role ? await updateRole(role.id, values) : await createRole(values)
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) =>
          form.setError(field as "name" | "description", { message })
        )
        toast.error(result.error)
        return
      }
      toast.success(role ? `${values.name} updated` : `Role “${values.name}” created`)
      onOpenChange(false)
    })
  )

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
        <DialogDescription>
          {isSystem
            ? "System roles keep their name, but their permissions can be adjusted."
            : "Custom roles are added on top of a user's Employee role."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
        <Field id="role-name" label="Name" error={errors.name?.message}>
          {(d) => (
            <Input
              id="role-name"
              placeholder="e.g. Quality Auditor"
              disabled={isSystem}
              aria-describedby={d}
              aria-invalid={!!errors.name || undefined}
              {...form.register("name")}
            />
          )}
        </Field>
        <Field id="role-description" label="Description" optional error={errors.description?.message}>
          {(d) => <Textarea id="role-description" rows={1} disabled={isSystem} aria-describedby={d} {...form.register("description")} />}
        </Field>
      </div>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-sm font-medium">Permissions</legend>
        <Controller
          control={form.control}
          name="permissions"
          render={({ field }) => {
            const set = new Set(field.value)
            const toggle = (key: string, on: boolean) => {
              const next = new Set(set)
              if (on) next.add(key)
              else next.delete(key)
              field.onChange([...next])
            }
            return (
              <div className="grid gap-4">
                {categories.map((category) => (
                  <div key={category} className="grid gap-1.5">
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{category}</div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {permissions
                        .filter((p) => p.category === category)
                        .map((p) => {
                          const held = myPermissions.includes(p.key)
                          return (
                            <label
                              key={p.key}
                              className="flex items-start gap-2.5 rounded-lg border p-2.5 has-data-checked:border-primary/40 has-data-checked:bg-primary/5 has-data-disabled:opacity-60"
                              title={held ? undefined : "You can only grant permissions you hold yourself"}
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={set.has(p.key)}
                                onCheckedChange={(c) => toggle(p.key, Boolean(c))}
                                disabled={!held}
                              />
                              <span className="grid gap-0.5">
                                <span className="flex items-center gap-1 font-mono text-xs">
                                  {p.key}
                                  {!held && <Lock className="size-3" />}
                                </span>
                                <span className="text-xs text-muted-foreground">{p.description}</span>
                              </span>
                            </label>
                          )
                        })}
                    </div>
                  </div>
                ))}
              </div>
            )
          }}
        />
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {role ? "Save changes" : "Create role"}
        </Button>
      </DialogFooter>
    </form>
  )
}
