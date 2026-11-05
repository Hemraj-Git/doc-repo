"use server"

import { revalidatePath } from "next/cache"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { departmentSchema, type DepartmentInput } from "@/lib/validation/org"

async function authorise() {
  const ctx = await requireAppContext()
  return hasPerm(ctx, "department.manage") ? ctx : null
}

function refresh() {
  revalidatePath("/admin/departments")
  revalidatePath("/admin/users")
  revalidatePath("/admin/org-chart")
  revalidatePath("/dashboard")
}

export async function createDepartment(input: DepartmentInput): Promise<ActionResult> {
  if (!(await authorise())) return fail("You do not have permission to manage departments.")
  const parsed = departmentSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  // A brand-new department has no members yet, so a head is assigned afterwards.
  const { name, code, description } = parsed.data
  const supabase = await createClient()
  const { error } = await supabase.from("departments").insert({ name, code, description })
  if (error) return fromDbError(error)

  refresh()
  return ok()
}

export async function updateDepartment(id: string, input: DepartmentInput): Promise<ActionResult> {
  if (!(await authorise())) return fail("You do not have permission to manage departments.")
  const parsed = departmentSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const { name, code, description, headUserId } = parsed.data
  const supabase = await createClient()
  const { error, count } = await supabase
    .from("departments")
    .update({ name, code, description, head_user_id: headUserId }, { count: "exact" })
    .eq("id", id)
  if (error) return fromDbError(error)
  if (!count) return fail("Department not found.")

  refresh()
  return ok()
}

export async function setDepartmentActive(id: string, active: boolean): Promise<ActionResult> {
  if (!(await authorise())) return fail("You do not have permission to manage departments.")
  const supabase = await createClient()
  const { error } = await supabase.from("departments").update({ is_active: active }).eq("id", id)
  if (error) return fromDbError(error)

  refresh()
  return ok()
}
