import type { VerificationFilters } from "@/lib/data/students"
import { VERIFICATION_OUTCOME_LABELS } from "@/lib/students"

/** Filters from the URL, shared by the page and the CSV export. */
export function parseVerificationFilters(get: (k: string) => string | undefined): VerificationFilters {
  const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const outcome = get("outcome")
  return {
    q: get("q"),
    outcome: outcome && outcome in VERIFICATION_OUTCOME_LABELS ? outcome : undefined,
    from: date(get("from")),
    to: date(get("to")),
  }
}
