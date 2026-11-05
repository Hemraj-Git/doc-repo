"use client"

import { useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Download, Loader2, Search, X } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/option-select"
import { VERIFICATION_OUTCOME_LABELS } from "@/lib/students"

const ALL = "__all__"
const FILTER_KEYS = ["q", "outcome", "from", "to"]

export function VerificationsToolbar() {
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
  const filtered = new URLSearchParams([...params].filter(([k]) => FILTER_KEYS.includes(k)))

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2">
      <form
        className="relative w-full sm:w-72"
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
          placeholder="ID, organisation, email or Regd No."
          className="pl-8"
          aria-label="Search verifications"
        />
      </form>
      <OptionSelect
        className="w-full sm:w-44"
        options={[{ value: ALL, label: "Any outcome" }, ...Object.entries(VERIFICATION_OUTCOME_LABELS).map(([value, label]) => ({ value, label }))]}
        value={params.get("outcome") ?? ALL}
        onChange={(v) => update("outcome", v === ALL ? null : v)}
      />
      <label className="grid gap-0.5 text-xs text-muted-foreground">
        From
        <Input type="date" className="w-40" value={params.get("from") ?? ""} onChange={(e) => update("from", e.target.value || null)} />
      </label>
      <label className="grid gap-0.5 text-xs text-muted-foreground">
        To
        <Input type="date" className="w-40" value={params.get("to") ?? ""} onChange={(e) => update("to", e.target.value || null)} />
      </label>
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
      {pending && <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" />}
      <a href={`/admin/verifications/export?${filtered}`} className={buttonVariants({ variant: "outline", className: "sm:ml-auto" })}>
        <Download /> Export CSV
      </a>
    </div>
  )
}
