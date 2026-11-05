"use client"

import { useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/option-select"
import { STUDENT_STATUS_LABELS } from "@/lib/students"

const ALL = "__all__"
const FILTER_KEYS = ["q", "dept", "course", "batch", "status"]

type Props = { departments: Option[] | null; courses: string[]; batches: string[] }

/** Search and filters, kept in the URL. */
export function StudentsToolbar({ departments, courses, batches }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [q, setQ] = useState(params.get("q") ?? "")

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    next.delete("page")
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`))
  }
  const select = (key: string, options: Option[], all: string, className = "w-full sm:w-48") => (
    <OptionSelect
      className={className}
      options={[{ value: ALL, label: all }, ...options]}
      value={params.get(key) ?? ALL}
      onChange={(v) => update({ [key]: v === ALL ? null : v })}
    />
  )
  const active = FILTER_KEYS.some((k) => params.has(k))

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        className="relative w-full sm:w-72"
        onSubmit={(e) => {
          e.preventDefault()
          update({ q: q.trim() || null })
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => q.trim() !== (params.get("q") ?? "") && update({ q: q.trim() || null })}
          placeholder="Name, Regd No., INDoS or roll no."
          className="pl-8"
          aria-label="Search students"
        />
      </form>
      {departments && select("dept", departments, "All departments")}
      {courses.length > 0 && select("course", courses.map((c) => ({ value: c, label: c })), "All courses", "w-full sm:w-56")}
      {batches.length > 0 && select("batch", batches.map((b) => ({ value: b, label: b })), "All batches", "w-full sm:w-36")}
      {select(
        "status",
        Object.entries(STUDENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        "Any status",
        "w-full sm:w-40"
      )}
      {active && (
        <Button
          variant="ghost"
          onClick={() => {
            setQ("")
            startTransition(() => router.replace(pathname))
          }}
        >
          <X /> Clear
        </Button>
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  )
}
