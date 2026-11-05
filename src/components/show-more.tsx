import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"

/** Lists start with this many rows; each "Show more" adds another page. */
export const PAGE_SIZE = 50
const MAX_ROWS = 1000

/** Reads a "show N rows" search param, clamped to whole pages. */
export function shownRows(value: string | string[] | undefined) {
  const n = Number(Array.isArray(value) ? value[0] : value)
  return Number.isInteger(n) && n > PAGE_SIZE ? Math.min(Math.ceil(n / PAGE_SIZE) * PAGE_SIZE, MAX_ROWS) : PAGE_SIZE
}

/**
 * Links to the same page showing one more page of rows. `params` are the other
 * search params to keep (e.g. the other list's length on the Requirements page).
 */
export function ShowMore({
  shown,
  param = "show",
  params = {},
}: {
  shown: number
  param?: string
  params?: Record<string, number | undefined>
}) {
  if (shown >= MAX_ROWS) {
    return <p className="text-center text-xs text-muted-foreground">Showing the first {MAX_ROWS}. Use Search to find older documents.</p>
  }
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...params, [param]: shown + PAGE_SIZE })) if (v && v > PAGE_SIZE) qs.set(k, String(v))
  return (
    <div className="flex justify-center">
      <Link href={`?${qs}`} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <ChevronDown /> Show more
      </Link>
    </div>
  )
}
