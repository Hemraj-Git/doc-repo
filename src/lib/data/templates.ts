import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import type { TemplateNode } from "@/lib/templates"

export type TemplateSummary = {
  id: string
  name: string
  description: string | null
  instanceLabel: string
  departmentIds: string[] | null
  allowExtraFolders: boolean
  isActive: boolean
  version: number
  updatedAt: string
  nodeCount: number
  usedBy: string[]
}

type TemplateDb = {
  id: string
  name: string
  description: string | null
  instance_label: string
  department_ids: string[] | null
  allow_extra_folders: boolean
  is_active: boolean
  version: number
  updated_at: string
  nodes: { count: number }[]
}

const TEMPLATE_COLUMNS =
  "id, name, description, instance_label, department_ids, allow_extra_folders, is_active, version, updated_at, nodes:template_nodes!template_nodes_template_id_fkey(count)"

function toSummary(t: TemplateDb, usedBy: string[]): TemplateSummary {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    instanceLabel: t.instance_label,
    departmentIds: t.department_ids,
    allowExtraFolders: t.allow_extra_folders,
    isActive: t.is_active,
    version: t.version,
    updatedAt: t.updated_at,
    nodeCount: t.nodes[0]?.count ?? 0,
    usedBy,
  }
}

/** Every template, with which other templates use it as a slot. */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const supabase = await createClient()
  const [{ data, error }, { data: slots }] = await Promise.all([
    supabase.from("templates").select(TEMPLATE_COLUMNS).order("name"),
    supabase.from("template_nodes").select("slot_template_id, template:templates!template_nodes_template_id_fkey(name)").eq("kind", "slot"),
  ])
  if (error) throw new Error(`Could not load templates: ${error.message}`)
  const usedBy = new Map<string, string[]>()
  for (const s of (slots ?? []) as unknown as { slot_template_id: string; template: { name: string } }[]) {
    const list = usedBy.get(s.slot_template_id) ?? []
    if (!list.includes(s.template.name)) list.push(s.template.name)
    usedBy.set(s.slot_template_id, list)
  }
  return ((data ?? []) as unknown as TemplateDb[]).map((t) => toSummary(t, usedBy.get(t.id) ?? []))
}

type NodeDb = {
  id: string
  parent_id: string | null
  kind: TemplateNode["kind"]
  sort_order: number
  name: string
  allow_subfolders: boolean
  document_type_id: string | null
  description: string | null
  recurrence: TemplateNode["recurrence"]
  storage: TemplateNode["storage"]
  create_offset_days: number
  due_mode: TemplateNode["dueMode"]
  due_days: number
  uploader_rule: TemplateNode["uploaderRule"]
  fixed_uploader_id: string | null
  requires_review: boolean
  slot_template_id: string | null
  slot_owner_label: string | null
  slot_entry_dates: boolean
  reviewers: { step_order: number; rule: TemplateNode["reviewers"][number]["rule"]; user_id: string | null }[]
}

export function toNode(n: NodeDb): TemplateNode {
  return {
    id: n.id,
    parentId: n.parent_id,
    kind: n.kind,
    sortOrder: n.sort_order,
    name: n.name,
    allowSubfolders: n.allow_subfolders,
    documentTypeId: n.document_type_id,
    description: n.description,
    recurrence: n.recurrence,
    storage: n.storage,
    createOffsetDays: n.create_offset_days,
    dueMode: n.due_mode,
    dueDays: n.due_days,
    uploaderRule: n.uploader_rule,
    fixedUploaderId: n.fixed_uploader_id,
    requiresReview: n.requires_review,
    slotTemplateId: n.slot_template_id,
    slotOwnerLabel: n.slot_owner_label,
    slotEntryDates: n.slot_entry_dates,
    reviewers: n.reviewers
      .sort((a, b) => a.step_order - b.step_order)
      .map((r) => ({ stepOrder: r.step_order, rule: r.rule, userId: r.user_id })),
  }
}

export const NODE_COLUMNS =
  "id, parent_id, kind, sort_order, name, allow_subfolders, document_type_id, description, recurrence, storage, create_offset_days, due_mode, due_days, uploader_rule, fixed_uploader_id, requires_review, slot_template_id, slot_owner_label, slot_entry_dates, reviewers:template_node_reviewers(step_order, rule, user_id)"

export const getTemplate = cache(async (id: string): Promise<{ template: TemplateSummary; nodes: TemplateNode[] } | null> => {
  const supabase = await createClient()
  const [{ data, error }, { data: nodes, error: nodesError }] = await Promise.all([
    supabase.from("templates").select(TEMPLATE_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("template_nodes").select(NODE_COLUMNS).eq("template_id", id),
  ])
  if (error?.code === "22P02") return null
  if (error || nodesError) throw new Error(`Could not load the template: ${(error ?? nodesError)!.message}`)
  if (!data) return null
  return {
    template: toSummary(data as unknown as TemplateDb, []),
    nodes: ((nodes ?? []) as unknown as NodeDb[]).map(toNode),
  }
})

/** Nodes of several templates at once (for previews of nested slots). */
export async function getTemplateNodes(templateIds: string[]): Promise<Record<string, TemplateNode[]>> {
  if (templateIds.length === 0) return {}
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("template_nodes")
    .select(`template_id, ${NODE_COLUMNS}`)
    .in("template_id", templateIds)
  if (error) throw new Error(`Could not load templates: ${error.message}`)
  const out: Record<string, TemplateNode[]> = {}
  for (const row of (data ?? []) as unknown as (NodeDb & { template_id: string })[]) {
    ;(out[row.template_id] ??= []).push(toNode(row))
  }
  return out
}
