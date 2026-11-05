// Client-safe template constants and helpers.

export type NodeKind = "folder" | "document" | "slot"
export type Recurrence = "once" | "weekly" | "monthly" | "quarterly" | "semester" | "half_yearly" | "academic_year"
export type PeriodStorage = "here" | "academic_year" | "academic_year_semester"
export type DueMode = "none" | "period_end" | "after_creation"
export type UploaderRule = "chosen" | "slot_owner" | "department_head" | "fixed"
export type ReviewerRule = "fixed" | "department_head" | "uploader_manager" | "slot_owner_manager"

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  once: "Once",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semester: "Per semester",
  half_yearly: "Half-yearly",
  academic_year: "Per academic year",
}

export const STORAGE_LABELS: Record<PeriodStorage, string> = {
  here: "In this folder",
  academic_year: "Academic year folder (e.g. 2026–27)",
  academic_year_semester: "Academic year → Semester folders",
}

export const DUE_LABELS: Record<DueMode, string> = {
  none: "No due date",
  period_end: "Days after the period ends",
  after_creation: "Days after it is created",
}

export const UPLOADER_LABELS: Record<UploaderRule, string> = {
  chosen: "Chosen when the instance is created",
  slot_owner: "The slot owner (e.g. subject teacher)",
  department_head: "Head of the department",
  fixed: "A specific person",
}

export const REVIEWER_LABELS: Record<ReviewerRule, string> = {
  fixed: "A specific person",
  department_head: "Head of the department",
  uploader_manager: "The uploader's reporting manager",
  slot_owner_manager: "The slot owner's reporting manager",
}

/** Example period labels, as the scheduler will name each requirement. */
export const PERIOD_EXAMPLES: Record<Exclude<Recurrence, "once">, string> = {
  weekly: "Week 3 (13–19 Jul 2026)",
  monthly: "July 2026",
  quarterly: "Q1 2026–27 (Jul–Sep 2026)",
  semester: "Semester 1, 2026–27",
  half_yearly: "H1 2026–27 (Jul–Dec 2026)",
  academic_year: "2026–27",
}

export function exampleName(name: string, recurrence: Recurrence) {
  return recurrence === "once" ? name : `${name} – ${PERIOD_EXAMPLES[recurrence]}`
}

export type TemplateNode = {
  id: string
  parentId: string | null
  kind: NodeKind
  sortOrder: number
  name: string
  allowSubfolders: boolean
  documentTypeId: string | null
  description: string | null
  recurrence: Recurrence
  storage: PeriodStorage
  createOffsetDays: number
  dueMode: DueMode
  dueDays: number
  uploaderRule: UploaderRule
  fixedUploaderId: string | null
  requiresReview: boolean
  slotTemplateId: string | null
  slotOwnerLabel: string | null
  /** Slot entries have their own start and end date (e.g. semesters). */
  slotEntryDates: boolean
  reviewers: { stepOrder: number; rule: ReviewerRule; userId: string | null }[]
}

export type TemplateTreeNode = TemplateNode & { children: TemplateTreeNode[] }

/** Builds the nested tree, ordered by sort_order then name. */
export function buildTree(nodes: TemplateNode[]): TemplateTreeNode[] {
  const byParent = new Map<string | null, TemplateNode[]>()
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? []
    list.push(n)
    byParent.set(n.parentId, list)
  }
  const build = (parentId: string | null): TemplateTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((n) => ({ ...n, children: build(n.id) }))
  return build(null)
}
