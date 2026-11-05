"use client"

import { useState } from "react"
import { Crown, KeyRound, MoreHorizontal, Pencil, Plus, Power, PowerOff, ShieldCheck, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { StatusBadge } from "@/components/status-badge"
import { TempPasswordDialog } from "@/components/temp-password-dialog"
import type { DepartmentRow, PersonOption, RoleRow, UserRow } from "@/lib/data/org"
import { resetPassword, setUserActive } from "./actions"
import { DeactivateDialog } from "./deactivate-dialog"
import { UserDialog } from "./user-dialog"
import { UserRolesDialog } from "./user-roles-dialog"

type Props = {
  users: UserRow[]
  departments: DepartmentRow[]
  people: PersonOption[]
  roles: RoleRow[]
  currentUserId: string
  myPermissions: readonly string[]
  canAssignHead: boolean
  defaultDepartmentId?: string
}

type Credentials = { title: string; email: string; password: string }

export function UsersTable(props: Props) {
  const { users, departments, people, roles, currentUserId, myPermissions, canAssignHead, defaultDepartmentId } = props
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [rolesFor, setRolesFor] = useState<UserRow | null>(null)
  const [toggling, setToggling] = useState<UserRow | null>(null)
  const [resetting, setResetting] = useState<UserRow | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)

  const noDepartments = departments.filter((d) => d.isActive).length === 0
  const deptCode = new Map(departments.map((d) => [d.id, d.code]))

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {users.length} user{users.length === 1 ? "" : "s"}
        </p>
        <Button onClick={() => setAdding(true)} disabled={noDepartments} title={noDepartments ? "Create a department first" : undefined}>
          <Plus /> Add user
        </Button>
      </div>

      {users.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-14 text-center">
          <UserPlus className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No users match</p>
          <p className="text-sm text-muted-foreground">Change the filters, or add the department head first.</p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Reports to</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const extraRoles = u.roles.filter((r) => r.systemKey !== "employee" && r.systemKey !== "department_head")
                const isSelf = u.id === currentUserId
                return (
                  <TableRow key={u.id} className={u.isActive ? undefined : "text-muted-foreground"}>
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-medium">
                        {u.fullName}
                        {isSelf && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[u.email, u.employeeCode, u.designation].filter(Boolean).join(" · ")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {u.department.name}
                        {u.isHead && (
                          <Badge variant="secondary" className="gap-1">
                            <Crown className="size-3" /> Head
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.manager ? (
                        <>
                          {u.manager.fullName}
                          {u.manager.departmentId !== u.department.id && (
                            <span className="text-xs text-muted-foreground"> · {deptCode.get(u.manager.departmentId)}</span>
                          )}
                        </>
                      ) : u.isHead ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="text-xs text-amber-700">No manager</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {extraRoles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{u.isHead ? "Department Head" : "Employee"}</span>
                        ) : (
                          extraRoles.map((r) => (
                            <Badge key={r.id} variant="outline">
                              {r.name}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge active={u.isActive} />
                        {u.isActive && u.mustChangePassword && (
                          <span className="text-[11px] text-muted-foreground">Awaiting first sign-in</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.fullName}`} />}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setEditing(u)}>
                            <Pencil /> Edit details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRolesFor(u)}>
                            <ShieldCheck /> Roles
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setResetting(u)} disabled={isSelf || !u.isActive}>
                            <KeyRound /> Reset password
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant={u.isActive ? "destructive" : "default"}
                            onClick={() => setToggling(u)}
                            disabled={isSelf}
                          >
                            {u.isActive ? <PowerOff /> : <Power />} {u.isActive ? "Deactivate" : "Reactivate"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <UserDialog
        open={adding}
        onOpenChange={setAdding}
        departments={departments}
        people={people}
        canAssignHead={canAssignHead}
        defaultDepartmentId={defaultDepartmentId}
        onCreated={(c) => setCredentials({ title: "User added", ...c })}
      />
      <UserDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        user={editing ?? undefined}
        departments={departments}
        people={people}
        canAssignHead={canAssignHead}
        onCreated={() => {}}
      />
      <UserRolesDialog user={rolesFor} roles={roles} myPermissions={myPermissions} onClose={() => setRolesFor(null)} />
      <TempPasswordDialog credentials={credentials} onClose={() => setCredentials(null)} />

      <ConfirmDialog
        open={Boolean(resetting)}
        onOpenChange={(open) => !open && setResetting(null)}
        title={`Reset password for ${resetting?.fullName}?`}
        description="A new temporary password is generated. Their current password stops working immediately, and they must set a new one at next sign-in."
        confirmLabel="Reset password"
        onConfirm={async () => {
          if (!resetting) return
          const result = await resetPassword(resetting.id)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          setCredentials({ title: "Password reset", email: result.data.email, password: result.data.password })
        }}
      />
      <DeactivateDialog user={toggling?.isActive ? toggling : null} people={people} onClose={() => setToggling(null)} />
      <ConfirmDialog
        open={Boolean(toggling && !toggling.isActive)}
        onOpenChange={(open) => !open && setToggling(null)}
        title={`Reactivate ${toggling?.fullName}?`}
        description="They can sign in again with their existing password."
        confirmLabel="Reactivate"
        onConfirm={async () => {
          if (!toggling) return
          const result = await setUserActive(toggling.id, true)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success(`${toggling.fullName} reactivated`)
        }}
      />
    </>
  )
}
