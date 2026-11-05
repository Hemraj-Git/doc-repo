"use client"

import { useMemo } from "react"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"

export type PersonItem = { value: string; label: string; hint?: string | null }

type Props = {
  id?: string
  people: PersonItem[]
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  emptyText?: string
  "aria-describedby"?: string
}

/** Searchable single-person picker. */
export function PersonCombobox({
  id,
  people,
  value,
  onChange,
  placeholder = "Search by name…",
  disabled,
  invalid,
  emptyText = "No matching people",
  ...aria
}: Props) {
  const selected = useMemo(() => people.find((p) => p.value === value) ?? null, [people, value])

  return (
    <Combobox<PersonItem>
      items={people}
      value={selected}
      onValueChange={(item) => onChange(item?.value ?? null)}
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        className="w-full"
        showClear={Boolean(selected) && !disabled}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={aria["aria-describedby"]}
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(item: PersonItem) => (
            <ComboboxItem key={item.value} value={item}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{item.label}</span>
                {item.hint && <span className="truncate text-xs text-muted-foreground">{item.hint}</span>}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
