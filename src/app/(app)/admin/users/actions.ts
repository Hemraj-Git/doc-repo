"use server"

import { revalidatePath } from "next/cache"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { generateTempPassword } from "@/lib/auth/password"
import { hasPerm } from "@/lib/auth/permissions"
import { requireAppContext, type AppContext } from "@/lib/auth/session"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { userSchema, type UserInput } from "@/lib/validation/org"

type Credentials = { email: string; password: string; warning?: string }

const NO_PERMISSION = "You do not have permission to manage users."
// Effectively permanent; Supabase Auth bans are durations.
const BAN_FOREVER = "876000h"

function refresh() {
  revalidatePath("/admin/users")
  revalidatePath("/admin/departments")
  revalidatePath("/admin/org-chart")
  revalidatePath("/dashboard")
}

async function authorise(): Promise<AppContext | null> {
  const ctx = await requireAppContext()
  return hasPerm(ctx, "user.manage") ? ctx : null
}

/** Only Super Admins may change another Super Admin's account. */
async function guardSuperAdminTarget(ctx: AppContext, userId: string) {
  if (ctx.roles.some((r) => r.systemKey === "super_admin")) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from("user_roles")
    .select("role:roles!inner(system_key)")
    .eq("user_id", userId)
    .eq("role.system_key", "super_admin")
    .limit(1)
  return data && data.length > 0 ? fail("Only a Super Admin can change another Super Admin's account.") : null
}

/**
 * Staff report to someone in their own department. A department head may only
 * report upwards to someone in another department (e.g. the Director).
 */
async function checkManager(departmentId: string, reportsToId: string | null, isHead: boolean) {
  if (!reportsToId) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from("profiles")
    .select("department_id, is_active")
    .eq("id", reportsToId)
    .maybeSingle()
  if (!data || !data.is_active) return fail("The selected manager is not an active user.", { reportsToId: "Select an active user" })
  if (isHead && data.department_id === departmentId)
    return fail("A department head reports to someone outside their department.", {
      reportsToId: "Select someone from another department, e.g. the Director",
    })
  if (!isHead && data.department_id !== departmentId)
    return fail("The manager must be in the same department.", { reportsToId: "Select someone from this department" })
  return null
}

export async function createUser(input: UserInput): Promise<ActionResult<Credentials>> {
  const ctx = await authorise()
  if (!ctx) return fail(NO_PERMISSION)
  const parsed = userSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  if (v.makeHead && !hasPerm(ctx, "department.manage"))
    return fail("Assigning a department head requires the department.manage permission.")

  const managerError = await checkManager(v.departmentId, v.reportsToId, v.makeHead)
  if (managerError) return managerError

  // 1. Auth account (service role). Pre-confirmed: admins create accounts, users never sign up.
  const password = generateTempPassword()
  const admin = createAdminClient()
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: v.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: v.fullName },
  })
  if (authError || !created.user) {
    const taken = authError?.code === "email_exists" || /already.*registered/i.test(authError?.message ?? "")
    return taken
      ? fail("A user with this email already exists.", { email: "A user with this email already exists" })
      : fail(authError?.message ?? "Could not create the account.")
  }
  const userId = created.user.id

  // 2. Profile, written as the admin so RLS applies and the audit log names them.
  const supabase = await createClient()
  const { error: profileError } = await supabase.from("profiles").insert({
    id: userId,
    full_name: v.fullName,
    email: v.email,
    employee_code: v.employeeCode,
    designation: v.designation,
    phone: v.phone,
    department_id: v.departmentId,
    // A head's cross-department manager is linked once they are head (step 3).
    reports_to_id: v.makeHead ? null : v.reportsToId,
    must_change_password: true,
  })
  if (profileError) {
    await admin.auth.admin.deleteUser(userId)
    return fromDbError(profileError)
  }

  await supabase.rpc("log_user_admin_event", { p_action: "account_created", p_user_id: userId })

  // 3. Department head (optional), then their manager outside the department.
  let warning: string | undefined
  if (v.makeHead) {
    const { error } = await supabase.from("departments").update({ head_user_id: userId }).eq("id", v.departmentId)
    if (error) warning = `The user was created but could not be made department head: ${error.message}`
    else if (v.reportsToId) {
      const { error: linkError } = await supabase
        .from("profiles")
        .update({ reports_to_id: v.reportsToId })
        .eq("id", userId)
      if (linkError) warning = `The user was created as head, but their reporting manager could not be set: ${linkError.message}`
    }
  }

  refresh()
  return ok({ email: v.email, password, warning })
}

export async function updateUser(userId: string, input: UserInput): Promise<ActionResult> {
  const ctx = await authorise()
  if (!ctx) return fail(NO_PERMISSION)
  const parsed = userSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  const guard = await guardSuperAdminTarget(ctx, userId)
  if (guard) return guard

  const supabase = await createClient()
  const { data: current, error: loadError } = await supabase
    .from("profiles")
    .select("email, department_id, department:departments!profiles_department_id_fkey(head_user_id)")
    .eq("id", userId)
    .maybeSingle()
  if (loadError) return fromDbError(loadError)
  if (!current) return fail("User not found.")

  const currentDept = current.department as unknown as { head_user_id: string | null }
  const isHeadNow = currentDept.head_user_id === userId
  const deptChanged = current.department_id !== v.departmentId
  const headChange = v.makeHead !== isHeadNow || (isHeadNow && deptChanged)
  if (headChange && !hasPerm(ctx, "department.manage"))
    return fail("Changing a department head requires the department.manage permission.")

  const managerError = await checkManager(v.departmentId, v.reportsToId, v.makeHead)
  if (managerError) return managerError
  // Someone becoming head may only take a cross-department manager once they are head.
  const becomingHead = v.makeHead && (!isHeadNow || deptChanged)

  // Step down as head of the old department first (moving away or no longer head).
  if (isHeadNow && (deptChanged || !v.makeHead)) {
    const { error } = await supabase.from("departments").update({ head_user_id: null }).eq("id", current.department_id)
    if (error) return fromDbError(error)
  }

  // Email lives in Supabase Auth too; change it there first because it can be rejected.
  const admin = createAdminClient()
  const emailChanged = current.email !== v.email
  if (emailChanged) {
    const { error } = await admin.auth.admin.updateUserById(userId, { email: v.email, email_confirm: true })
    if (error) {
      const taken = error.code === "email_exists" || /already.*registered/i.test(error.message)
      return taken ? fail("A user with this email already exists.", { email: "A user with this email already exists" }) : fail(error.message)
    }
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      full_name: v.fullName,
      email: v.email,
      employee_code: v.employeeCode,
      designation: v.designation,
      phone: v.phone,
      department_id: v.departmentId,
      reports_to_id: becomingHead ? null : v.reportsToId,
    })
    .eq("id", userId)
  if (updateError) {
    if (emailChanged) await admin.auth.admin.updateUserById(userId, { email: current.email, email_confirm: true })
    return fromDbError(updateError)
  }

  if (becomingHead) {
    const { error } = await supabase.from("departments").update({ head_user_id: userId }).eq("id", v.departmentId)
    if (error) return fromDbError(error)
    if (v.reportsToId) {
      const { error: linkError } = await supabase.from("profiles").update({ reports_to_id: v.reportsToId }).eq("id", userId)
      if (linkError) return fromDbError(linkError)
    }
  }

  refresh()
  return ok()
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  const ctx = await authorise()
  if (!ctx) return fail(NO_PERMISSION)
  if (userId === ctx.user.id) return fail("You cannot deactivate your own account.")
  const guard = await guardSuperAdminTarget(ctx, userId)
  if (guard) return guard

  const supabase = await createClient()
  const { error } = await supabase.from("profiles").update({ is_active: active }).eq("id", userId)
  if (error) return fromDbError(error)

  // Block (or restore) sign-in at the Auth level as well, so sessions cannot be refreshed.
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : BAN_FOREVER,
  })
  if (banError) {
    await supabase.from("profiles").update({ is_active: !active }).eq("id", userId)
    return fail(`Could not update sign-in access: ${banError.message}`)
  }

  await supabase.rpc("log_user_admin_event", {
    p_action: active ? "account_enabled" : "account_disabled",
    p_user_id: userId,
  })
  refresh()
  return ok()
}

export type OpenWork = { uploads: number; reviews: number; series: number; kpis: number; kpi_reviews: number; kpi_scores: number; reports: number }

/** What is still waiting on a person, shown before they are deactivated. */
export async function getOpenWork(userId: string): Promise<ActionResult<OpenWork>> {
  const ctx = await authorise()
  if (!ctx) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("user_open_work", { p_user: userId })
  if (error) return fromDbError(error)
  return ok(data as OpenWork)
}

/**
 * Moves the person's open uploads, reviews and recurring series to a successor
 * (and optionally their direct reports), then deactivates them.
 */
export async function handOverAndDeactivate(userId: string, successorId: string, moveReports: boolean): Promise<ActionResult> {
  const ctx = await authorise()
  if (!ctx) return fail(NO_PERMISSION)
  if (userId === ctx.user.id) return fail("You cannot deactivate your own account.")
  const guard = await guardSuperAdminTarget(ctx, userId)
  if (guard) return guard

  const supabase = await createClient()
  const { error } = await supabase.rpc("hand_over_work", { p_from: userId, p_to: successorId, p_move_reports: moveReports })
  if (error) return fromDbError(error)
  const result = await setUserActive(userId, false)
  if (!result.ok) return fail(`The work was handed over, but the account could not be deactivated: ${result.error}`)
  return ok()
}

export async function resetPassword(userId: string): Promise<ActionResult<Credentials>> {
  const ctx = await authorise()
  if (!ctx) return fail(NO_PERMISSION)
  if (userId === ctx.user.id) return fail("Use “Change password” in your user menu to change your own password.")
  const guard = await guardSuperAdminTarget(ctx, userId)
  if (guard) return guard

  const supabase = await createClient()
  const { data: profile } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle()
  if (!profile) return fail("User not found.")

  const password = generateTempPassword()
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password })
  if (error) return fail(error.message)

  await supabase.from("profiles").update({ must_change_password: true }).eq("id", userId)
  await supabase.rpc("log_user_admin_event", { p_action: "password_reset", p_user_id: userId })

  refresh()
  return ok({ email: profile.email as string, password })
}

export async function setUserRoles(userId: string, roleIds: string[]): Promise<ActionResult> {
  const ctx = await authorise()
  if (!ctx) return fail(NO_PERMISSION)

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_user_roles", { p_user_id: userId, p_role_ids: roleIds })
  if (error) return fromDbError(error)

  refresh()
  return ok()
}
