import { z } from "zod"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export function ok(): ActionResult
export function ok<T>(data: T): ActionResult<T>
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data }
}

export function fail(error: string, fieldErrors?: Record<string, string>): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  return { ok: false, error, fieldErrors }
}

export function invalid(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".")
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fail("Please correct the highlighted fields.", fieldErrors)
}

/** Unique constraints → the form field they belong to. */
const UNIQUE_FIELDS: Record<string, { field: string; message: string }> = {
  departments_name_key: { field: "name", message: "A department with this name already exists" },
  departments_code_key: { field: "code", message: "This code is already used by another department" },
  profiles_email_key: { field: "email", message: "A user with this email already exists" },
  profiles_employee_code_key: { field: "employeeCode", message: "This employee code is already in use" },
  roles_name_key: { field: "name", message: "A role with this name already exists" },
  reference_ids: { field: "referenceId", message: "This Reference ID is already in use" },
  folders_sibling_name_key: { field: "name", message: "A folder with this name already exists here" },
  document_types_code_key: { field: "code", message: "A document type with this code already exists" },
  user_groups_name_key: { field: "name", message: "A group with this name already exists" },
  templates_name_key: { field: "name", message: "A template with this name already exists" },
  students_regd_no_normalized_key: { field: "regdNo", message: "A student with this Regd No. already exists" },
  certificates_certificate_no_normalized_key: { field: "certificateNo", message: "A certificate with this number already exists" },
  certificate_types_code_key: { field: "code", message: "A certificate type with this code already exists" },
  certificate_types_name_key: { field: "name", message: "A certificate type with this name already exists" },
}

type DbError = { code?: string; message: string; details?: string | null }

/** Turns a Postgres / PostgREST error into a message a user can act on. */
export function fromDbError(error: DbError) {
  if (error.code === "23505") {
    const hit = Object.entries(UNIQUE_FIELDS).find(([constraint]) =>
      `${error.message} ${error.details ?? ""}`.includes(constraint)
    )
    if (hit) return fail(hit[1].message, { [hit[1].field]: hit[1].message })
    return fail("This record already exists.")
  }
  // Business-rule violations raised by our triggers carry a readable message.
  if (error.code === "23514" || error.code === "23503") return fail(error.message)
  if (error.code === "42501") {
    // Our own functions raise readable 42501s; Postgres' built-in ones are not.
    const builtIn = /row-level security|permission denied for/i.test(error.message)
    return fail(builtIn ? "You do not have permission to do this." : error.message)
  }
  console.error("Unexpected database error", error)
  return fail("Something went wrong. Please try again.")
}
