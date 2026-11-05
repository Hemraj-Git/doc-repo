// Client-safe document constants.

export type DocumentStatus = "pending_upload" | "in_review" | "changes_requested" | "approved" | "not_applicable"
export type ReviewState = "waiting" | "active" | "approved" | "rejected" | "skipped"

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  pending_upload: "Pending upload",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  not_applicable: "Not applicable",
}

export const STATUS_STYLES: Record<DocumentStatus, string> = {
  pending_upload: "border-warning-line bg-warning-soft text-warning-text",
  in_review: "border-info-line bg-info-soft text-info-text",
  changes_requested: "border-danger-line bg-danger-soft text-danger-text",
  approved: "border-success-line bg-success-soft text-success-text",
  not_applicable: "border-border bg-muted text-muted-foreground",
}

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  waiting: "Waiting",
  active: "Reviewing now",
  approved: "Approved",
  rejected: "Changes requested",
  skipped: "Not reached",
}

/** Approved or not applicable: nothing more is expected from the uploader. */
export function isClosed(status: DocumentStatus) {
  return status === "approved" || status === "not_applicable"
}

/** Whole days between an ISO timestamp and now. */
export function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

/** Still waiting for an upload and past its due date (late uploads are still accepted). */
export function isOverdue(status: DocumentStatus, dueDate: string | null, today: string) {
  return Boolean(dueDate) && (status === "pending_upload" || status === "changes_requested") && dueDate! < today
}
