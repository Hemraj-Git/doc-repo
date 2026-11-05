import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { AccessContext } from "@/lib/auth/permissions"

export type AppContext = AccessContext & {
  user: {
    id: string
    fullName: string
    email: string
    employeeCode: string | null
    designation: string | null
    isActive: boolean
    mustChangePassword: boolean
  }
  department: { id: string; name: string; code: string }
  roles: { id: string; name: string; systemKey: string | null }[]
}

type MyContextRow = {
  profile: {
    id: string
    full_name: string
    email: string
    employee_code: string | null
    designation: string | null
    is_active: boolean
    must_change_password: boolean
  }
  department: { id: string; name: string; code: string }
  is_hod: boolean
  has_subordinates: boolean
  roles: { id: string; name: string; system_key: string | null }[]
  permissions: string[]
}

/**
 * The signed-in user's profile, department, roles and permissions.
 * Returns null when there is no session or the auth user has no profile.
 * Cached per request.
 */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) return null

  const { data, error } = await supabase.rpc("my_context")
  if (error) throw new Error(`Could not load your account: ${error.message}`)
  if (!data) return null

  const row = data as MyContextRow
  return {
    user: {
      id: row.profile.id,
      fullName: row.profile.full_name,
      email: row.profile.email,
      employeeCode: row.profile.employee_code,
      designation: row.profile.designation,
      isActive: row.profile.is_active,
      mustChangePassword: row.profile.must_change_password,
    },
    department: row.department,
    isHod: row.is_hod,
    hasSubordinates: row.has_subordinates,
    roles: row.roles.map((r) => ({ id: r.id, name: r.name, systemKey: r.system_key })),
    permissions: row.permissions,
  }
})

/** For pages behind login. Sends inactive or unprovisioned accounts back to the login page. */
export async function requireAppContext(): Promise<AppContext> {
  const ctx = await getAppContext()
  if (!ctx) redirect("/auth/signout?reason=no-profile")
  if (!ctx.user.isActive) redirect("/auth/signout?reason=inactive")
  return ctx
}
