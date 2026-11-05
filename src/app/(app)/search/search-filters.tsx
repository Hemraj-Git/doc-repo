"use client"

import { useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { OptionSelect, type Option } from "@/components/option-select"
import { STATUS_LABELS } from "@/lib/documents"

const ALL = "__all__"

export function SearchFilters({ types, departments }: { types: Option[]; departments: Option[] | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value && value !== ALL) next.set(key, value)
    else next.delete(key)
    startTransition(() => router.replace(`${pathname}?${next}`))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <OptionSelect
        className="w-full sm:w-48"
        options={[{ value: ALL, label: "Any status" }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
        value={params.get("status") ?? ALL}
        onChange={(v) => update("status", v)}
      />
      <OptionSelect
        className="w-full sm:w-48"
        options={[{ value: ALL, label: "Any document type" }, ...types]}
        value={params.get("type") ?? ALL}
        onChange={(v) => update("type", v)}
      />
      {departments && (
        <OptionSelect
          className="w-full sm:w-52"
          options={[{ value: ALL, label: "All departments" }, ...departments]}
          value={params.get("dept") ?? ALL}
          onChange={(v) => update("dept", v)}
        />
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  )
}
