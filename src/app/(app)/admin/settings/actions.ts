"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { instituteSettingsSchema, type InstituteSettingsInput } from "@/lib/validation/settings"

export async function updateInstituteSettings(input: InstituteSettingsInput): Promise<ActionResult> {
  const ctx = await requireAppContext()
  if (!hasPerm(ctx, "settings.manage")) return fail("You do not have permission to change institute settings.")
  const parsed = instituteSettingsSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const v = parsed.data
  const supabase = await createClient()
  const { error, count } = await supabase
    .from("institute_settings")
    .update(
      {
        institute_name: v.instituteName,
        address: v.address,
        contact_email: v.contactEmail,
        academic_year_start_month: v.academicYearStartMonth,
      },
      { count: "exact" }
    )
    .eq("id", true)
  if (error) return fromDbError(error)
  if (!count) return fail("Settings could not be saved.")

  revalidatePath("/", "layout")
  return ok()
}

const MAX_LOGO_BYTES = 800 * 1024

/** Uploads (file) or removes (no file) the logo printed on the portal and verification slips. */
export async function setInstituteLogo(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAppContext()
  if (!hasPerm(ctx, "settings.manage")) return fail("You do not have permission to change institute settings.")
  const file = formData.get("logo")
  const supabase = await createClient()
  const storage = createAdminClient().storage.from("branding")
  const { data: current } = await supabase.from("institute_settings").select("logo_path").eq("id", true).maybeSingle()

  let path: string | null = null
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_LOGO_BYTES) return fail("The logo can be at most 800 KB.")
    const bytes = new Uint8Array(await file.arrayBuffer())
    const ext = bytes[0] === 0x89 && bytes[1] === 0x50 ? "png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "jpg" : null
    if (!ext) return fail("Use a PNG or JPEG image.")
    path = `logo-${randomUUID()}.${ext}`
    const { error } = await storage.upload(path, bytes, { contentType: ext === "png" ? "image/png" : "image/jpeg", cacheControl: "31536000" })
    if (error) return fail(`Could not upload the logo: ${error.message}`)
  }

  const { error, count } = await supabase.from("institute_settings").update({ logo_path: path }, { count: "exact" }).eq("id", true)
  if (error || !count) {
    if (path) await storage.remove([path])
    return error ? fromDbError(error) : fail("Settings could not be saved.")
  }
  if (current?.logo_path) await storage.remove([current.logo_path as string])
  revalidatePath("/", "layout")
  return ok()
}
