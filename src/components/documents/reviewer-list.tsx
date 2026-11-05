"use client"

import { useMemo } from "react"
import { ArrowDown, ArrowUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"

type Props = {
  id: string
  /** Everyone who could be chosen; those already listed are left out of the picker. */
  people: PersonItem[]
  reviewerIds: string[]
  onChange: (ids: string[]) => void
  /** Reviewers are shown, but can't be changed. */
  locked?: boolean
}

/** An ordered list of reviewers: add, remove and change the order. */
export function ReviewerList({ id, people, reviewerIds, onChange, locked }: Props) {
  const byId = useMemo(() => new Map(people.map((p) => [p.value, p])), [people])
  const candidates = people.filter((p) => !reviewerIds.includes(p.value))

  const move = (index: number, delta: number) => {
    const next = [...reviewerIds]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item!)
    onChange(next)
  }

  return (
    <>
      {reviewerIds.length > 0 && (
        <ol className="grid gap-1.5">
          {reviewerIds.map((reviewer, i) => {
            const person = byId.get(reviewer)
            return (
              <li key={reviewer} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{person?.label ?? "Unknown user"}</span>
                  {person?.hint && <span className="block truncate text-xs text-muted-foreground">{person.hint}</span>}
                </span>
                {!locked && (
                  <span className="flex gap-0.5">
                    <Button type="button" variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={i === reviewerIds.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onChange(reviewerIds.filter((r) => r !== reviewer))}
                      aria-label="Remove reviewer"
                    >
                      <X />
                    </Button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {!locked && (
        <PersonCombobox
          id={id}
          people={candidates}
          value={null}
          onChange={(v) => v && onChange([...reviewerIds, v])}
          placeholder={reviewerIds.length ? "Add another reviewer…" : "Add the first reviewer…"}
        />
      )}
    </>
  )
}
