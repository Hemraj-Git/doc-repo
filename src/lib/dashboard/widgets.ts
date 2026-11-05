import { hasPerm, type AccessContext } from "@/lib/auth/permissions"

export type DashboardSection = "overview" | "department" | "work" | "team"

export type WidgetDef = {
  id: string
  section: DashboardSection
  title: string
  description: string
  /** Build phase that delivers the widget's data. */
  phase: number
  /** Columns spanned in the 3-column grid (lg screens). */
  span: 1 | 2 | 3
  visible: (ctx: AccessContext) => boolean
}

export const SECTION_TITLES: Record<DashboardSection, string> = {
  overview: "Institute overview",
  department: "My department",
  work: "My work",
  team: "My team",
}

const everyone = () => true
const seesAll = (c: AccessContext) => hasPerm(c, "document.view.all")
const seesOwnDeptOnly = (c: AccessContext) => hasPerm(c, "document.view.own_dept") && !seesAll(c)

export const WIDGETS: WidgetDef[] = [
  // Institute overview — Super Admin, All-Access Viewer, and custom roles with document.view.all
  {
    id: "org-stats",
    section: "overview",
    title: "At a glance",
    description: "Departments, users and document totals",
    phase: 1,
    span: 3,
    visible: (c) => seesAll(c) || hasPerm(c, "department.manage", "user.manage"),
  },
  {
    id: "setup-health",
    section: "overview",
    title: "Setup health",
    description: "Departments without a head, users without a reporting manager",
    phase: 1,
    span: 1,
    visible: (c) => hasPerm(c, "department.manage", "user.manage"),
  },
  {
    id: "scheduler-health",
    section: "overview",
    title: "Recurring scheduler",
    description: "Last daily run of the template scheduler",
    phase: 7,
    span: 1,
    visible: (c) => hasPerm(c, "template.manage"),
  },
  {
    id: "verification-stats",
    section: "overview",
    title: "Certificate verifications",
    description: "Public portal requests this month",
    phase: 8,
    span: 1,
    visible: (c) => hasPerm(c, "verification.view_log"),
  },
  {
    id: "kpi-compliance",
    section: "overview",
    title: "KPI periods",
    description: "Active KPI assignments and overdue periods by department",
    phase: 9,
    span: 1,
    visible: (c) => hasPerm(c, "kpi.view_all"),
  },
  {
    id: "quick-actions",
    section: "overview",
    title: "Quick actions",
    description: "Shortcuts for setting up the organisation and repository",
    phase: 1,
    span: 1,
    visible: (c) =>
      hasPerm(
        c,
        "department.manage",
        "user.manage",
        "folder.create.own_dept",
        "folder.create.any_dept",
        "document.create.own_dept",
        "document.create.any_dept"
      ),
  },
  {
    id: "docs-by-department",
    section: "overview",
    title: "Documents by department",
    description: "Document count per department",
    phase: 5,
    span: 1,
    visible: seesAll,
  },
  {
    id: "docs-by-type",
    section: "overview",
    title: "Documents by type",
    description: "Doc, Form, QP, Template, CL, QM …",
    phase: 5,
    span: 1,
    visible: seesAll,
  },
  {
    id: "activity-trend",
    section: "overview",
    title: "Upload & approval activity",
    description: "Last 30 days",
    phase: 5,
    span: 2,
    visible: (c) => seesAll(c) && hasPerm(c, "department.manage"),
  },
  {
    id: "recently-approved",
    section: "overview",
    title: "Recently approved",
    description: "Latest approved documents across the institute",
    phase: 5,
    span: 1,
    visible: seesAll,
  },
  {
    id: "recent-audit",
    section: "overview",
    title: "Recent activity",
    description: "Latest entries in the audit log",
    phase: 5,
    span: 2,
    visible: (c) => hasPerm(c, "audit.view.all"),
  },

  // Department — HODs and custom roles with document.view.own_dept
  {
    id: "dept-kpis",
    section: "department",
    title: "Department at a glance",
    description: "Documents, pending uploads, in review, changes requested, approved this month",
    phase: 5,
    span: 3,
    visible: seesOwnDeptOnly,
  },
  {
    id: "recurring-compliance",
    section: "department",
    title: "Recurring compliance",
    description: "This week’s and month’s recurring files in your department",
    phase: 7,
    span: 1,
    visible: seesOwnDeptOnly,
  },
  {
    id: "requirement-tracker",
    section: "department",
    title: "Requirement tracker",
    description: "Open requirements with uploader, status and days pending",
    phase: 4,
    span: 2,
    visible: (c) => hasPerm(c, "document.create.own_dept", "document.create.any_dept"),
  },
  {
    id: "team-workload",
    section: "department",
    title: "Team workload",
    description: "Pending uploads per team member",
    phase: 4,
    span: 1,
    visible: (c) => c.isHod,
  },
  {
    id: "dept-docs-by-type",
    section: "department",
    title: "Documents by type",
    description: "Your department's documents by classification",
    phase: 5,
    span: 1,
    visible: seesOwnDeptOnly,
  },
  {
    id: "dept-activity",
    section: "department",
    title: "Department activity",
    description: "Latest audit events in your department",
    phase: 5,
    span: 2,
    visible: (c) => hasPerm(c, "audit.view.own_dept") && !hasPerm(c, "audit.view.all"),
  },

  // My work — everyone
  {
    id: "my-kpi-evidence",
    section: "work",
    title: "My KPIs",
    description: "KPI periods waiting for you to fill in",
    phase: 9,
    span: 1,
    visible: () => true,
  },
  {
    id: "kpis-to-score",
    section: "work",
    title: "KPIs to review and score",
    description: "KPI periods waiting for your approval or score",
    phase: 9,
    span: 1,
    visible: () => true,
  },
  {
    id: "my-kpis",
    section: "work",
    title: "My numbers",
    description: "Pending uploads, reviews waiting for me, changes requested, approved",
    phase: 4,
    span: 3,
    visible: everyone,
  },
  {
    id: "to-upload",
    section: "work",
    title: "To upload",
    description: "Documents assigned to you for upload",
    phase: 4,
    span: 1,
    visible: everyone,
  },
  {
    id: "to-review",
    section: "work",
    title: "To review",
    description: "Reviews where your step is active",
    phase: 4,
    span: 1,
    visible: everyone,
  },
  {
    id: "changes-requested",
    section: "work",
    title: "Changes requested",
    description: "Your uploads sent back by a reviewer",
    phase: 4,
    span: 1,
    visible: everyone,
  },
  {
    id: "recently-accessed",
    section: "work",
    title: "Recently accessed",
    description: "Documents you opened recently",
    phase: 5,
    span: 3,
    visible: everyone,
  },

  // Team — seniors with juniors (HODs see the department section instead)
  {
    id: "team-pending",
    section: "team",
    title: "Team pending uploads",
    description: "Open requirements assigned to people below you, oldest first",
    phase: 4,
    span: 1,
    visible: (c) => c.hasSubordinates && !c.isHod,
  },
  {
    id: "team-recent",
    section: "team",
    title: "Team recent uploads",
    description: "Latest versions uploaded by your team",
    phase: 4,
    span: 1,
    visible: (c) => c.hasSubordinates && !c.isHod,
  },
  {
    id: "team-status",
    section: "team",
    title: "Team status",
    description: "Pending, in review and approved",
    phase: 4,
    span: 1,
    visible: (c) => c.hasSubordinates && !c.isHod,
  },
]

export function widgetsFor(ctx: AccessContext) {
  const visible = WIDGETS.filter((w) => w.visible(ctx))
  const order: DashboardSection[] = ["work", "overview", "department", "team"]
  return order
    .map((section) => ({ section, title: SECTION_TITLES[section], widgets: visible.filter((w) => w.section === section) }))
    .filter((s) => s.widgets.length > 0)
}
