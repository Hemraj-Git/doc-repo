// Client-safe student and certificate constants.

export type StudentStatus = "enrolled" | "completed" | "discontinued" | "transferred"
export type CertificateStatus = "issued" | "revoked" | "replaced"
export type Gender = "male" | "female" | "other"

export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  enrolled: "Enrolled",
  completed: "Completed",
  discontinued: "Discontinued",
  transferred: "Transferred",
}

export const STUDENT_STATUS_STYLES: Record<StudentStatus, string> = {
  enrolled: "border-info-line bg-info-soft text-info-text",
  completed: "border-success-line bg-success-soft text-success-text",
  discontinued: "border-border bg-muted text-muted-foreground",
  transferred: "border-warning-line bg-warning-soft text-warning-text",
}

export const GENDER_LABELS: Record<Gender, string> = { male: "Male", female: "Female", other: "Other" }

/** Shown publicly as "Valid" for issued certificates. */
export const CERTIFICATE_STATUS_LABELS: Record<CertificateStatus, string> = {
  issued: "Valid",
  revoked: "Revoked",
  replaced: "Replaced",
}

export const CERTIFICATE_STATUS_STYLES: Record<CertificateStatus, string> = {
  issued: "border-success-line bg-success-soft text-success-text",
  revoked: "border-danger-line bg-danger-soft text-danger-text",
  replaced: "border-warning-line bg-warning-soft text-warning-text",
}

export const VERIFICATION_PURPOSES = ["Background verification", "Employment", "Admission", "Other"] as const

export const VERIFICATION_OUTCOME_LABELS: Record<string, string> = {
  matched: "Matched",
  not_matched: "No match",
  rate_limited: "Rate limited",
  captcha_failed: "CAPTCHA failed",
}

/** Certificates accept PDFs and images only. */
export const CERTIFICATE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp"
export const MAX_CERTIFICATE_BYTES = 20 * 1024 * 1024
