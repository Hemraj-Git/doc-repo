import "server-only"
import { createClient } from "@/lib/supabase/server"
import { getTemplateNodes } from "@/lib/data/templates"
import { isClosed, type DocumentStatus } from "@/lib/documents"
import { emptyEntry, type EntryValue } from "@/lib/instance-entry"
import type { Recurrence, TemplateNode } from "@/lib/templates"

export type TemplateInfo = { id: string; name: string; description: string | null; instanceLabel: string }

/** Templates (with every template reachable through their slots) as one bundle for the wizard. */
export type TemplateBundle = {
  templates: Record<string, TemplateInfo>
  nodes: Record<string, TemplateNode[]>
  /** Templates the user may start from here. */
  available: string[]
}

export async function templateBundleFor(departmentId: string): Promise<TemplateBundle> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("templates")
    .select("id, name, description, instance_label, department_ids, is_active")
    .order("name")
  if (error) throw new Error(`Could not load templates: ${error.message}`)
  const all = (data ?? []) as {
    id: string
    name: string
    description: string | null
    instance_label: string
    department_ids: string[] | null
    is_active: boolean
  }[]
  const templates = Object.fromEntries(
    all.map((t) => [t.id, { id: t.id, name: t.name, description: t.description, instanceLabel: t.instance_label }])
  )
  const available = all
    .filter((t) => t.is_active && (!t.department_ids || t.department_ids.includes(departmentId)))
    .map((t) => t.id)

  const nodes: Record<string, TemplateNode[]> = {}
  let frontier = [...available]
  for (let level = 0; level < 5 && frontier.length; level++) {
    const fetched = await getTemplateNodes(frontier.filter((id) => !(id in nodes)))
    for (const id of frontier) nodes[id] ??= []
    Object.assign(nodes, fetched)
    frontier = [
      ...new Set(
        Object.values(fetched)
          .flat()
          .filter((n) => n.kind === "slot" && n.slotTemplateId && !(n.slotTemplateId in nodes))
          .map((n) => n.slotTemplateId!)
      ),
    ]
  }
  return { templates, nodes, available }
}

export type InstanceInfo = {
  id: string
  name: string
  templateId: string | null
  templateName: string
  rootFolderId: string
  parentInstanceId: string | null
  slotNodeId: string | null
  status: "active" | "closed"
  startDate: string
  endDate: string | null
  createdAt: string
  slotOwner: string | null
}

type InstanceDb = {
  id: string
  name: string
  template_id: string | null
  template_name: string
  root_folder_id: string
  parent_instance_id: string | null
  slot_node_id: string | null
  status: "active" | "closed"
  start_date: string
  end_date: string | null
  created_at: string
  owner: { full_name: string } | null
}

const INSTANCE_COLUMNS =
  "id, name, template_id, template_name, root_folder_id, parent_instance_id, slot_node_id, status, start_date, end_date, created_at, owner:profiles!template_instances_slot_owner_id_fkey(full_name)"

function toInstance(i: InstanceDb): InstanceInfo {
  return {
    id: i.id,
    name: i.name,
    templateId: i.template_id,
    templateName: i.template_name,
    rootFolderId: i.root_folder_id,
    parentInstanceId: i.parent_instance_id,
    slotNodeId: i.slot_node_id,
    status: i.status,
    startDate: i.start_date,
    endDate: i.end_date,
    createdAt: i.created_at,
    slotOwner: i.owner?.full_name ?? null,
  }
}

export async function getInstance(id: string): Promise<InstanceInfo | null> {
  const supabase = await createClient()
  const { data } = await supabase.from("template_instances").select(INSTANCE_COLUMNS).eq("id", id).maybeSingle()
  return data ? toInstance(data as unknown as InstanceDb) : null
}

/** Whether the slot an instance was added through asks each entry for its own dates (e.g. semesters). */
export async function slotNeedsDates(slotNodeId: string | null) {
  if (!slotNodeId) return false
  const supabase = await createClient()
  const { data } = await supabase.from("template_nodes").select("slot_entry_dates").eq("id", slotNodeId).maybeSingle()
  return Boolean(data?.slot_entry_dates)
}

/** For a folder created from a template: its instance, and the slots whose entries live in this folder. */
export async function folderTemplateContext(folder: { id: string; templateInstanceId: string | null; templateNodeId: string | null }) {
  if (!folder.templateInstanceId) return null
  const instance = await getInstance(folder.templateInstanceId)
  if (!instance || !instance.templateId) return instance ? { instance, slots: [], isRoot: instance.rootFolderId === folder.id } : null

  const isRoot = instance.rootFolderId === folder.id
  // Folders people added themselves inside an instance hold no slots.
  if (!isRoot && !folder.templateNodeId) return { instance, slots: [], isRoot }

  // Slots placed directly in this folder: at the template root (for the instance root) or inside this folder's node.
  const supabase = await createClient()
  let q = supabase
    .from("template_nodes")
    .select("id, name, slot_template_id, slot_owner_label, slot_entry_dates")
    .eq("template_id", instance.templateId)
    .eq("kind", "slot")
  q = isRoot ? q.is("parent_id", null) : q.eq("parent_id", folder.templateNodeId!)
  const { data } = await q.order("sort_order")
  const slots = ((data ?? []) as { id: string; name: string; slot_template_id: string; slot_owner_label: string | null; slot_entry_dates: boolean }[]).map((s) => ({
    id: s.id,
    name: s.name,
    slotTemplateId: s.slot_template_id,
    ownerLabel: s.slot_owner_label,
    entryDates: s.slot_entry_dates,
  }))
  return { instance, slots, isRoot }
}

export type SeriesPeriod = {
  documentId: string
  status: DocumentStatus
  dueDate: string | null
  key: string
  label: string
  start: string
  end: string
}

export type SeriesRow = {
  id: string
  /** The folder created from a template this belongs to; null for KPI series. */
  instanceId: string | null
  name: string
  recurrence: Exclude<Recurrence, "once">
  folder: { id: string; name: string }
  uploader: { id: string; fullName: string }
  isPaused: boolean
  endDate: string | null
  lastPeriodEnd: string | null
  /** Set when the creator chose to start from today instead of backfilling past periods. */
  requirementsFrom: string | null
  openCount: number
  closedCount: number
  /** Every period created so far, oldest first. */
  periods: SeriesPeriod[]
}

/** An instance and every instance nested inside it (subjects of a program, …). */
async function instanceTreeIds(instanceId: string) {
  const supabase = await createClient()
  const ids = [instanceId]
  let frontier = [instanceId]
  for (let level = 0; level < 6 && frontier.length; level++) {
    const { data } = await supabase.from("template_instances").select("id").in("parent_instance_id", frontier)
    frontier = ((data ?? []) as { id: string }[]).map((c) => c.id)
    ids.push(...frontier)
  }
  return ids
}

export type TrackerSection = {
  key: string
  label: string
  /** Null for the files that belong to no section. */
  start: string | null
  end: string | null
  instanceIds: string[]
}

/**
 * How the tracker divides what it shows:
 *  - all:      everything at once (an entry whose own dates already limit it, e.g. a semester)
 *  - sections: the entries people created (e.g. 1st Semester, 2nd Semester of a batch)
 *  - calendar: half-years of the academic year, for folders with neither
 */
export type TrackerView = { kind: "all" } | { kind: "calendar" } | { kind: "sections"; sections: TrackerSection[] }

type TreeRow = {
  id: string
  name: string
  start_date: string
  end_date: string | null
  parent_instance_id: string
  slot_node_id: string | null
}

/** Every instance nested inside this one. */
async function instanceDescendants(instanceId: string) {
  const supabase = await createClient()
  const rows: TreeRow[] = []
  let frontier = [instanceId]
  for (let level = 0; level < 6 && frontier.length; level++) {
    const { data, error } = await supabase
      .from("template_instances")
      .select("id, name, start_date, end_date, parent_instance_id, slot_node_id")
      .in("parent_instance_id", frontier)
    if (error) throw new Error(`Could not load the folders inside: ${error.message}`)
    const found = (data ?? []) as unknown as TreeRow[]
    rows.push(...found)
    frontier = found.map((r) => r.id)
  }
  return rows
}

/** Recurring series of an instance and everything nested inside it, and how the tracker should divide them. */
export async function loadTracker(instance: InstanceInfo): Promise<{ series: SeriesRow[]; view: TrackerView }> {
  const rows = await instanceDescendants(instance.id)
  const series = await listSeriesFor("instance_id", [instance.id, ...rows.map((r) => r.id)])

  if (instance.parentInstanceId && instance.endDate) return { series, view: { kind: "all" } }

  const children = rows.filter((r) => r.parent_instance_id === instance.id)
  const slotIds = [...new Set(children.map((r) => r.slot_node_id).filter((id): id is string => id !== null))]
  if (slotIds.length === 0) return { series, view: { kind: "calendar" } }
  const supabase = await createClient()
  const { data: datedSlots, error } = await supabase.from("template_nodes").select("id").in("id", slotIds).eq("slot_entry_dates", true)
  if (error) throw new Error(`Could not load the template: ${error.message}`)
  const dated = new Set(((datedSlots ?? []) as { id: string }[]).map((n) => n.id))

  const withPeriods = series.filter((s) => s.periods.length > 0)
  const idsUnder = (id: string): string[] => [id, ...rows.filter((r) => r.parent_instance_id === id).flatMap((r) => idsUnder(r.id))]
  const sections: TrackerSection[] = children
    .filter((r) => r.slot_node_id !== null && dated.has(r.slot_node_id))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))
    .map((r) => ({ key: r.id, label: r.name, start: r.start_date, end: r.end_date, instanceIds: idsUnder(r.id) }))
    .filter((section) => withPeriods.some((s) => s.instanceId !== null && section.instanceIds.includes(s.instanceId)))
  if (sections.length === 0) return { series, view: { kind: "calendar" } }

  // Files that sit outside every section get their own option, so nothing goes missing.
  const inSections = new Set(sections.flatMap((s) => s.instanceIds))
  const others = [...new Set(withPeriods.map((s) => s.instanceId).filter((id): id is string => id !== null && !inSections.has(id)))]
  if (others.length > 0) sections.push({ key: "other", label: `${instance.templateName} files`, start: null, end: null, instanceIds: others })

  return { series, view: { kind: "sections", sections } }
}

/** Recurring series of template instances or of KPI assignments, with their periods. */
export async function listSeriesFor(column: "instance_id" | "kpi_assignment_id", ids: string[]): Promise<SeriesRow[]> {
  if (ids.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("recurring_series")
    .select(
      "id, instance_id, name, recurrence, is_paused, end_date, last_period_end, requirements_from, folder:folders(id, name), uploader:profiles!recurring_series_uploader_id_fkey(id, full_name), docs:documents(id, status, due_date, period_key, period_label, period_start, period_end)"
    )
    .in(column, ids)
    .order("name")
  if (error) throw new Error(`Could not load recurring items: ${error.message}`)
  return ((data ?? []) as unknown as {
    id: string
    instance_id: string | null
    name: string
    recurrence: SeriesRow["recurrence"]
    is_paused: boolean
    end_date: string | null
    last_period_end: string | null
    requirements_from: string | null
    folder: { id: string; name: string }
    uploader: { id: string; full_name: string }
    docs: {
      id: string
      status: DocumentStatus
      due_date: string | null
      period_key: string
      period_label: string
      period_start: string
      period_end: string
    }[]
  }[])
    .map((s) => ({
      id: s.id,
      instanceId: s.instance_id,
      name: s.name,
      recurrence: s.recurrence,
      folder: s.folder,
      uploader: { id: s.uploader.id, fullName: s.uploader.full_name },
      isPaused: s.is_paused,
      endDate: s.end_date,
      lastPeriodEnd: s.last_period_end,
      requirementsFrom: s.requirements_from,
      openCount: s.docs.filter((x) => x.status === "pending_upload" || x.status === "changes_requested").length,
      closedCount: s.docs.filter((x) => isClosed(x.status)).length,
      periods: s.docs
        .map((x) => ({
          documentId: x.id,
          status: x.status,
          dueDate: x.due_date,
          key: x.period_key,
          label: x.period_label,
          start: x.period_start,
          end: x.period_end,
        }))
        .sort((a, b) => a.start.localeCompare(b.start)),
    }))
    .sort((a, b) => a.folder.name.localeCompare(b.folder.name) || a.name.localeCompare(b.name))
}

/**
 * The wizard entry an existing instance was created with (its slot entries, owners and
 * chosen uploaders), so a new program can start from it. The top-level name is left blank.
 */
export async function entryFromInstance(instanceId: string): Promise<{ templateId: string; name: string; entry: EntryValue } | null> {
  const root = await getInstance(instanceId)
  if (!root?.templateId) return null
  const supabase = await createClient()
  const ids = await instanceTreeIds(instanceId)

  const [instances, series, docs] = await Promise.all([
    supabase.from("template_instances").select("id, name, parent_instance_id, slot_node_id, slot_owner_id").in("id", ids),
    supabase.from("recurring_series").select("instance_id, template_node_id, uploader_id").in("instance_id", ids),
    supabase
      .from("documents")
      .select("template_instance_id, template_node_id, assigned_uploader_id")
      .in("template_instance_id", ids)
      .is("series_id", null)
      .not("template_node_id", "is", null),
  ])
  const rows = (instances.data ?? []) as {
    id: string
    name: string
    parent_instance_id: string | null
    slot_node_id: string | null
    slot_owner_id: string | null
  }[]
  const uploaders = new Map<string, Record<string, string>>()
  const put = (instance: string, node: string | null, user: string) => {
    if (!node) return
    uploaders.set(instance, { ...uploaders.get(instance), [node]: user })
  }
  for (const s of (series.data ?? []) as { instance_id: string; template_node_id: string | null; uploader_id: string }[]) {
    put(s.instance_id, s.template_node_id, s.uploader_id)
  }
  for (const d of (docs.data ?? []) as { template_instance_id: string; template_node_id: string | null; assigned_uploader_id: string }[]) {
    put(d.template_instance_id, d.template_node_id, d.assigned_uploader_id)
  }

  const build = (id: string, name: string, ownerId: string | null): EntryValue => {
    const slots: Record<string, EntryValue[]> = {}
    for (const child of rows.filter((r) => r.parent_instance_id === id && r.slot_node_id).sort((a, b) => a.name.localeCompare(b.name))) {
      slots[child.slot_node_id!] = [...(slots[child.slot_node_id!] ?? []), build(child.id, child.name, child.slot_owner_id)]
    }
    return { ...emptyEntry(name), ownerId, uploaders: uploaders.get(id) ?? {}, slots }
  }
  return { templateId: root.templateId, name: root.name, entry: build(root.id, "", null) }
}

export type TemplateUsage = {
  id: string
  name: string
  version: number
  status: "active" | "closed"
  rootFolderId: string
  department: { code: string; name: string }
  parentName: string | null
  createdAt: string
}

/** Every instance created from a template (for "push new items"). */
export async function listTemplateInstances(templateId: string): Promise<TemplateUsage[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("template_instances")
    .select(
      "id, name, template_version, status, root_folder_id, created_at, folder:folders!template_instances_root_folder_id_fkey(department:departments(code, name)), parent:template_instances!parent_instance_id(name)"
    )
    .eq("template_id", templateId)
    .order("created_at", { ascending: false })
  if (error) throw new Error(`Could not load instances: ${error.message}`)
  return ((data ?? []) as unknown as {
    id: string
    name: string
    template_version: number
    status: TemplateUsage["status"]
    root_folder_id: string
    created_at: string
    folder: { department: { code: string; name: string } }
    parent: { name: string } | null
  }[]).map((i) => ({
    id: i.id,
    name: i.name,
    version: i.template_version,
    status: i.status,
    rootFolderId: i.root_folder_id,
    department: i.folder.department,
    parentName: i.parent?.name ?? null,
    createdAt: i.created_at,
  }))
}
