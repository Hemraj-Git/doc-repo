import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

export type InstituteSettings = {
  instituteName: string
  address: string | null
  contactEmail: string | null
  academicYearStartMonth: number
  logoPath: string | null
  updatedAt: string
}

/** The single institute settings row. Cached per request. */
export const getInstituteSettings = cache(async (): Promise<InstituteSettings> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("institute_settings")
    .select("institute_name, address, contact_email, academic_year_start_month, logo_path, updated_at")
    .maybeSingle()
  if (error) throw new Error(`Could not load institute settings: ${error.message}`)
  const s = (data ?? {}) as {
    institute_name?: string
    address?: string | null
    contact_email?: string | null
    academic_year_start_month?: number
    logo_path?: string | null
    updated_at?: string
  }
  return {
    instituteName: s.institute_name ?? "Marine Institute",
    address: s.address ?? null,
    contactEmail: s.contact_email ?? null,
    academicYearStartMonth: s.academic_year_start_month ?? 7,
    logoPath: s.logo_path ?? null,
    updatedAt: s.updated_at ?? new Date(0).toISOString(),
  }
})
