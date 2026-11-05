"use client"

import { useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Download, Loader2, Search, X } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/option-select"

const ALL = "__all__"
const FILTER_KEYS = ["kpi", "dept", "designation", "status", "q"]

export function AssignmentsToolbar({ kpis, departments, designations }: { kpis: Option[]; departments: Option[]; designations: string[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [q, setQ] = useState(params.get("q") ?? "")

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`))
  }
  const select = (key: string, options: Option[], all: string, className = "w-full sm:w-48") => (
    <OptionSelect
      className={className}
      options={[{ value: ALL, label: all }, ...options]}
      value={params.get(key) ?? ALL}
      onChange={(v) => update(key, v === ALL ? null : v)}
    />
  )
  const filtered = new URLSearchParams([...params].filter(([k]) => FILTER_KEYS.includes(k)))

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        className="relative w-full sm:w-60"
        onSubmit={(e) => {
          e.preventDefault()
          update("q", q.trim() || null)
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => q.trim() !== (params.get("q") ?? "") && update("q", q.trim() || null)}
          placeholder="Person or KPI"
          className="pl-8"
          aria-label="Search assignments"
        />
      </form>
      {select("kpi", kpis, "All KPIs")}
      {select("dept", departments, "All departments")}
      {designations.length > 0 && select("designation", designations.map((d) => ({ value: d, label: d })), "Every designation")}
      {select(
        "status",
        [
          { value: "active", label: "Active" },
          { value: "ended", label: "Ended" },
        ],
        "Any status",
        "w-full sm:w-36"
      )}
      {filtered.size > 0 && (
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
      <a href={`/kpis/assignments/export?${filtered}`} className={buttonVariants({ variant: "outline", className: "sm:ml-auto" })}>
        <Download /> Export CSV
      </a>
    </div>
  )
}
