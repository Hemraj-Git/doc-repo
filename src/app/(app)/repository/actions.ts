"use server"

import { revalidatePath } from "next/cache"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { canManageFolderAccess, canManageFolders } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { getFolderGrants, listGroupOptions, type FolderGrant, type InheritedGrant } from "@/lib/data/folder-access"
import { listDepartments, listPeoplePicker } from "@/lib/data/org"
import { createClient } from "@/lib/supabase/server"
import { folderGrantSchema, type FolderGrantInput } from "@/lib/validation/folder-access"
import { folderSchema, refIdRule, referenceIdSchema, type FolderInput } from "@/lib/validation/repository"

const NO_PERMISSION = "You do not have permission to manage folders in this department."

type FolderInfo = {
  id: string
  department_id: string
  level: "root" | "child" | "sub"
  depth: number
  name: string
  reference_id: string | null
  allow_subfolders: boolean
}

async function loadFolder(id: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("folders")
    .select("id, department_id, level, depth, name, reference_id, allow_subfolders")
    .eq("id", id)
    .maybeSingle()
  return data as FolderInfo | null
}

function refreshRepository() {
  revalidatePath("/repository", "layout")
}

/** Live availability check for Ref ID fields. */
export async function checkReferenceId(referenceId: string): Promise<{ available: boolean; error?: string }> {
  await requireAppContext()
  const parsed = referenceIdSchema.safeParse(referenceId)
  if (!parsed.success) return { available: false, error: parsed.error.issues[0]?.message }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("reference_id_available", { p_ref: parsed.data })
  if (error) return { available: false, error: "Could not check this Reference ID" }
  return { available: Boolean(data) }
}

/** The Ref ID to store for a folder at `depth`, or a field error. */
function folderRef(depth: number, raw: string): ActionResult<string | null> {
  const rule = refIdRule(depth)
  if (rule === "auto") return ok(null) // derived by the database
  const value = raw.trim()
  if (!value && rule === "optional") return ok(null)
  const ref = referenceIdSchema.safeParse(value)
  return ref.success ? ok(ref.data) : fail("Please correct the highlighted fields.", { referenceId: ref.error.issues[0]!.message })
}

/** Creates a folder inside `parentId`: a child folder in a department, or a sub-folder further down. */
export async function createFolder(parentId: string, input: FolderInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireAppContext()
  const parsed = folderSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const parent = await loadFolder(parentId)
  if (!parent) return fail("Parent folder not found.")
  if (!canManageFolders(ctx, parent.department_id)) return fail(NO_PERMISSION)
  if (parent.level !== "root" && !parent.allow_subfolders) return fail(`“${parent.name}” does not allow sub-folders.`)
  if (parent.depth >= 8) return fail("Folders can be nested at most 8 levels deep.")

  const depth = parent.depth + 1
  const ref = folderRef(depth, parsed.data.referenceId)
  if (!ref.ok) return ref

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("folders")
    .insert({
      parent_id: parentId,
      department_id: parent.department_id,
      level: parent.level === "root" ? "child" : "sub",
      name: parsed.data.name,
      reference_id: ref.data,
      description: parsed.data.description,
      allow_subfolders: parsed.data.allowSubfolders && depth < 8,
    })
    .select("id")
    .single()
  if (error) return fromDbError(error)

  refreshRepository()
  return ok({ id: data.id as string })
}

export async function updateFolder(folderId: string, input: FolderInput): Promise<ActionResult> {
  const ctx = await requireAppContext()
  const parsed = folderSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const folder = await loadFolder(folderId)
  if (!folder || folder.level === "root") return fail("Folder not found.")
  if (!canManageFolders(ctx, folder.department_id)) return fail(NO_PERMISSION)

  const changes: Record<string, unknown> = {
    name: parsed.data.name,
    description: parsed.data.description,
    allow_subfolders: parsed.data.allowSubfolders && folder.depth < 8,
  }
  if (refIdRule(folder.depth) !== "auto") {
    const ref = folderRef(folder.depth, parsed.data.referenceId)
    if (!ref.ok) return ref
    changes.reference_id = ref.data
  }

  const supabase = await createClient()
  const { error } = await supabase.from("folders").update(changes).eq("id", folderId)
  if (error) return fromDbError(error)

  refreshRepository()
  return ok()
}

export async function deleteFolder(folderId: string): Promise<ActionResult> {
  const ctx = await requireAppContext()
  const folder = await loadFolder(folderId)
  if (!folder || folder.level === "root") return fail("Folder not found.")
  if (!canManageFolders(ctx, folder.department_id)) return fail(NO_PERMISSION)

  const supabase = await createClient()
  const { error } = await supabase.from("folders").delete().eq("id", folderId)
  if (error) return fromDbError(error)

  refreshRepository()
  return ok()
}

// -----------------------------------------------------------------------------
// Folder access: who can view or upload
// -----------------------------------------------------------------------------

const NO_ACCESS_PERMISSION = "You do not have permission to manage access to this folder."

export type FolderAccessOptions = { value: string; label: string; hint?: string | null }[]

export type FolderAccessView = {
  grants: FolderGrant[]
  inherited: InheritedGrant[]
  people: FolderAccessOptions
  departments: FolderAccessOptions
  groups: FolderAccessOptions
}

/** Loaded when the dialog opens, so folder pages don't pay for the pickers. */
export async function loadFolderAccess(folderId: string): Promise<ActionResult<FolderAccessView>> {
  const ctx = await requireAppContext()
  const folder = await loadFolder(folderId)
  if (!folder) return fail("Folder not found.")
  if (!canManageFolderAccess(ctx, folder.department_id)) return fail(NO_ACCESS_PERMISSION)

  const [{ grants, inherited }, people, departments, groups] = await Promise.all([
    getFolderGrants(folderId),
    listPeoplePicker(),
    listDepartments(),
    listGroupOptions(),
  ])
  return ok({
    grants,
    inherited,
    people,
    departments: departments.filter((d) => d.isActive).map((d) => ({ value: d.id, label: d.name, hint: d.code })),
    groups,
  })
}

/** Adds access, or changes the level of an existing grant for the same person, department or group. */
export async function setFolderAccess(folderId: string, input: FolderGrantInput): Promise<ActionResult> {
  await requireAppContext()
  const parsed = folderGrantSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { kind, granteeId, access } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_folder_permission", {
    p_folder_id: folderId,
    p_user_id: kind === "user" ? granteeId : null,
    p_department_id: kind === "department" ? granteeId : null,
    p_group_id: kind === "group" ? granteeId : null,
    p_access: access,
  })
  if (error) return fromDbError(error)

  revalidatePath("/", "layout")
  return ok()
}

export async function removeFolderAccess(permissionId: string): Promise<ActionResult> {
  await requireAppContext()
  const supabase = await createClient()
  // RLS decides: a delete that matches nothing means no permission.
  const { data, error } = await supabase.from("folder_permissions").delete().eq("id", permissionId).select("id")
  if (error) return fromDbError(error)
  if (!data?.length) return fail(NO_ACCESS_PERMISSION)

  revalidatePath("/", "layout")
  return ok()
}
