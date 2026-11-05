"use client"

import { useState } from "react"
import Link from "next/link"
import { Building2, MoreHorizontal, Pencil, Plus, Power, PowerOff, Users } from "lucide-react"
import { toast } from "sonner"
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
import type { DepartmentRow, PersonOption } from "@/lib/data/org"
import { setDepartmentActive } from "./actions"
import { DepartmentDialog } from "./department-dialog"
import { EmptyState } from "@/components/empty-state"

type Props = { departments: DepartmentRow[]; people: PersonOption[] }

export function DepartmentsTable({ departments, people }: Props) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<DepartmentRow | null>(null)
  const [toggling, setToggling] = useState<DepartmentRow | null>(null)

  const membersOf = (deptId: string) => people.filter((p) => p.departmentId === deptId)

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus /> New department
        </Button>
      </div>

      {departments.length === 0 ? (
        <EmptyState icon={Building2}>
          <p className="font-medium">No departments yet</p>
          <p className="text-sm text-muted-foreground">Create departments first, then add their users.</p>
        </EmptyState>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Head</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((d) => (
                <TableRow key={d.id} className={d.isActive ? undefined : "text-muted-foreground"}>
                  <TableCell>
                    <div className="font-medium">{d.name}</div>
                    {d.description && <div className="max-w-md truncate text-xs text-muted-foreground">{d.description}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{d.code}</TableCell>
                  <TableCell>
                    {d.head ? (
                      d.head.fullName
                    ) : (
                      <span className="text-xs text-warning-text">Not assigned</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Link href={`/admin/users?dept=${d.id}`} className="hover:underline">
                      {d.memberCount}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge active={d.isActive} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.name}`} />}
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(d)}>
                          <Pencil /> Edit / assign head
                        </DropdownMenuItem>
                        <DropdownMenuItem render={<Link href={`/admin/users?dept=${d.id}`} />}>
                          <Users /> View users
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant={d.isActive ? "destructive" : "default"}
                          onClick={() => setToggling(d)}
                        >
                          {d.isActive ? <PowerOff /> : <Power />} {d.isActive ? "Deactivate" : "Reactivate"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DepartmentDialog open={creating} onOpenChange={setCreating} members={[]} />
      <DepartmentDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        department={editing ?? undefined}
        members={editing ? membersOf(editing.id) : []}
      />
      <ConfirmDialog
        open={Boolean(toggling)}
        onOpenChange={(open) => !open && setToggling(null)}
        title={toggling?.isActive ? `Deactivate ${toggling?.name}?` : `Reactivate ${toggling?.name}?`}
        description={
          toggling?.isActive
            ? "Only a department without active users can be deactivated. Its folders and documents are kept."
            : "Users can be added to the department again."
        }
        confirmLabel={toggling?.isActive ? "Deactivate" : "Reactivate"}
        destructive={toggling?.isActive}
        onConfirm={async () => {
          if (!toggling) return
          const result = await setDepartmentActive(toggling.id, !toggling.isActive)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success(toggling.isActive ? "Department deactivated" : "Department reactivated")
        }}
      />
    </>
  )
}
