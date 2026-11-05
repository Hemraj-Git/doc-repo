import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

export type FolderLevel = "root" | "child" | "sub"

export type FolderRow = {
  id: string
  departmentId: string
  parentId: string | null
  level: FolderLevel
  depth: number
  name: string
  referenceId: string | null
  description: string | null
  allowSubfolders: boolean
  subfolderCount: number
  createdAt: string
  createdBy: { id: string; fullName: string } | null
  templateInstanceId: string | null
  templateNodeId: string | null
  /** KPI folders: never shared, and hidden from the repository. */
  isPrivate: boolean
}

export type RepositoryDepartment = {
  id: string
  name: string
  code: string
  isActive: boolean
  rootFolderId: string
  childCount: number
}

export type DocumentTypeRow = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  sortOrder: number
}

type FolderDb = {
  id: string
  department_id: string
  parent_id: string | null
  level: FolderLevel
  depth: number
  name: string
  reference_id: string | null
  description: string | null
  allow_subfolders: boolean
  created_at: string
  created_by: string | null
  template_instance_id: string | null
  template_node_id: string | null
  is_private: boolean
  subfolders: { count: number }[]
  creator: { id: string; full_name: string } | null
}

const FOLDER_COLUMNS =
  "id, department_id, parent_id, level, depth, name, reference_id, description, allow_subfolders, created_at, created_by, template_instance_id, template_node_id, is_private, subfolders:folders!parent_id(count), creator:profiles!folders_created_by_fkey(id, full_name)"

function fail(what: string, message: string): never {
  throw new Error(`Could not load ${what}: ${message}`)
}

function toFolderRow(f: FolderDb): FolderRow {
  return {
    id: f.id,
    departmentId: f.department_id,
    parentId: f.parent_id,
    level: f.level,
    depth: f.depth,
    name: f.name,
    referenceId: f.reference_id,
    description: f.description,
    allowSubfolders: f.allow_subfolders,
    subfolderCount: f.subfolders[0]?.count ?? 0,
    createdAt: f.created_at,
    createdBy: f.creator ? { id: f.creator.id, fullName: f.creator.full_name } : null,
    templateInstanceId: f.template_instance_id,
    templateNodeId: f.template_node_id,
    isPrivate: f.is_private,
  }
}

/** Departments whose repository the signed-in user may browse (RLS decides). Cached per request. */
export const listRepositoryDepartments = cache(async (): Promise<RepositoryDepartment[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("folders")
    .select("id, department:departments!inner(id, name, code, is_active), children:folders!parent_id(count)")
    .eq("level", "root")
  if (error) fail("the repository", error.message)

  const rows = (data ?? []) as unknown as {
    id: string
    department: { id: string; name: string; code: string; is_active: boolean }
    children: { count: number }[]
  }[]
  return rows
    .map((r) => ({
      id: r.department.id,
      name: r.department.name,
      code: r.department.code,
      isActive: r.department.is_active,
      rootFolderId: r.id,
      childCount: r.children[0]?.count ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

/** The department (by code) and its root folder, or null if it does not exist or is not visible. */
export const getRepositoryDepartment = cache(async (code: string): Promise<RepositoryDepartment | null> => {
  const all = await listRepositoryDepartments()
  return all.find((d) => d.code === code.toUpperCase()) ?? null
})

export const getFolder = cache(async (id: string): Promise<FolderRow | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.from("folders").select(FOLDER_COLUMNS).eq("id", id).maybeSingle()
  if (error) {
    // An id that is not a UUID is simply "not found".
    if (error.code === "22P02") return null
    fail("the folder", error.message)
  }
  if (!data) return null
  return toFolderRow(data as unknown as FolderDb)
})

export type Ancestor = { id: string; name: string; level: FolderLevel; depth: number; referenceId: string | null }

/** The folder's ancestors, from the department root down to its parent (for breadcrumbs). */
export async function folderAncestors(folderId: string): Promise<Ancestor[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("folder_ancestors", { p_folder_id: folderId })
  if (error) fail("the folder path", error.message)
  return ((data ?? []) as { id: string; name: string; level: FolderLevel; depth: number; reference_id: string | null }[]).map((a) => ({
    id: a.id,
    name: a.name,
    level: a.level,
    depth: a.depth,
    referenceId: a.reference_id,
  }))
}

export async function listSubfolders(parentId: string): Promise<FolderRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("folders").select(FOLDER_COLUMNS).eq("parent_id", parentId).eq("is_private", false).order("name")
  if (error) fail("folders", error.message)
  return ((data ?? []) as unknown as FolderDb[]).map(toFolderRow)
}

export async function listDocumentTypes(options: { activeOnly?: boolean } = {}): Promise<DocumentTypeRow[]> {
  const supabase = await createClient()
  let query = supabase.from("document_types").select("id, code, name, description, is_active, sort_order").order("sort_order").order("code")
  if (options.activeOnly) query = query.eq("is_active", true)
  const { data, error } = await query
  if (error) fail("document types", error.message)
  return ((data ?? []) as { id: string; code: string; name: string; description: string | null; is_active: boolean; sort_order: number }[]).map(
    (t) => ({ id: t.id, code: t.code, name: t.name, description: t.description, isActive: t.is_active, sortOrder: t.sort_order })
  )
}
