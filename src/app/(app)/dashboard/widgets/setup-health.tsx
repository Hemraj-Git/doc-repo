import Link from "next/link"
import { CircleCheck, TriangleAlert } from "lucide-react"
import { createClient } from "@/lib/supabase/server"

type Issue = { key: string; text: string; names: string[]; href: string }

const MAX_NAMES = 4

export async function SetupHealth() {
  const supabase = await createClient()
  const [{ data: departments }, { data: topLevel }] = await Promise.all([
    supabase.from("departments").select("id, name, head_user_id").eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, full_name").is("reports_to_id", null).eq("is_active", true).order("full_name"),
  ])

  const heads = new Set((departments ?? []).map((d) => d.head_user_id).filter(Boolean))
  const headless = (departments ?? []).filter((d) => !d.head_user_id)
  // Everyone except a department head should report to someone.
  const unmanaged = (topLevel ?? []).filter((p) => !heads.has(p.id))

  const issues: Issue[] = [
    {
      key: "headless",
      text: `${headless.length} department${headless.length === 1 ? "" : "s"} without a head`,
      names: headless.map((d) => d.name),
      href: "/admin/departments",
    },
    {
      key: "unmanaged",
      text: `${unmanaged.length} user${unmanaged.length === 1 ? "" : "s"} without a reporting manager`,
      names: unmanaged.map((p) => p.full_name),
      href: "/admin/users",
    },
  ].filter((i) => i.names.length > 0)

  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleCheck className="size-4 text-success-text" /> Every department has a head and every user has a manager.
      </p>
    )
  }

  return (
    <ul className="space-y-3 text-sm">
      {issues.map((issue) => (
        <li key={issue.key} className="flex gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" />
          <div>
            <Link href={issue.href} className="font-medium hover:underline">
              {issue.text}
            </Link>
            <p className="text-xs text-muted-foreground">
              {issue.names.slice(0, MAX_NAMES).join(", ")}
              {issue.names.length > MAX_NAMES && ` +${issue.names.length - MAX_NAMES} more`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
