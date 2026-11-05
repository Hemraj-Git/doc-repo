// Client-safe: turns raw audit rows into readable sentences and links.
import { PERMISSIONS } from "@/lib/auth/permissions"
import { STATUS_LABELS, type DocumentStatus } from "@/lib/documents"

export type AuditEntry = {
  id: number
  action: string
  entityType: string
  entityId: string | null
  departmentId: string | null
  createdAt: string
  actorId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  meta: Record<string, unknown> | null
}

/** Names for the ids that appear in audit rows. Missing names fall back to generic wording. */
export type AuditLookups = {
  people: Record<string, string>
  roles: Record<string, string>
  documents: Record<string, string>
  departments: Record<string, { name: string; code: string }>
}

export const AUDIT_CATEGORIES = {
  documents: { label: "Documents", entityTypes: ["document", "document_version", "document_review", "document_reviewer"] },
  repository: { label: "Folders & document types", entityTypes: ["folder", "folder_permission", "document_type"] },
  templates: { label: "Templates", entityTypes: ["template", "template_node", "template_instance", "recurring_series"] },
  students: { label: "Students & certificates", entityTypes: ["student", "certificate", "certificate_type"] },
  kpis: { label: "KPIs", entityTypes: ["kpi", "kpi_area", "kpi_item", "kpi_assignment", "kpi_score"] },
  people: { label: "Users, roles & groups", entityTypes: ["user", "user_role", "role", "role_permission", "user_group", "user_group_member"] },
  organisation: { label: "Departments & settings", entityTypes: ["department", "institute_settings"] },
  auth: { label: "Sign-ins", entityTypes: ["auth"] },
} as const
export type AuditCategory = keyof typeof AUDIT_CATEGORIES

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v))
const changed = (b: Record<string, unknown>, a: Record<string, unknown>, k: string) => JSON.stringify(b[k]) !== JSON.stringify(a[k])
const quote = (s: string) => (s ? `“${s}”` : "")

function fieldList(b: Record<string, unknown>, a: Record<string, unknown>, labels: Record<string, string>) {
  return Object.keys(labels).filter((k) => changed(b, a, k)).map((k) => labels[k])
}

export type AuditDescription = { text: string; href?: string }

type Options = {
  /** On a document's own page the document name is implied, so leave it out. */
  withSubject?: boolean
}

export function describeAudit(e: AuditEntry, l: AuditLookups, { withSubject = true }: Options = {}): AuditDescription | null {
  const b = e.before ?? {}
  const a = e.after ?? {}
  const row = Object.keys(a).length ? a : b
  const person = (id: unknown) => l.people[str(id)] ?? "a user"
  const role = (id: unknown) => l.roles[str(id)] ?? "a role"
  const dept = (id: unknown) => l.departments[str(id)]?.name ?? "a department"

  switch (e.entityType) {
    case "auth":
      return { text: e.action === "login" ? "Signed in" : e.action === "logout" ? "Signed out" : "Changed their password" }

    case "department": {
      const name = str(row.name)
      const href = "/admin/departments"
      if (e.action === "insert") return { text: `Created department ${quote(name)}`, href }
      if (e.action === "delete") return { text: `Deleted department ${quote(name)}`, href }
      const parts: string[] = []
      if (changed(b, a, "head_user_id")) parts.push(a.head_user_id ? `set the head to ${person(a.head_user_id)}` : "removed the head")
      if (changed(b, a, "is_active")) parts.push(a.is_active ? "reactivated it" : "deactivated it")
      const fields = fieldList(b, a, { name: "name", code: "code", description: "description" })
      if (fields.length) parts.push(`changed its ${fields.join(", ")}`)
      return parts.length ? { text: `Department ${quote(name)}: ${parts.join("; ")}`, href } : null
    }

    case "user": {
      const name = str(row.full_name) || person(e.entityId)
      const href = `/admin/users?q=${encodeURIComponent(name)}&status=all`
      switch (e.action) {
        case "insert":
          return { text: `Added user ${name} to ${dept(row.department_id)}`, href }
        case "account_created":
          return null // shown by the insert above
        case "password_reset":
          return { text: `Reset the password of ${name}`, href }
        case "account_disabled":
          return { text: `Blocked sign-in for ${name}`, href }
        case "account_enabled":
          return { text: `Restored sign-in for ${name}`, href }
        case "work_handed_over": {
          const m = e.meta ?? {}
          const n = (k: string) => Number(m[k] ?? 0)
          const parts = [
            n("uploads") && `${n("uploads")} upload${n("uploads") === 1 ? "" : "s"}`,
            n("reviews") && `${n("reviews")} review${n("reviews") === 1 ? "" : "s"}`,
            n("series") && `${n("series")} recurring series`,
            n("reports") && `${n("reports")} direct report${n("reports") === 1 ? "" : "s"}`,
          ].filter(Boolean)
          return { text: `Handed over ${name}'s work to ${person(m.to_user_id)}${parts.length ? ` (${parts.join(", ")})` : ""}`, href }
        }
        case "update": {
          const parts: string[] = []
          if (changed(b, a, "is_active")) parts.push(a.is_active ? "reactivated" : "deactivated")
          if (changed(b, a, "department_id")) parts.push(`moved to ${dept(a.department_id)}`)
          if (changed(b, a, "reports_to_id")) parts.push(a.reports_to_id ? `now reports to ${person(a.reports_to_id)}` : "no longer has a manager")
          if (changed(b, a, "must_change_password") && a.must_change_password === false) parts.push("set their own password")
          const fields = fieldList(b, a, { full_name: "name", email: "email", designation: "designation", employee_code: "employee code", phone: "phone" })
          if (fields.length) parts.push(`${fields.join(", ")} changed`)
          return parts.length ? { text: `${name}: ${parts.join("; ")}`, href } : null
        }
        default:
          return null
      }
    }

    case "role": {
      const name = str(row.name)
      const href = "/admin/roles"
      if (e.action === "insert") return { text: `Created role ${quote(name)}`, href }
      if (e.action === "delete") return { text: `Deleted role ${quote(name)}`, href }
      return { text: `Updated role ${quote(name)}`, href }
    }

    case "role_permission": {
      const key = str(row.permission_key)
      const known = (PERMISSIONS as readonly string[]).includes(key) ? key : key || "a permission"
      return {
        text: e.action === "insert" ? `Granted ${known} to ${role(row.role_id)}` : `Removed ${known} from ${role(row.role_id)}`,
        href: "/admin/roles",
      }
    }

    case "user_role":
      // Employee is granted with every new user, and Department Head follows the
      // department's head — both are already described by those events.
      if (role(row.role_id) === "Employee" || role(row.role_id) === "Department Head") return null
      return {
        text:
          e.action === "insert"
            ? `Gave ${person(row.user_id)} the ${role(row.role_id)} role`
            : `Removed the ${role(row.role_id)} role from ${person(row.user_id)}`,
        href: `/admin/users?q=${encodeURIComponent(person(row.user_id))}&status=all`,
      }

    case "folder": {
      const name = str(row.name)
      const ref = str(row.reference_id)
      const d = l.departments[str(row.department_id)]
      const href = d && e.action !== "delete" ? `/repository/${d.code}${row.level === "root" ? "" : `/${str(row.id ?? e.entityId)}`}` : undefined
      const label = `${row.level === "sub" ? "sub-folder" : "folder"} ${quote(name)}${ref ? ` (${ref})` : ""}`
      if (row.level === "root" && e.action === "insert") return null // created with its department
      if (e.action === "insert") return { text: `Created ${label}`, href }
      if (e.action === "delete") return { text: `Deleted ${label}` }
      const fields = fieldList(b, a, { name: "name", reference_id: "Reference ID", description: "description", allow_subfolders: "sub-folder setting" })
      return fields.length ? { text: `Updated ${label}: ${fields.join(", ")}`, href } : null
    }

    case "folder_permission": {
      const m = e.meta ?? {}
      const folder = quote(str(m.folder)) || "a folder"
      const who = str(m.grantee) || "someone"
      const level = (v: unknown) => (v === "write" ? "Upload" : "View")
      if (e.action === "insert") return { text: `Gave ${who} ${level(a.access)} access to ${folder}` }
      if (e.action === "delete") return { text: `Removed the access of ${who} to ${folder}` }
      return changed(b, a, "access") ? { text: `Changed the access of ${who} to ${folder} to ${level(a.access)}` } : null
    }

    case "user_group": {
      const name = quote(str(row.name))
      const href = "/admin/groups"
      if (e.action === "insert") return { text: `Created group ${name}`, href }
      if (e.action === "delete") return { text: `Deleted group ${name}`, href }
      return { text: `Updated group ${name}`, href }
    }

    case "user_group_member": {
      const group = quote(str(e.meta?.group)) || "a group"
      return {
        text: e.action === "insert" ? `Added ${person(row.user_id)} to ${group}` : `Removed ${person(row.user_id)} from ${group}`,
        href: "/admin/groups",
      }
    }

    case "institute_settings": {
      const fields = fieldList(b, a, {
        institute_name: "institute name",
        address: "address",
        contact_email: "contact email",
        academic_year_start_month: "academic year start month",
        logo_path: "logo",
      })
      return fields.length ? { text: `Changed institute settings: ${fields.join(", ")}`, href: "/admin/settings" } : null
    }

    case "template": {
      const name = str(row.name)
      const href = e.action === "delete" ? undefined : `/admin/templates/${str(row.id ?? e.entityId)}`
      if (e.action === "insert") return { text: `Created template ${quote(name)}`, href }
      if (e.action === "delete") return { text: `Deleted template ${quote(name)}` }
      // Version bumps from node edits are described by the node rows themselves.
      const fields = fieldList(b, a, {
        name: "name",
        description: "description",
        instance_label: "instance label",
        department_ids: "departments",
        allow_extra_folders: "extra-folder setting",
        is_active: "status",
      })
      return fields.length ? { text: `Updated template ${quote(name)}: ${fields.join(", ")}`, href } : null
    }

    case "template_node": {
      const kind = row.kind === "slot" ? "slot" : row.kind === "folder" ? "folder" : "document item"
      const href = `/admin/templates/${str(e.entityId)}`
      if (e.action === "insert") return { text: `Added ${kind} ${quote(str(row.name))} to a template`, href }
      if (e.action === "delete") return { text: `Removed ${kind} ${quote(str(row.name))} from a template`, href }
      return changed(b, a, "sort_order") && Object.keys(a).filter((k) => changed(b, a, k)).length === 1
        ? null
        : { text: `Edited template ${kind} ${quote(str(row.name))}`, href }
    }

    case "template_instance": {
      const name = str(row.name)
      const d = l.departments[str(e.departmentId)]
      const href = d ? `/repository/${d.code}/${str(row.root_folder_id)}` : undefined
      if (e.action === "insert") return { text: `Created ${quote(name)} from template ${quote(str(row.template_name))}`, href }
      if (changed(b, a, "status")) return { text: `${a.status === "closed" ? "Closed" : "Reopened"} ${quote(name)}`, href }
      return null
    }

    case "recurring_series": {
      const name = str(row.name)
      if (e.action === "insert") return { text: `Set up recurring file ${quote(name)} (${str(row.recurrence).replace("_", " ")})` }
      const parts: string[] = []
      if (changed(b, a, "uploader_id")) parts.push(`uploader now ${person(a.uploader_id)}`)
      if (changed(b, a, "is_paused")) parts.push(a.is_paused ? "paused" : "resumed")
      if (changed(b, a, "end_date")) parts.push(a.end_date ? `ends ${str(a.end_date)}` : "no end date")
      return parts.length ? { text: `Recurring file ${quote(name)}: ${parts.join("; ")}` } : null
    }

    case "document_type": {
      const code = str(row.code)
      const href = "/admin/document-types"
      if (e.action === "insert") return { text: `Added document type ${code}`, href }
      if (changed(b, a, "is_active")) return { text: `${a.is_active ? "Reactivated" : "Deactivated"} document type ${code}`, href }
      return { text: `Updated document type ${code}`, href }
    }

    case "student": {
      const name = str(row.full_name)
      const href = e.entityId ? `/students/${e.entityId}` : undefined
      if (e.action === "view") return { text: `Viewed the profile of ${quote(name)}`, href }
      if (e.action === "certificate_view") return { text: `Opened a certificate of ${quote(name)}`, href }
      if (e.action === "certificate_download") return { text: `Downloaded a certificate of ${quote(name)}`, href }
      if (e.action === "insert") return { text: `Added student ${quote(name)} (${str(row.regd_no)})`, href }
      const fields = fieldList(b, a, {
        full_name: "name",
        regd_no: "Regd No.",
        course_name: "course",
        batch: "batch",
        status: "status",
        completion_date: "completion date",
        final_result: "final result",
        department_id: "department",
        indos_no: "INDoS No.",
        cdc_no: "CDC No.",
        passport_no: "passport",
        email: "email",
        mobile: "mobile",
        address: "address",
        program_folder_id: "program folder",
      })
      return fields.length ? { text: `Updated ${fields.join(", ")} of ${quote(name)}`, href } : null
    }

    case "certificate": {
      const no = str(row.certificate_no)
      const href = row.student_id ? `/students/${str(row.student_id)}` : undefined
      if (e.action === "insert") return { text: `Issued certificate ${no}`, href }
      if (changed(b, a, "status")) {
        const why = a.status_reason ? ` — ${str(a.status_reason)}` : ""
        return { text: `${a.status === "replaced" ? "Marked certificate replaced" : "Revoked certificate"} ${no}${why}`, href }
      }
      if (changed(b, a, "current_file_id") && b.current_file_id) return { text: `Replaced the file of certificate ${no}`, href }
      return null
    }

    case "kpi": {
      const name = str(row.name)
      const href = e.entityId ? `/kpis/${e.entityId}` : undefined
      if (e.action === "insert") return { text: `Created KPI ${quote(name)}`, href }
      if (e.action === "delete") return { text: `Deleted KPI ${quote(name)}` }
      if (changed(b, a, "is_active")) return { text: `${a.is_active ? "Activated" : "Deactivated"} KPI ${quote(name)}`, href }
      const fields = fieldList(b, a, { name: "name", designation: "designation", description: "description", year_start_month: "year start" })
      return fields.length ? { text: `Updated ${fields.join(", ")} of KPI ${quote(name)}`, href } : null
    }

    case "kpi_area":
    case "kpi_item": {
      const what = e.entityType === "kpi_area" ? "area" : "evidence item"
      const name = str(row.name)
      const href = row.kpi_id ? `/kpis/${str(row.kpi_id)}` : undefined
      const weight = e.entityType === "kpi_area" ? ` (${str(row.weightage)}%)` : ""
      if (e.action === "insert") return { text: `Added KPI ${what} ${quote(name)}${weight}`, href }
      if (e.action === "delete") return { text: `Removed KPI ${what} ${quote(name)}`, href }
      if (e.entityType === "kpi_area" && changed(b, a, "weightage")) return { text: `Changed the weightage of ${quote(name)} to ${str(a.weightage)}%`, href }
      if (changed(b, a, "sort_order") && Object.keys(a).filter((k) => changed(b, a, k)).length === 1) return null
      return { text: `Updated KPI ${what} ${quote(name)}`, href }
    }

    case "kpi_assignment": {
      const kpi = str(row.kpi_name)
      const href = e.entityId ? `/kpis/assignments/${e.entityId}` : undefined
      const m = e.meta ?? {}
      const period = m.area ? `${quote(str(m.area))} ${str(m.period)}` : "a KPI period"
      switch (e.action) {
        case "kpi_entry_submitted":
          return { text: `Submitted ${period}`, href }
        case "kpi_entry_returned":
          return { text: `Sent back ${period}`, href }
        case "kpi_entry_approved":
          return { text: `Approved ${period} and sent it for scoring`, href }
        case "kpi_entry_forwarded":
          return { text: `Forwarded ${period} for scoring, with nothing submitted`, href }
        case "kpi_scorer_changed":
          return { text: `Changed the KPI scorer to ${person(m.to_user_id)}`, href }
        case "kpi_entry_not_applicable":
          return { text: `Marked ${period} not applicable: ${str(m.reason)}`, href }
        case "kpi_entry_reopened":
          return { text: `Reopened ${period}`, href }
        case "kpi_scores_released":
          return { text: "Released KPI scores to the person", href }
        case "kpi_scores_hidden":
          return { text: "Hid KPI scores from the person", href }
        case "kpi_reviewer_changed":
          return { text: `Changed the KPI reviewer to ${person(m.to_user_id)}`, href }
        case "kpi_file_view":
          return { text: `Viewed KPI evidence ${quote(str(m.file))}`, href }
        case "kpi_file_download":
          return { text: `Downloaded KPI evidence ${quote(str(m.file))}`, href }
      }
      if (e.action === "insert") return { text: `Assigned ${quote(kpi)} to ${person(row.user_id)} (${str(row.start_date)} – ${str(row.end_date)})`, href }
      if (changed(b, a, "status")) return { text: `${a.status === "ended" ? "Ended" : "Reopened"} ${quote(kpi)} for ${person(row.user_id)}`, href }
      if (changed(b, a, "kpi_version")) return { text: `Applied the latest changes of ${quote(kpi)} for ${person(row.user_id)}`, href }
      return null
    }

    case "kpi_score": {
      const href = e.entityId ? `/kpis/assignments/${e.entityId}` : undefined
      const m = e.meta ?? {}
      const period = `${quote(str(m.area))} ${str(m.period)}`
      switch (e.action) {
        case "kpi_entry_scored":
          return { text: `Scored ${period}: ${str(m.new_score)}`, href }
        case "kpi_score_changed":
          return { text: `Changed the score of ${period} from ${str(m.old_score)} to ${str(m.new_score)}`, href }
        case "kpi_final_score_generated":
          return { text: `Final Score generated: ${str(m.new_score)} (${str(m.rating)})`, href }
        case "kpi_final_score_changed":
          return { text: `Final Score changed from ${str(m.old_score)} (${str(m.old_rating)}) to ${str(m.new_score)} (${str(m.rating)})`, href }
        case "kpi_final_score_cleared":
          return { text: `Final Score of ${str(m.old_score)} cleared: the year is no longer complete`, href }
      }
      return null
    }

    case "certificate_type": {
      const code = str(row.code)
      const href = "/admin/certificate-types"
      if (e.action === "insert") return { text: `Added certificate type ${code}`, href }
      if (changed(b, a, "is_active")) return { text: `${a.is_active ? "Reactivated" : "Deactivated"} certificate type ${code}`, href }
      return { text: `Updated certificate type ${code}`, href }
    }

    case "document":
    case "document_version":
    case "document_review":
    case "document_reviewer": {
      const docName = l.documents[str(e.entityId)] ?? (e.entityType === "document" ? str(row.name) : "")
      const of = withSubject && docName ? ` of ${quote(docName)}` : ""
      const on = withSubject && docName ? ` on ${quote(docName)}` : ""
      const href = e.entityId ? `/documents/${e.entityId}` : undefined
      const text = describeDocumentEvent(e, b, a, { docName, of, on, withSubject })
      return text ? { text, href } : null
    }

    default:
      return null
  }
}

const DOC_FIELDS: Record<string, string> = {
  name: "name",
  document_type_id: "document type",
  reference_id: "Reference ID",
  description: "description",
  assigned_uploader_id: "uploader",
  requires_review: "review setting",
  due_date: "due date",
}

function describeDocumentEvent(
  e: AuditEntry,
  b: Record<string, unknown>,
  a: Record<string, unknown>,
  s: { docName: string; of: string; on: string; withSubject: boolean }
): string | null {
  const subject = s.withSubject && s.docName ? ` ${quote(s.docName)}` : ""
  switch (`${e.entityType}:${e.action}`) {
    case "document:insert":
      return a.is_direct ? `Uploaded the document${subject} directly to its folder` : `Created the document requirement${subject}`
    case "document:update": {
      const parts: string[] = []
      if (b.status !== a.status) {
        parts.push(`status ${STATUS_LABELS[b.status as DocumentStatus]} → ${STATUS_LABELS[a.status as DocumentStatus]}`)
      }
      const fields = fieldList(b, a, DOC_FIELDS)
      if (fields.length) parts.push(`changed ${fields.join(", ")}`)
      if (!parts.length) return null
      const text = parts.join("; ")
      return s.withSubject && s.docName ? `${quote(s.docName)}: ${text}` : text.charAt(0).toUpperCase() + text.slice(1)
    }
    case "document_version:insert":
      return `Uploaded version ${a.version_no}${s.of} (${a.original_filename})`
    case "document_review:insert":
      return a.step_order === 1 ? `Review round ${a.round} started${s.on}` : null
    case "document_review:update":
      if (a.state === "approved") return `Approved${subject} as reviewer ${a.step_order}${a.comment ? `: ${quote(str(a.comment))}` : ""}`
      if (a.state === "rejected") return `Requested changes${s.on}: ${quote(str(a.comment))}`
      if (a.state === "active" && b.state === "waiting") return `Review passed to reviewer ${a.step_order}${s.on}`
      return null
    case "document_reviewer:insert":
      return `Updated the reviewers${s.on}`
    case "document:view":
    case "document:download": {
      const v = e.meta?.version_no
      const what = v ? `version ${v}${s.of}` : s.withSubject && s.docName ? quote(s.docName) : "the document"
      return `${e.action === "view" ? "Viewed" : "Downloaded"} ${what}`
    }
    default:
      return null
  }
}
