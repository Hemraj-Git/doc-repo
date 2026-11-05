"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type Option = { value: string; label: string; disabled?: boolean }

type Props = {
  id?: string
  value: string | null
  onChange: (value: string | null) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  "aria-describedby"?: string
  "aria-label"?: string
}

/** Single-value select over {value, label} options; shows the label of the selected value. */
export function OptionSelect({ id, value, onChange, options, placeholder = "Select…", disabled, invalid, className, ...aria }: Props) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(v) => onChange((v as string | null) ?? null)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        className={cn("w-full", className)}
        aria-invalid={invalid || undefined}
        aria-describedby={aria["aria-describedby"]}
        aria-label={aria["aria-label"]}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
