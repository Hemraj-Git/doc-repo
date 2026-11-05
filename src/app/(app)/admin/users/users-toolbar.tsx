"use client"

import { useEffect, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/option-select"

const ALL = "__all__"
const STATUS: Option[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All statuses" },
]

/** Search and filters, kept in the URL so results can be shared and survive reloads. */
export function UsersToolbar({ departments }: { departments: Option[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [q, setQ] = useState(params.get("q") ?? "")

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() => router.replace(`${pathname}?${next}`))
  }

  // Debounce typing in the search box.
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return
    const t = setTimeout(() => update("q", q.trim() || null), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, email, code, designation…"
          className="pl-8"
          aria-label="Search users"
        />
      </div>
      <OptionSelect
        className="w-full sm:w-56"
        options={[{ value: ALL, label: "All departments" }, ...departments]}
        value={params.get("dept") ?? ALL}
        onChange={(v) => update("dept", v === ALL ? null : v)}
      />
      <OptionSelect
        className="w-full sm:w-40"
        options={STATUS}
        value={params.get("status") ?? "active"}
        onChange={(v) => update("status", v === "active" ? null : v)}
      />
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  )
}
