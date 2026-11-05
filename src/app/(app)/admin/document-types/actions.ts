"use server"

import { revalidatePath } from "next/cache"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { documentTypeSchema, type DocumentTypeInput } from "@/lib/validation/repository"

const NO_PERMISSION = "You do not have permission to manage document types."

async function authorised() {
  return hasPerm(await requireAppContext(), "document_type.manage")
}

export async function createDocumentType(input: DocumentTypeInput): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const parsed = documentTypeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data: last } = await supabase
    .from("document_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()
  const { error } = await supabase
    .from("document_types")
    .insert({ ...parsed.data, sort_order: ((last?.sort_order as number | undefined) ?? 0) + 10 })
  if (error) return fromDbError(error)

  revalidatePath("/admin/document-types")
  return ok()
}

export async function updateDocumentType(id: string, input: DocumentTypeInput): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const parsed = documentTypeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase.from("document_types").update(parsed.data).eq("id", id)
  if (error) return fromDbError(error)

  revalidatePath("/admin/document-types")
  return ok()
}

export async function setDocumentTypeActive(id: string, active: boolean): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error } = await supabase.from("document_types").update({ is_active: active }).eq("id", id)
  if (error) return fromDbError(error)

  revalidatePath("/admin/document-types")
  return ok()
}
