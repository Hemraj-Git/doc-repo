"use server"

import { revalidatePath } from "next/cache"
import { fail, fromDbError, invalid, ok, type ActionResult } from "@/lib/actions"
import { hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"
import type { NodeKind } from "@/lib/templates"
import { nodeSchema, templateDetailsSchema, type NodeInput, type TemplateDetailsInput } from "@/lib/validation/templates"

const NO_PERMISSION = "You do not have permission to edit templates."

async function authorised() {
  return hasPerm(await requireAppContext(), "template.manage")
}

function refresh(templateId?: string) {
  revalidatePath("/admin/templates")
  if (templateId) revalidatePath(`/admin/templates/${templateId}`)
}

function detailsRow(v: ReturnType<typeof templateDetailsSchema.parse>) {
  return {
    name: v.name,
    description: v.description,
    instance_label: v.instanceLabel,
    department_ids: v.departmentIds.length ? v.departmentIds : null,
    allow_extra_folders: v.allowExtraFolders,
    is_active: v.isActive,
  }
}

export async function createTemplate(input: TemplateDetailsInput): Promise<ActionResult<{ id: string }>> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const parsed = templateDetailsSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data, error } = await supabase.from("templates").insert(detailsRow(parsed.data)).select("id").single()
  if (error) return fromDbError(error)
  refresh()
  return ok({ id: data.id as string })
}

export async function updateTemplate(templateId: string, input: TemplateDetailsInput): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const parsed = templateDetailsSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase.from("templates").update(detailsRow(parsed.data)).eq("id", templateId)
  if (error) return fromDbError(error)
  refresh(templateId)
  return ok()
}

export async function deleteTemplate(templateId: string): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error } = await supabase.from("templates").delete().eq("id", templateId)
  if (error) return fromDbError(error)
  refresh()
  return ok()
}

const DEFAULT_NAMES: Record<NodeKind, string> = { folder: "New folder", document: "New document", slot: "New slot" }

/** Adds a node at the end of its siblings. Documents need a type and slots a template, so callers pass them. */
export async function addNode(
  templateId: string,
  parentId: string | null,
  kind: NodeKind,
  options: { documentTypeId?: string; slotTemplateId?: string } = {}
): Promise<ActionResult<{ id: string }>> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const supabase = await createClient()

  let siblings = supabase.from("template_nodes").select("sort_order").eq("template_id", templateId)
  siblings = parentId ? siblings.eq("parent_id", parentId) : siblings.is("parent_id", null)
  const { data: last } = await siblings.order("sort_order", { ascending: false }).limit(1).maybeSingle()

  let documentTypeId = options.documentTypeId ?? null
  if (kind === "document" && !documentTypeId) {
    const { data: type } = await supabase.from("document_types").select("id").eq("is_active", true).order("sort_order").limit(1).maybeSingle()
    documentTypeId = (type?.id as string | undefined) ?? null
    if (!documentTypeId) return fail("Create a document type first (Admin → Document Types).")
  }
  if (kind === "slot" && !options.slotTemplateId) return fail("Choose which template the slot repeats.")

  const { data, error } = await supabase
    .from("template_nodes")
    .insert({
      template_id: templateId,
      parent_id: parentId,
      kind,
      name: DEFAULT_NAMES[kind],
      sort_order: ((last?.sort_order as number | undefined) ?? 0) + 10,
      document_type_id: kind === "document" ? documentTypeId : null,
      slot_template_id: kind === "slot" ? options.slotTemplateId : null,
    })
    .select("id")
    .single()
  if (error) return fromDbError(error)
  refresh(templateId)
  return ok({ id: data.id as string })
}

export async function updateNode(templateId: string, nodeId: string, input: NodeInput): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const parsed = nodeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data

  const supabase = await createClient()
  const { data: current } = await supabase.from("template_nodes").select("kind").eq("id", nodeId).maybeSingle()
  if (!current) return fail("Item not found.")
  const kind = current.kind as NodeKind

  const row: Record<string, unknown> = { name: v.name }
  if (kind === "folder") row.allow_subfolders = v.allowSubfolders
  if (kind === "slot") {
    if (!v.slotTemplateId) return fail("Choose which template the slot repeats.", { slotTemplateId: "Choose a template" })
    row.slot_template_id = v.slotTemplateId
    row.slot_owner_label = v.slotOwnerLabel
    row.slot_entry_dates = v.slotEntryDates
  }
  if (kind === "document") {
    if (!v.documentTypeId) return fail("Choose a document type.", { documentTypeId: "Choose a document type" })
    Object.assign(row, {
      document_type_id: v.documentTypeId,
      description: v.description || null,
      recurrence: v.recurrence,
      storage: v.recurrence === "once" ? "here" : v.storage,
      create_offset_days: v.recurrence === "once" ? 0 : v.createOffsetDays,
      due_mode: v.dueMode,
      due_days: v.dueDays,
      uploader_rule: v.uploaderRule,
      fixed_uploader_id: v.uploaderRule === "fixed" ? v.fixedUploaderId : null,
      requires_review: v.requiresReview,
    })
  }

  const { error } = await supabase.from("template_nodes").update(row).eq("id", nodeId)
  if (error) return fromDbError(error)

  if (kind === "document") {
    const steps = v.requiresReview ? v.reviewers.map((r) => ({ rule: r.rule, user_id: r.rule === "fixed" ? r.userId : null })) : []
    const { error: reviewersError } = await supabase.rpc("set_template_node_reviewers", { p_node_id: nodeId, p_steps: steps })
    if (reviewersError) return fromDbError(reviewersError)
  }

  refresh(templateId)
  return ok()
}

/** Swaps a node with its previous or next sibling. */
export async function moveNode(templateId: string, nodeId: string, direction: "up" | "down"): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { data: node } = await supabase.from("template_nodes").select("id, parent_id, sort_order").eq("id", nodeId).maybeSingle()
  if (!node) return fail("Item not found.")

  let q = supabase.from("template_nodes").select("id, sort_order").eq("template_id", templateId)
  q = node.parent_id ? q.eq("parent_id", node.parent_id) : q.is("parent_id", null)
  const { data: siblings } = await q.order("sort_order").order("name")
  const list = (siblings ?? []) as { id: string; sort_order: number }[]
  const i = list.findIndex((s) => s.id === nodeId)
  const j = direction === "up" ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= list.length) return ok()

  // Renumber so equal sort orders can't get stuck, then swap.
  const order = list.map((s) => s.id)
  ;[order[i], order[j]] = [order[j]!, order[i]!]
  for (const [index, id] of order.entries()) {
    const { error } = await supabase.from("template_nodes").update({ sort_order: (index + 1) * 10 }).eq("id", id)
    if (error) return fromDbError(error)
  }
  refresh(templateId)
  return ok()
}

/** Copies a folder, item or slot with everything inside it, right after the original. */
export async function duplicateNode(templateId: string, nodeId: string): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error } = await supabase.rpc("duplicate_template_node", { p_node: nodeId })
  if (error) return fromDbError(error)
  refresh(templateId)
  return ok()
}

export async function deleteNode(templateId: string, nodeId: string): Promise<ActionResult> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  const { error } = await supabase.from("template_nodes").delete().eq("id", nodeId)
  if (error) return fromDbError(error)
  refresh(templateId)
  return ok()
}

export async function runSchedulerNow(): Promise<ActionResult<{ created: number; errors: number }>> {
  if (!(await authorised())) return fail("You do not have permission to run the scheduler.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("run_scheduler_now")
  if (error) return fromDbError(error)
  revalidatePath("/", "layout")
  const run = data as { created_count: number; error_count: number }
  return ok({ created: run.created_count, errors: run.error_count })
}

/** Adds the template's new folders and items to the given instances. */
export async function pushTemplateUpdates(templateId: string, instanceIds: string[]): Promise<ActionResult<{ added: number }>> {
  if (!(await authorised())) return fail(NO_PERMISSION)
  const supabase = await createClient()
  let added = 0
  for (const id of instanceIds) {
    const { data, error } = await supabase.rpc("push_template_updates", { p_instance: id })
    if (error) return fromDbError(error)
    added += (data as number) ?? 0
  }
  refresh(templateId)
  revalidatePath("/repository", "layout")
  return ok({ added })
}
