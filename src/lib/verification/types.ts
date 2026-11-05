// Client-safe shapes of what the public portal shows (stored as the request's snapshot).
import type { CertificateStatus, StudentStatus } from "@/lib/students"

export type PublicCertificate = {
  type: string
  certificate_no: string
  issue_date: string
  academic_year: string | null
  semester: number | null
  result: string | null
  status: CertificateStatus
  status_changed_at: string | null
  replaced_by: string | null
  highlight?: boolean
}

export type PublicStudent = {
  full_name: string
  regd_no: string
  course: string
  batch: string
  status: StudentStatus
  completion_date: string | null
  department: string
}

export type PublicInstituteSnapshot = { name: string; address: string | null; contact_email: string | null }

export type VerificationSnapshot = {
  student: PublicStudent
  certificates: PublicCertificate[]
  institute: PublicInstituteSnapshot
  certificate_query: string | null
  certificate_found: boolean
}

export type VerificationResult =
  | { outcome: "matched"; code: string; slipToken: string; createdAt: string; snapshot: VerificationSnapshot }
  | { outcome: "not_matched" | "rate_limited" | "captcha_failed"; code: string; createdAt: string }

export type Slip = {
  code: string
  created_at: string
  requester_name: string
  requester_org: string
  requester_email: string
  purpose: string | null
  input_regd_no: string
  input_name: string
  slip_token: string
  snapshot: VerificationSnapshot
}

export type CertificateCheck = {
  outcome: "matched" | "not_matched" | "rate_limited"
  code: string
  createdAt: string
  snapshot: { certificate: PublicCertificate; student: PublicStudent; institute: PublicInstituteSnapshot } | null
}
