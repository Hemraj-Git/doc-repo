"use server"

import { revalidatePath } from "next/cache"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { roleSchema, type RoleInput } from "@/lib/validation/org"

const NO_PERMISSION = "You do not have permission to manage roles."

async function authorise() {
  const ctx = await requireAppContext()
  return hasPerm(ctx, "role.manage") ? ctx : null
}

function refresh() {
  revalidatePath("/admin/roles")
  revalidatePath("/admin/users")
}

export async function createRole(input: RoleInput): Promise<ActionResult> {
  if (!(await authorise())) return fail(NO_PERMISSION)
  const parsed = roleSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data: role, error } = await supabase
    .from("roles")
    .insert({ name: parsed.data.name, description: parsed.data.description })
    .select("id")
    .single()
  if (error) return fromDbError(error)

  const { error: permError } = await supabase.rpc("set_role_permissions", {
    p_role_id: role.id,
    p_permission_keys: parsed.data.permissions,
  })
  if (permError) {
    await supabase.from("roles").delete().eq("id", role.id)
    return fromDbError(permError)
  }

  refresh()
  return ok()
}

export async function updateRole(roleId: string, input: RoleInput): Promise<ActionResult> {
  if (!(await authorise())) return fail(NO_PERMISSION)
  const parsed = roleSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data: role } = await supabase.from("roles").select("is_system, system_key").eq("id", roleId).maybeSingle()
  if (!role) return fail("Role not found.")
  if (role.system_key === "super_admin") return fail("The Super Admin role always has every permission.")

  // System roles keep their names; only their permissions can change.
  if (!role.is_system) {
    const { error } = await supabase
      .from("roles")
      .update({ name: parsed.data.name, description: parsed.data.description })
      .eq("id", roleId)
    if (error) return fromDbError(error)
  }

  const { error } = await supabase.rpc("set_role_permissions", {
    p_role_id: roleId,
    p_permission_keys: parsed.data.permissions,
  })
  if (error) return fromDbError(error)

  refresh()
  return ok()
}

export async function deleteRole(roleId: string): Promise<ActionResult> {
  if (!(await authorise())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error, count } = await supabase.from("roles").delete({ count: "exact" }).eq("id", roleId).eq("is_system", false)
  if (error) return fromDbError(error)
  if (!count) return fail("System roles cannot be deleted.")

  refresh()
  return ok()
}
