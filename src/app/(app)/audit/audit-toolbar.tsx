"use client"

import { useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Download, Loader2, X } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OptionSelect, type Option } from "@/components/option-select"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import { AUDIT_CATEGORIES } from "@/lib/audit"

const ALL = "__all__"
const FILTER_KEYS = ["dept", "category", "actor", "from", "to"]

type Props = { departments: Option[] | null; people: PersonItem[] }

/** Filters live in the URL so a filtered view can be shared, reloaded and exported. */
export function AuditToolbar({ departments, people }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    next.delete("before") // filters restart from the newest entry
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() => router.replace(`${pathname}?${next}`))
  }

  const filtered = new URLSearchParams([...params].filter(([k]) => FILTER_KEYS.includes(k)))
  const active = [...filtered.keys()].length > 0

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2">
      {departments && (
        <OptionSelect
          className="w-full sm:w-48"
          options={[{ value: ALL, label: "All departments" }, ...departments]}
          value={params.get("dept") ?? ALL}
          onChange={(v) => update("dept", v === ALL ? null : v)}
        />
      )}
      <OptionSelect
        className="w-full sm:w-52"
        options={[
          { value: ALL, label: "All activity" },
          ...Object.entries(AUDIT_CATEGORIES).map(([value, c]) => ({ value, label: c.label })),
        ]}
        value={params.get("category") ?? ALL}
        onChange={(v) => update("category", v === ALL ? null : v)}
      />
      <div className="w-full sm:w-56">
        <PersonCombobox
          people={people}
          value={params.get("actor")}
          onChange={(v) => update("actor", v)}
          placeholder="Anyone"
        />
      </div>
      <label className="grid gap-0.5 text-xs text-muted-foreground">
        From
        <Input type="date" className="w-40" value={params.get("from") ?? ""} onChange={(e) => update("from", e.target.value || null)} />
      </label>
      <label className="grid gap-0.5 text-xs text-muted-foreground">
        To
        <Input type="date" className="w-40" value={params.get("to") ?? ""} onChange={(e) => update("to", e.target.value || null)} />
      </label>
      {active && (
        <Button variant="ghost" onClick={() => startTransition(() => router.replace(pathname))}>
          <X /> Clear
        </Button>
      )}
      {pending && <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" />}
      <a href={`/audit/export?${filtered}`} className={buttonVariants({ variant: "outline", className: "sm:ml-auto" })}>
        <Download /> Export CSV
      </a>
    </div>
  )
}
