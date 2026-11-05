"use client"

import { useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { OptionSelect, type Option } from "@/components/option-select"

export function DepartmentSwitcher({ options, value }: { options: Option[]; value: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex items-center gap-2">
      <OptionSelect
        className="w-64"
        options={options}
        value={value}
        onChange={(v) => v && startTransition(() => router.replace(`${pathname}?dept=${v}`))}
      />
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  )
}
