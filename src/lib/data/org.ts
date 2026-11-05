import "server-only"
import { createClient } from "@/lib/supabase/server"

export type DepartmentRow = {
  id: string
  name: string
  code: string
  description: string | null
  isActive: boolean
  head: { id: string; fullName: string } | null
  memberCount: number
}

export type UserRow = {
  id: string
  fullName: string
  email: string
  employeeCode: string | null
  designation: string | null
  phone: string | null
  isActive: boolean
  mustChangePassword: boolean
  department: { id: string; name: string; code: string }
  manager: { id: string; fullName: string; departmentId: string } | null
  roles: { id: string; name: string; systemKey: string | null }[]
  isHead: boolean
}

export type RoleRow = {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  systemKey: string | null
  permissions: string[]
  userCount: number
}

export type PermissionRow = { key: string; description: string; category: string }

/** Lightweight user entry for pickers (reports-to, head). */
export type PersonOption = {
  id: string
  fullName: string
  designation: string | null
  departmentId: string
  reportsToId: string | null
}

// Without generated DB types supabase-js mistypes embedded relations, so results
// are returned as unknown and cast to the row shape each query selects.
function must(res: { data: unknown; error: { message: string } | null }, what: string): unknown {
  if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`)
  return res.data ?? []
}

export async function listDepartments(): Promise<DepartmentRow[]> {
  const supabase = await createClient()
  const rows = must(
    await supabase
      .from("departments")
      .select(
        "id, name, code, description, is_active, head:profiles!departments_head_user_id_fkey(id, full_name), members:profiles!profiles_department_id_fkey(count)"
      )
      .order("name"),
    "departments"
  ) as {
    id: string
    name: string
    code: string
    description: string | null
    is_active: boolean
    head: { id: string; full_name: string } | null
    members: { count: number }[]
  }[]

  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    description: d.description,
    isActive: d.is_active,
    head: d.head ? { id: d.head.id, fullName: d.head.full_name } : null,
    memberCount: d.members[0]?.count ?? 0,
  }))
}

export type UserFilters = { q?: string; departmentId?: string; status?: "active" | "inactive" | "all" }

export async function listUsers(filters: UserFilters = {}): Promise<UserRow[]> {
  const supabase = await createClient()
  let query = supabase
    .from("profiles")
    .select(
      "id, full_name, email, employee_code, designation, phone, is_active, must_change_password, department:departments!profiles_department_id_fkey(id, name, code, head_user_id), manager:reports_to_id(id, full_name, department_id), user_roles(role:roles(id, name, system_key))"
    )
    .order("full_name")

  const status = filters.status ?? "active"
  if (status !== "all") query = query.eq("is_active", status === "active")
  if (filters.departmentId) query = query.eq("department_id", filters.departmentId)
  if (filters.q) {
    // Strip characters that have meaning in PostgREST filter syntax.
    const q = filters.q.replace(/[,()*%\\]/g, " ").trim()
    if (q) query = query.or(`full_name.ilike.*${q}*,email.ilike.*${q}*,employee_code.ilike.*${q}*,designation.ilike.*${q}*`)
  }

  const rows = must(await query, "users") as {
    id: string
    full_name: string
    email: string
    employee_code: string | null
    designation: string | null
    phone: string | null
    is_active: boolean
    must_change_password: boolean
    department: { id: string; name: string; code: string; head_user_id: string | null }
    manager: { id: string; full_name: string; department_id: string } | null
    user_roles: { role: { id: string; name: string; system_key: string | null } }[]
  }[]

  return rows.map((p) => ({
    id: p.id,
    fullName: p.full_name,
    email: p.email,
    employeeCode: p.employee_code,
    designation: p.designation,
    phone: p.phone,
    isActive: p.is_active,
    mustChangePassword: p.must_change_password,
    department: { id: p.department.id, name: p.department.name, code: p.department.code },
    manager: p.manager
      ? { id: p.manager.id, fullName: p.manager.full_name, departmentId: p.manager.department_id }
      : null,
    roles: p.user_roles
      .map((ur) => ({ id: ur.role.id, name: ur.role.name, systemKey: ur.role.system_key }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    isHead: p.department.head_user_id === p.id,
  }))
}

/** Active users, for reporting-manager and head pickers. */
export async function listPeople(): Promise<PersonOption[]> {
  const supabase = await createClient()
  const rows = must(
    await supabase
      .from("profiles")
      .select("id, full_name, designation, department_id, reports_to_id")
      .eq("is_active", true)
      .order("full_name"),
    "people"
  ) as { id: string; full_name: string; designation: string | null; department_id: string; reports_to_id: string | null }[]
  return rows.map((p) => ({
    id: p.id,
    fullName: p.full_name,
    designation: p.designation,
    departmentId: p.department_id,
    reportsToId: p.reports_to_id,
  }))
}

/** Active users as picker items: "Name" with "Designation · DEPT" underneath. */
export async function listPeoplePicker(): Promise<{ value: string; label: string; hint: string }[]> {
  const [people, departments] = await Promise.all([listPeople(), listDepartments()])
  const code = new Map(departments.map((d) => [d.id, d.code]))
  return people.map((p) => ({
    value: p.id,
    label: p.fullName,
    hint: [p.designation, code.get(p.departmentId)].filter(Boolean).join(" · "),
  }))
}

export async function listRoles(): Promise<RoleRow[]> {
  const supabase = await createClient()
  const rows = must(
    await supabase
      .from("roles")
      .select("id, name, description, is_system, system_key, role_permissions(permission_key), user_roles(count)")
      .order("is_system", { ascending: false })
      .order("name"),
    "roles"
  ) as {
    id: string
    name: string
    description: string | null
    is_system: boolean
    system_key: string | null
    role_permissions: { permission_key: string }[]
    user_roles: { count: number }[]
  }[]

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    systemKey: r.system_key,
    permissions: r.role_permissions.map((p) => p.permission_key),
    userCount: r.user_roles[0]?.count ?? 0,
  }))
}

export async function listPermissions(): Promise<PermissionRow[]> {
  const supabase = await createClient()
  return must(
    await supabase.from("permissions").select("key, description, category").order("sort_order"),
    "permissions"
  ) as PermissionRow[]
}

export type OrgNode = {
  id: string
  fullName: string
  designation: string | null
  email: string
  isActive: boolean
  isHead: boolean
  department: { id: string; code: string }
  reports: OrgNode[]
}

/**
 * Reporting tree. For a department: its people whose manager is outside it (the
 * head, or anyone unassigned) with everyone below them — including other
 * departments' heads who report to them (e.g. under a Director). For "all":
 * the whole institute from the top.
 */
export async function getOrgChart(scope: { departmentId: string } | "all"): Promise<{ roots: OrgNode[]; total: number }> {
  const supabase = await createClient()
  const [{ data: depts, error: deptError }, { data: people, error }] = await Promise.all([
    supabase.from("departments").select("id, code, head_user_id"),
    supabase.from("profiles").select("id, full_name, designation, email, is_active, department_id, reports_to_id").order("full_name"),
  ])
  if (deptError || error) throw new Error(`Could not load the org chart: ${(deptError ?? error)!.message}`)

  const deptRows = (depts ?? []) as { id: string; code: string; head_user_id: string | null }[]
  const rows = (people ?? []) as {
    id: string
    full_name: string
    designation: string | null
    email: string
    is_active: boolean
    department_id: string
    reports_to_id: string | null
  }[]
  const deptById = new Map(deptRows.map((d) => [d.id, d]))

  const nodes = new Map<string, OrgNode>(
    rows.map((p) => [
      p.id,
      {
        id: p.id,
        fullName: p.full_name,
        designation: p.designation,
        email: p.email,
        isActive: p.is_active,
        isHead: deptById.get(p.department_id)?.head_user_id === p.id,
        department: { id: p.department_id, code: deptById.get(p.department_id)?.code ?? "" },
        reports: [],
      },
    ])
  )
  for (const p of rows) {
    if (p.reports_to_id) nodes.get(p.reports_to_id)?.reports.push(nodes.get(p.id)!)
  }

  const isRoot =
    scope === "all"
      ? (p: (typeof rows)[number]) => !p.reports_to_id || !nodes.has(p.reports_to_id)
      : (p: (typeof rows)[number]) => {
          if (p.department_id !== scope.departmentId) return false
          const manager = p.reports_to_id ? rows.find((m) => m.id === p.reports_to_id) : undefined
          return !manager || manager.department_id !== scope.departmentId
        }

  const roots = rows.filter(isRoot).map((p) => nodes.get(p.id)!)
  roots.sort((a, b) => Number(b.isHead) - Number(a.isHead) || a.fullName.localeCompare(b.fullName))

  const count = (n: OrgNode): number => 1 + n.reports.reduce((s, r) => s + count(r), 0)
  return { roots, total: roots.reduce((s, r) => s + count(r), 0) }
}

