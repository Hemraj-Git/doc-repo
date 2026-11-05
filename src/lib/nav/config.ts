import {
  Building2,
  ClipboardList,
  Contact,
  FileText,
  FolderTree,
  GraduationCap,
  Gauge,
  Target,
  BadgeCheck,
  Award,
  History,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  Network,
  Share2,
  Settings,
  ShieldCheck,
  Tags,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react"
import { hasPerm, seesKpiAdmin, seesStudents, type AccessContext } from "@/lib/auth/permissions"

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  /** Omitted = visible to every signed-in user. The same check guards the page itself. */
  visible?: (ctx: AccessContext) => boolean
  badge?: "tasks"
}

export type NavGroup = { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "My Tasks", href: "/tasks", icon: ListChecks, badge: "tasks" },
      { title: "Repository", href: "/repository", icon: FolderTree },
      { title: "My Documents", href: "/my-documents", icon: FileText },
      {
        title: "Team Documents",
        href: "/team",
        icon: UsersRound,
        visible: (c) => c.isHod || c.hasSubordinates,
      },
      { title: "Shared with me", href: "/shared", icon: Share2 },
      {
        title: "Requirements",
        href: "/requirements",
        icon: ClipboardList,
        visible: (c) => hasPerm(c, "document.create.own_dept", "document.create.any_dept"),
      },
      { title: "My KPIs", href: "/my-kpis", icon: Target },
      { title: "KPIs", href: "/kpis", icon: Gauge, visible: seesKpiAdmin },
      { title: "Students", href: "/students", icon: GraduationCap, visible: seesStudents },
      {
        title: "Audit Log",
        href: "/audit",
        icon: History,
        visible: (c) => hasPerm(c, "audit.view.own_dept", "audit.view.all"),
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        title: "Departments",
        href: "/admin/departments",
        icon: Building2,
        visible: (c) => hasPerm(c, "department.manage"),
      },
      { title: "Users", href: "/admin/users", icon: Users, visible: (c) => hasPerm(c, "user.manage") },
      { title: "Groups", href: "/admin/groups", icon: Contact, visible: (c) => hasPerm(c, "group.manage") },
      {
        title: "Org Chart",
        href: "/admin/org-chart",
        icon: Network,
        visible: (c) => c.isHod || hasPerm(c, "user.manage"),
      },
      {
        title: "Roles & Permissions",
        href: "/admin/roles",
        icon: ShieldCheck,
        visible: (c) => hasPerm(c, "role.manage"),
      },
      {
        title: "Document Types",
        href: "/admin/document-types",
        icon: Tags,
        visible: (c) => hasPerm(c, "document_type.manage"),
      },
      {
        title: "Certificate Types",
        href: "/admin/certificate-types",
        icon: Award,
        visible: (c) => hasPerm(c, "document_type.manage"),
      },
      {
        title: "Verification Log",
        href: "/admin/verifications",
        icon: BadgeCheck,
        visible: (c) => hasPerm(c, "verification.view_log"),
      },
      {
        title: "Templates",
        href: "/admin/templates",
        icon: LayoutTemplate,
        visible: (c) => hasPerm(c, "template.manage"),
      },
      {
        title: "Institute Settings",
        href: "/admin/settings",
        icon: Settings,
        visible: (c) => hasPerm(c, "settings.manage"),
      },
    ],
  },
]

export function visibleNav(ctx: AccessContext): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.visible || i.visible(ctx)) })).filter(
    (g) => g.items.length > 0
  )
}

export function findNavItem(href: string): NavItem | undefined {
  return NAV.flatMap((g) => g.items).find((i) => i.href === href)
}
