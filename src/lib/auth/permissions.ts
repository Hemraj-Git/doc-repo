// Mirrors public.permissions. UI checks only — RLS in the database is the real gate.
export const PERMISSIONS = [
  "department.manage",
  "user.manage",
  "role.manage",
  "document_type.manage",
  "template.manage",
  "settings.manage",
  "folder.create.own_dept",
  "folder.create.any_dept",
  "folder.share.own_dept",
  "folder.share.any_dept",
  "group.manage",
  "document.create.own_dept",
  "document.create.any_dept",
  "document.view.own_dept",
  "document.view.all",
  "document.download",
  "document.delete",
  "audit.view.own_dept",
  "audit.view.all",
  "student.view.own_dept",
  "student.view.all",
  "student.manage.own_dept",
  "student.manage.any_dept",
  "certificate.manage.own_dept",
  "certificate.manage.any_dept",
  "verification.view_log",
  "kpi.manage",
  "kpi.assign.own_dept",
  "kpi.assign.any_dept",
  "kpi.view_all",
] as const

export type Permission = (typeof PERMISSIONS)[number]

/** The serialisable subset of the session used to decide what to show. */
export type AccessContext = {
  permissions: readonly string[]
  isHod: boolean
  hasSubordinates: boolean
}

export function hasPerm(ctx: AccessContext, ...anyOf: Permission[]) {
  return anyOf.some((p) => ctx.permissions.includes(p))
}

/** Mirrors can_create_documents() in the database. */
export function canCreateDocuments(ctx: AccessContext & { department: { id: string } }, departmentId: string) {
  return (
    hasPerm(ctx, "document.create.any_dept") || (hasPerm(ctx, "document.create.own_dept") && ctx.department.id === departmentId)
  )
}

/** Mirrors can_manage_folders() in the database. */
export function canManageFolders(ctx: AccessContext & { department: { id: string } }, departmentId: string) {
  return hasPerm(ctx, "folder.create.any_dept") || (hasPerm(ctx, "folder.create.own_dept") && ctx.department.id === departmentId)
}

/** Mirrors can_manage_folder_access() in the database. */
export function canManageFolderAccess(ctx: AccessContext & { department: { id: string } }, departmentId: string) {
  return hasPerm(ctx, "folder.share.any_dept") || (hasPerm(ctx, "folder.share.own_dept") && ctx.department.id === departmentId)
}

/** Mirrors can_view_students() in the database. */
export function canViewStudents(ctx: AccessContext & { department: { id: string } }, departmentId: string) {
  return (
    hasPerm(ctx, "student.view.all", "student.manage.any_dept", "certificate.manage.any_dept") ||
    (hasPerm(ctx, "student.view.own_dept", "student.manage.own_dept", "certificate.manage.own_dept") && ctx.department.id === departmentId)
  )
}

/** Mirrors can_manage_students() in the database. */
export function canManageStudents(ctx: AccessContext & { department: { id: string } }, departmentId: string) {
  return hasPerm(ctx, "student.manage.any_dept") || (hasPerm(ctx, "student.manage.own_dept") && ctx.department.id === departmentId)
}

/** Mirrors can_manage_certificates() in the database. */
export function canManageCertificates(ctx: AccessContext & { department: { id: string } }, departmentId: string) {
  return hasPerm(ctx, "certificate.manage.any_dept") || (hasPerm(ctx, "certificate.manage.own_dept") && ctx.department.id === departmentId)
}

/** Any student-related access at all (for the Students menu). */
export function seesStudents(ctx: AccessContext) {
  return hasPerm(
    ctx,
    "student.view.own_dept",
    "student.view.all",
    "student.manage.own_dept",
    "student.manage.any_dept",
    "certificate.manage.own_dept",
    "certificate.manage.any_dept"
  )
}

/** Mirrors can_assign_kpis() in the database. */
export function canAssignKpis(ctx: AccessContext & { department: { id: string } }, departmentId: string) {
  return hasPerm(ctx, "kpi.assign.any_dept") || (hasPerm(ctx, "kpi.assign.own_dept") && ctx.department.id === departmentId)
}

/** KPI library, assignment and overview pages. */
export function seesKpiAdmin(ctx: AccessContext) {
  return hasPerm(ctx, "kpi.manage", "kpi.assign.own_dept", "kpi.assign.any_dept", "kpi.view_all")
}
