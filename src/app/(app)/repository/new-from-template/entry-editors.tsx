"use client"

import { useState } from "react"
import { ClipboardPaste, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import { datesInside, emptyEntry, inheritedDatesHint, slotsOf, type Bundle, type EntryValue, type ParentDates } from "@/lib/instance-entry"

type SlotEditorProps = {
  bundle: Bundle
  slot: { id: string; name: string; slotTemplateId: string; ownerLabel: string | null; entryDates: boolean }
  entries: EntryValue[]
  onChange: (entries: EntryValue[]) => void
  people: PersonItem[]
  /** What this slot's entries fall back on when their dates are left blank. */
  parent: ParentDates
  level?: number
}

/** Rows for one slot (e.g. Subjects): name + owner per entry, nested slots below, and paste-a-list. */
export function SlotEditor({ bundle, slot, entries, onChange, people, parent, level = 0 }: SlotEditorProps) {
  const datesOptional = parent.isEntry
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState("")
  const child = bundle.templates[slot.slotTemplateId]
  const childSlots = slotsOf(bundle, slot.slotTemplateId)
  const entryLabel = child?.instanceLabel ?? "Name"

  const set = (i: number, entry: EntryValue) => onChange(entries.map((e, j) => (j === i ? entry : e)))

  /** One entry per line: "Name", or "Name, Owner name" (tab also works when pasting from Excel). */
  const importPasted = () => {
    const byName = new Map(people.map((p) => [p.label.toLowerCase(), p.value]))
    const rows = pasted
      .split(/\r?\n/)
      .map((l) => l.split(/\t|,/).map((x) => x.trim()))
      .filter((cols) => cols[0])
    onChange([
      ...entries.filter((e) => e.name.trim()),
      ...rows.map(([name, owner]) => ({ ...emptyEntry(name), ownerId: owner ? (byName.get(owner.toLowerCase()) ?? null) : null })),
    ])
    setPasted("")
    setPasting(false)
  }

  return (
    <div className={level ? "mt-2 ml-4 border-l pl-3" : ""}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{slot.name}</div>
          <div className="text-xs text-muted-foreground">
            Each entry gets its own folder built from the “{child?.name ?? "?"}” template.
            {slot.entryDates && !datesOptional && " Enter each one’s start and end date."}
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setPasting((v) => !v)}>
            <ClipboardPaste /> Paste list
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...entries, emptyEntry()])}>
            <Plus /> Add {entryLabel.toLowerCase()}
          </Button>
        </div>
      </div>

      {pasting && (
        <div className="mb-3 grid gap-2 rounded-lg border bg-muted/30 p-3">
          <Textarea
            rows={4}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={`One per line, e.g.\nNavigation, ${people[0]?.label ?? "Teacher name"}\nSeamanship`}
          />
          <p className="text-xs text-muted-foreground">
            Paste from Excel or type one per line. Add the {slot.ownerLabel?.toLowerCase() ?? "owner"}&apos;s name after a
            comma or tab to set them too.
          </p>
          <Button type="button" size="sm" className="justify-self-start" onClick={importPasted} disabled={!pasted.trim()}>
            Add these
          </Button>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          None yet — you can also add them later from the folder.
        </p>
      ) : (
        <ol className="grid gap-2">
          {entries.map((e, i) => (
            <li key={i} className="rounded-lg border p-2">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                <Input
                  value={e.name}
                  onChange={(ev) => set(i, { ...e, name: ev.target.value })}
                  placeholder={entryLabel}
                  aria-label={`${entryLabel} ${i + 1}`}
                  aria-invalid={!e.name.trim() || undefined}
                />
                {slot.ownerLabel ? (
                  <PersonCombobox
                    people={people}
                    value={e.ownerId}
                    onChange={(v) => set(i, { ...e, ownerId: v })}
                    placeholder={slot.ownerLabel}
                  />
                ) : (
                  <span />
                )}
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => onChange(entries.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </div>
              {slot.entryDates && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    {datesOptional ? "Start date (optional)" : "Start date"}
                    <Input
                      type="date"
                      value={e.startDate}
                      onChange={(ev) => set(i, { ...e, startDate: ev.target.value })}
                      aria-invalid={(!datesOptional && !e.startDate) || undefined}
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    {datesOptional ? "End date (optional)" : "End date"}
                    <Input
                      type="date"
                      value={e.endDate}
                      min={e.startDate || undefined}
                      onChange={(ev) => set(i, { ...e, endDate: ev.target.value })}
                      aria-invalid={(!datesOptional && !e.endDate) || (e.startDate && e.endDate && e.endDate < e.startDate) || undefined}
                    />
                  </label>
                  {datesOptional && <p className="text-xs text-muted-foreground sm:col-span-2">{inheritedDatesHint(parent)}</p>}
                </div>
              )}
              {childSlots.map(({ node }) => (
                <SlotEditor
                  key={node.id}
                  bundle={bundle}
                  slot={{ id: node.id, name: node.name, slotTemplateId: node.slotTemplateId!, ownerLabel: node.slotOwnerLabel, entryDates: node.slotEntryDates }}
                  entries={e.slots[node.id] ?? []}
                  onChange={(list) => set(i, { ...e, slots: { ...e.slots, [node.id]: list } })}
                  people={people}
                  parent={datesInside(e, parent, entryLabel)}
                  level={level + 1}
                />
              ))}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
