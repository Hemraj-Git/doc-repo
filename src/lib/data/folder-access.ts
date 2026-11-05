import "server-only"
import { folderAncestors } from "@/lib/data/repository"
import { createClient } from "@/lib/supabase/server"
import type { FolderAccess, GranteeKind } from "@/lib/validation/folder-access"

export type FolderGrant = {
  id: string
  kind: GranteeKind
  granteeId: string
  access: FolderAccess
  name: string
  /** Department code, or how many people are in the group. */
  hint: string | null
  /** The person or department can no longer use this grant. */
  inactive: boolean
}

export type InheritedGrant = FolderGrant & { fromFolder: string }

type GrantDb = {
  id: string
  folder_id: string
  access: FolderAccess
  user: { id: string; full_name: string; is_active: boolean; department: { code: string } | null } | null
  department: { id: string; name: string; code: string; is_active: boolean } | null
  group: { id: string; name: string; members: { count: number }[] } | null
}

const GRANT_COLUMNS = [
  "id, folder_id, access",
  "user:profiles!folder_permissions_user_id_fkey(id, full_name, is_active, department:departments!profiles_department_id_fkey(code))",
  "department:departments!folder_permissions_grantee_department_id_fkey(id, name, code, is_active)",
  "group:user_groups(id, name, members:user_group_members(count))",
].join(", ")

function toGrant(g: GrantDb): FolderGrant {
  if (g.user) {
    return {
      id: g.id,
      kind: "user",
      granteeId: g.user.id,
      access: g.access,
      name: g.user.full_name,
      hint: g.user.department?.code ?? null,
      inactive: !g.user.is_active,
    }
  }
  if (g.department) {
    return {
      id: g.id,
      kind: "department",
      granteeId: g.department.id,
      access: g.access,
      name: g.department.name,
      hint: "Department",
      inactive: !g.department.is_active,
    }
  }
  const members = g.group?.members[0]?.count ?? 0
  return {
    id: g.id,
    kind: "group",
    granteeId: g.group?.id ?? "",
    access: g.access,
    name: g.group?.name ?? "Group",
    hint: `Group · ${members} ${members === 1 ? "person" : "people"}`,
    inactive: false,
  }
}

/** Grants on this folder, and those it receives from its parents. RLS: only for people who manage access. */
export async function getFolderGrants(folderId: string): Promise<{ grants: FolderGrant[]; inherited: InheritedGrant[] }> {
  const ancestors = await folderAncestors(folderId)
  const names = new Map(ancestors.map((a) => [a.id, a.name]))
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("folder_permissions")
    .select(GRANT_COLUMNS)
    .in("folder_id", [folderId, ...names.keys()])
    .order("granted_at")
  if (error) throw new Error(`Could not load folder access: ${error.message}`)

  const rows = (data ?? []) as unknown as GrantDb[]
  return {
    grants: rows.filter((r) => r.folder_id === folderId).map(toGrant),
    inherited: rows.filter((r) => r.folder_id !== folderId).map((r) => ({ ...toGrant(r), fromFolder: names.get(r.folder_id) ?? "a parent folder" })),
  }
}

/** 'write' (may upload here), 'read' (may see its documents through a grant) or 'none'. */
export async function getMyFolderAccess(folderId: string): Promise<FolderAccess | "none"> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("my_folder_access", { p_folder: folderId })
  if (error) throw new Error(`Could not check folder access: ${error.message}`)
  return data as FolderAccess | "none"
}

export type SharedFolder = {
  id: string
  name: string
  referenceId: string | null
  href: string
  departmentName: string
  canUpload: boolean
}

/** Folders shared with the signed-in user, for "Shared with me". */
export async function listMySharedFolders(): Promise<SharedFolder[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("my_shared_folders")
  if (error) throw new Error(`Could not load shared folders: ${error.message}`)
  return (
    (data ?? []) as {
      folder_id: string
      name: string
      reference_id: string | null
      level: "root" | "child" | "sub"
      department_code: string
      department_name: string
      can_write: boolean
    }[]
  ).map((f) => ({
    id: f.folder_id,
    name: f.name,
    referenceId: f.reference_id,
    href: f.level === "root" ? `/repository/${f.department_code}` : `/repository/${f.department_code}/${f.folder_id}`,
    departmentName: f.department_name,
    canUpload: f.can_write,
  }))
}

export type GroupMember = { id: string; fullName: string; hint: string | null; isActive: boolean }
export type GroupFolder = { id: string; name: string; href: string | null; access: FolderAccess }
export type GroupRow = { id: string; name: string; description: string | null; members: GroupMember[]; folders: GroupFolder[] }

type GroupDb = {
  id: string
  name: string
  description: string | null
  members: {
    user: { id: string; full_name: string; is_active: boolean; designation: string | null; department: { code: string } | null }
  }[]
  grants: {
    access: FolderAccess
    folder: { id: string; name: string; level: "root" | "child" | "sub"; department: { code: string } } | null
  }[]
}

/** Every group, its members and the folders it can access. */
export async function listGroups(): Promise<GroupRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("user_groups")
    .select(
      [
        "id, name, description",
        "members:user_group_members(user:profiles!user_group_members_user_id_fkey(id, full_name, is_active, designation, department:departments!profiles_department_id_fkey(code)))",
        "grants:folder_permissions(access, folder:folders(id, name, level, department:departments(code)))",
      ].join(", ")
    )
    .order("name")
  if (error) throw new Error(`Could not load groups: ${error.message}`)

  return ((data ?? []) as unknown as GroupDb[]).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    members: g.members
      .map((m) => ({
        id: m.user.id,
        fullName: m.user.full_name,
        hint: [m.user.designation, m.user.department?.code].filter(Boolean).join(" · ") || null,
        isActive: m.user.is_active,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    folders: g.grants.flatMap((x) =>
      x.folder
        ? [
            {
              id: x.folder.id,
              name: x.folder.name,
              access: x.access,
              href: x.folder.level === "root" ? `/repository/${x.folder.department.code}` : `/repository/${x.folder.department.code}/${x.folder.id}`,
            },
          ]
        : []
    ),
  }))
}

/** Groups to choose from when giving access. */
export async function listGroupOptions(): Promise<{ value: string; label: string; hint: string }[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("user_groups").select("id, name, members:user_group_members(count)").order("name")
  if (error) throw new Error(`Could not load groups: ${error.message}`)
  return ((data ?? []) as unknown as { id: string; name: string; members: { count: number }[] }[]).map((g) => {
    const n = g.members[0]?.count ?? 0
    return { value: g.id, label: g.name, hint: `${n} ${n === 1 ? "person" : "people"}` }
  })
}
