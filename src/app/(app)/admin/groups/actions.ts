"use server"

import { revalidatePath } from "next/cache"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import { groupSchema, type GroupInput } from "@/lib/validation/folder-access"

const NO_PERMISSION = "You do not have permission to manage groups."

async function authorised() {
  return hasPerm(await requireAppContext(), "group.manage")
}

function refresh() {
  // Membership changes who can reach which folders.
  revalidatePath("/", "layout")
}

export async function createGroup(input: GroupInput): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const parsed = groupSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase.from("user_groups").insert({ name: parsed.data.name, description: parsed.data.description || null })
  if (error) return fromDbError(error)

  refresh()
  return ok()
}

export async function updateGroup(id: string, input: GroupInput): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const parsed = groupSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase.from("user_groups").update({ name: parsed.data.name, description: parsed.data.description || null }).eq("id", id)
  if (error) return fromDbError(error)

  refresh()
  return ok()
}

/** The group's members and folder access go with it. */
export async function deleteGroup(id: string): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error } = await supabase.from("user_groups").delete().eq("id", id)
  if (error) return fromDbError(error)

  refresh()
  return ok()
}

export async function addGroupMember(groupId: string, userId: string): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error } = await supabase.from("user_group_members").insert({ group_id: groupId, user_id: userId })
  // Already a member: the outcome they wanted.
  if (error && error.code !== "23505") return fromDbError(error)

  refresh()
  return ok()
}

export async function removeGroupMember(groupId: string, userId: string): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error } = await supabase.from("user_group_members").delete().eq("group_id", groupId).eq("user_id", userId)
  if (error) return fromDbError(error)

  refresh()
  return ok()
}
