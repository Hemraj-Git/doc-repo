"use client"

import { Fragment, useState } from "react"
import Link from "next/link"
import { Check, Lock, Pencil, Plus, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmDialog } from "@/components/confirm-dialog"
import type { PermissionRow, RoleRow } from "@/lib/data/org"
import { deleteRole } from "./actions"
import { RoleDialog } from "./role-dialog"

type Props = { roles: RoleRow[]; permissions: PermissionRow[]; myPermissions: readonly string[] }

export function RolesView({ roles, permissions, myPermissions }: Props) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<RoleRow | null>(null)
  const [deleting, setDeleting] = useState<RoleRow | null>(null)
  const categories = [...new Set(permissions.map((p) => p.category))]

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">Roles</h2>
          <Button onClick={() => setCreating(true)}>
            <Plus /> New role
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => {
            const locked = role.systemKey === "super_admin"
            return (
              <Card key={role.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {role.name}
                    {role.isSystem && <Badge variant="secondary">System</Badge>}
                  </CardTitle>
                  <CardDescription>{role.description ?? "Custom role"}</CardDescription>
                  <CardAction className="flex gap-1">
                    {locked ? (
                      <span className="p-1.5 text-muted-foreground" title="Super Admin always has every permission">
                        <Lock className="size-4" />
                      </span>
                    ) : (
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(role)} aria-label={`Edit ${role.name}`}>
                        <Pencil />
                      </Button>
                    )}
                    {!role.isSystem && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleting(role)}
                        aria-label={`Delete ${role.name}`}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </CardAction>
                </CardHeader>
                <CardContent className="flex gap-4 text-sm text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground tabular-nums">{role.permissions.length}</span> permissions
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    <span className="font-medium text-foreground tabular-nums">{role.userCount}</span> users
                  </span>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">Permission matrix</h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-64">Permission</TableHead>
                {roles.map((r) => (
                  <TableHead key={r.id} className="text-center whitespace-nowrap">
                    {r.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category) => (
                <Fragment key={category}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={roles.length + 1} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {category}
                    </TableCell>
                  </TableRow>
                  {permissions
                    .filter((p) => p.category === category)
                    .map((p) => (
                      <TableRow key={p.key}>
                        <TableCell>
                          <div className="font-mono text-xs">{p.key}</div>
                          <div className="text-xs text-muted-foreground">{p.description}</div>
                        </TableCell>
                        {roles.map((r) => (
                          <TableCell key={r.id} className="text-center">
                            {r.permissions.includes(p.key) ? (
                              <Check className="mx-auto size-4 text-primary" aria-label="Granted" />
                            ) : (
                              <span className="text-muted-foreground/40" aria-label="Not granted">
                                ·
                              </span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Assign roles to people on the <Link href="/admin/users" className="underline">Users</Link> screen. Being the
          assigned uploader or reviewer of a document gives access to that document without any role.
        </p>
      </section>

      <RoleDialog open={creating} onOpenChange={setCreating} permissions={permissions} myPermissions={myPermissions} />
      <RoleDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        role={editing ?? undefined}
        permissions={permissions}
        myPermissions={myPermissions}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete the ${deleting?.name} role?`}
        description={
          deleting?.userCount
            ? `${deleting.userCount} user(s) hold this role and will lose its permissions.`
            : "No users hold this role."
        }
        confirmLabel="Delete role"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          const result = await deleteRole(deleting.id)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success(`${deleting.name} deleted`)
        }}
      />
    </div>
  )
}
