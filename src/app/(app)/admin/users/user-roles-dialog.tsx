"use client"

import { useState, useTransition } from "react"
import { Loader2, Lock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { RoleRow, UserRow } from "@/lib/data/org"
import { setUserRoles } from "./actions"

/** Roles that follow from other data and cannot be ticked by hand. */
const AUTOMATIC: Record<string, string> = {
  employee: "Every user has this role.",
  department_head: "Follows the department's head. Change it on the Departments screen or in the user's details.",
}

type Props = {
  user: UserRow | null
  roles: RoleRow[]
  /** Permissions the signed-in admin holds; roles needing more cannot be granted. */
  myPermissions: readonly string[]
  onClose: () => void
}

export function UserRolesDialog({ user, roles, myPermissions, onClose }: Props) {
  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {user && <RolesForm key={user.id} user={user} roles={roles} myPermissions={myPermissions} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function RolesForm({ user, roles, myPermissions, onClose }: Props & { user: UserRow }) {
  const [selected, setSelected] = useState(() => new Set(user.roles.map((r) => r.id)))
  const [pending, startTransition] = useTransition()

  const canGrant = (role: RoleRow) => role.permissions.every((p) => myPermissions.includes(p))

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const save = () =>
    startTransition(async () => {
      const manual = roles.filter((r) => !AUTOMATIC[r.systemKey ?? ""] && selected.has(r.id)).map((r) => r.id)
      const result = await setUserRoles(user.id, manual)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Roles updated for ${user.fullName}`)
      onClose()
    })

  return (
    <>
      <DialogHeader>
        <DialogTitle>Roles · {user.fullName}</DialogTitle>
        <DialogDescription>A user&apos;s permissions are the combination of all their roles.</DialogDescription>
      </DialogHeader>

      <ul className="grid max-h-[55svh] gap-2 overflow-y-auto">
        {roles.map((role) => {
          const automatic = AUTOMATIC[role.systemKey ?? ""]
          const blocked = !automatic && !canGrant(role)
          const disabled = Boolean(automatic) || blocked
          return (
            <li key={role.id}>
              <label className="flex items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary/40 has-data-checked:bg-primary/5 has-data-disabled:opacity-70">
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(role.id)}
                  onCheckedChange={(c) => toggle(role.id, Boolean(c))}
                  disabled={disabled}
                />
                <span className="grid gap-0.5 text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    {role.name}
                    {disabled && <Lock className="size-3 text-muted-foreground" />}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {automatic ??
                      (blocked
                        ? "You can only assign roles whose permissions you hold yourself."
                        : (role.description ?? `${role.permissions.length} permissions`))}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save roles
        </Button>
      </DialogFooter>
    </>
  )
}
