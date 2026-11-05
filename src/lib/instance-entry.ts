// Client-safe model of what the "New from template" wizard collects, and how it
// maps to the payload of instantiate_template() / add_slot_entry().
import { formatDate } from "@/lib/format"
import { buildTree, type TemplateNode, type TemplateTreeNode } from "@/lib/templates"

export type Bundle = {
  templates: Record<string, { id: string; name: string; description: string | null; instanceLabel: string }>
  nodes: Record<string, TemplateNode[]>
}

export type EntryValue = {
  name: string
  referenceId: string
  ownerId: string | null
  /** Own dates (YYYY-MM-DD), for entries of slots that ask for them; "" takes the parent's. */
  startDate: string
  endDate: string
  /** template node id → uploader, for items whose uploader is "chosen". */
  uploaders: Record<string, string | null>
  /** slot node id → entries */
  slots: Record<string, EntryValue[]>
}

export const emptyEntry = (name = ""): EntryValue => ({ name, referenceId: "", ownerId: null, startDate: "", endDate: "", uploaders: {}, slots: {} })

export function treeOf(bundle: Bundle, templateId: string): TemplateTreeNode[] {
  return buildTree(bundle.nodes[templateId] ?? [])
}

/** Slot nodes of a template, anywhere in its folder tree, with the folder path they sit in. */
export function slotsOf(bundle: Bundle, templateId: string) {
  const out: { node: TemplateNode; path: string[] }[] = []
  const walk = (list: TemplateTreeNode[], path: string[]) => {
    for (const n of list) {
      if (n.kind === "slot") out.push({ node: n, path })
      if (n.kind === "folder") walk(n.children, [...path, n.name])
    }
  }
  walk(treeOf(bundle, templateId), [])
  return out
}

export type EntryPath = [string, number][]

export type ItemNeed = {
  /** Unique key across the whole wizard. */
  key: string
  /** Where the entry holding this item sits (for updateEntryAt). */
  path: EntryPath
  node: TemplateNode
  location: string
  entryName: string
  ownerId: string | null
}

/** Every document item, in this entry and all slot entries, with where it ends up. */
export function itemsOf(bundle: Bundle, templateId: string, entry: EntryValue, location: string[] = [], path: EntryPath = []): ItemNeed[] {
  const out: ItemNeed[] = []
  const here = [...location, entry.name || "…"]
  const walk = (list: TemplateTreeNode[], folderPath: string[]) => {
    for (const n of list) {
      if (n.kind === "document") {
        out.push({
          key: [...path.map((p) => p.join(":")), n.id].join("/"),
          path,
          node: n,
          location: [...here, ...folderPath].join(" › "),
          entryName: entry.name,
          ownerId: entry.ownerId,
        })
      } else if (n.kind === "folder") {
        walk(n.children, [...folderPath, n.name])
      } else if (n.slotTemplateId) {
        ;(entry.slots[n.id] ?? []).forEach((child, i) =>
          out.push(...itemsOf(bundle, n.slotTemplateId!, child, [...here, ...folderPath], [...path, [n.id, i]]))
        )
      }
    }
  }
  walk(treeOf(bundle, templateId), [])
  return out
}

/** Folders and requirements the wizard will create now (period folders not included). */
export function summarise(bundle: Bundle, templateId: string, entry: EntryValue) {
  let folders = 1
  let once = 0
  let series = 0
  const walk = (list: TemplateTreeNode[], e: EntryValue) => {
    for (const n of list) {
      if (n.kind === "folder") {
        folders++
        walk(n.children, e)
      } else if (n.kind === "document") {
        if (n.recurrence === "once") once++
        else series++
      } else if (n.slotTemplateId) {
        for (const child of e.slots[n.id] ?? []) {
          folders++
          walk(treeOf(bundle, n.slotTemplateId), child)
        }
      }
    }
  }
  walk(treeOf(bundle, templateId), entry)
  return { folders, once, series }
}

/** Where recurring requirements begin when the start date has passed: backfill, or go-forward. */
export type RequirementsFrom = "start_date" | "today"

type Payload = {
  name: string
  reference_id?: string
  owner_id?: string
  start_date?: string
  end_date?: string
  requirements_from?: RequirementsFrom
  uploaders: Record<string, string>
  slots: Record<string, Payload[]>
}

/** The dates entries fall back on when theirs are left blank: those of whatever they sit inside. */
export type ParentDates = {
  name: string
  start: string
  end: string
  /** The parent is itself a slot entry (e.g. a semester), so dates inside it are optional. */
  isEntry: boolean
}

/** What entries inside `entry` fall back on. */
export const datesInside = (entry: EntryValue, parent: ParentDates, fallbackName: string): ParentDates => ({
  name: entry.name.trim() || fallbackName,
  start: entry.startDate || parent.start,
  end: entry.endDate || parent.end,
  isEntry: true,
})

/** Explains what happens to dates left blank, with the actual dates once they are known. */
export function inheritedDatesHint(parent: ParentDates): string {
  const range = parent.start ? ` (${formatDate(parent.start)} – ${parent.end ? formatDate(parent.end) : "no end date"})` : ""
  return `Leave blank to use the dates of “${parent.name}”${range}.`
}

export type PastStartEntry = { name: string; start: string; end: string }

/**
 * Entries holding recurring items whose start date has passed, so the creator has to choose where
 * their requirements begin. `dates` are the actual dates of `entry` itself.
 */
export function pastStartEntries(bundle: Bundle, templateId: string, entry: EntryValue, dates: ParentDates, today: string): PastStartEntry[] {
  const hasRecurring = (list: TemplateTreeNode[]): boolean =>
    list.some((n) => (n.kind === "folder" ? hasRecurring(n.children) : n.kind === "document" && n.recurrence !== "once"))

  const out: PastStartEntry[] = []
  if (dates.start && dates.start < today && hasRecurring(treeOf(bundle, templateId))) {
    out.push({ name: dates.name, start: dates.start, end: dates.end })
  }
  for (const { node } of slotsOf(bundle, templateId)) {
    if (!node.slotTemplateId) continue
    for (const child of entry.slots[node.id] ?? []) {
      out.push(...pastStartEntries(bundle, node.slotTemplateId, child, datesInside(child, dates, node.name), today))
    }
  }
  return out
}

/**
 * Entries of date-bound slots (e.g. semesters) that are missing a required date or have them the wrong
 * way round. `dates` is what entries directly inside `entry` fall back on.
 */
export function entryDateProblem(bundle: Bundle, templateId: string, entry: EntryValue, dates: ParentDates): string | null {
  for (const { node } of slotsOf(bundle, templateId)) {
    for (const child of entry.slots[node.id] ?? []) {
      const label = child.name.trim() || node.name
      if (node.slotEntryDates && !dates.isEntry && (!child.startDate || !child.endDate)) return `Enter the start and end date of “${label}”.`
      const inside = datesInside(child, dates, label)
      if (inside.start && inside.end && inside.end < inside.start) return `The end date of “${label}” must be after its start date.`
      const nested = node.slotTemplateId ? entryDateProblem(bundle, node.slotTemplateId, child, inside) : null
      if (nested) return nested
    }
  }
  return null
}

/** The JSON instantiate_template() expects. Top-level dates come from the wizard; nested ones from each entry. */
export function toPayload(entry: EntryValue, dates?: { start: string; end: string }): Payload {
  const start = dates ? dates.start : entry.startDate
  const end = dates ? dates.end : entry.endDate
  const uploaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(entry.uploaders)) if (v) uploaders[k] = v
  return {
    name: entry.name.trim(),
    ...(entry.referenceId.trim() ? { reference_id: entry.referenceId.trim() } : {}),
    ...(entry.ownerId ? { owner_id: entry.ownerId } : {}),
    ...(start ? { start_date: start } : {}),
    ...(end ? { end_date: end } : {}),
    uploaders,
    slots: Object.fromEntries(Object.entries(entry.slots).map(([k, list]) => [k, list.map((c) => toPayload(c))])),
  }
}

/** Immutably update the entry at `path` (a list of [slotNodeId, index] steps). */
export function updateEntryAt(root: EntryValue, path: EntryPath, update: (e: EntryValue) => EntryValue): EntryValue {
  if (path.length === 0) return update(root)
  const [[slotId, index], ...rest] = path
  const list = [...(root.slots[slotId!] ?? [])]
  list[index!] = updateEntryAt(list[index!]!, rest, update)
  return { ...root, slots: { ...root.slots, [slotId!]: list } }
}
