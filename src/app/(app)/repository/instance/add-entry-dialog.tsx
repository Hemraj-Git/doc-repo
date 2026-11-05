"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/field"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import {
  datesInside,
  emptyEntry,
  entryDateProblem,
  inheritedDatesHint,
  itemsOf,
  pastStartEntries,
  slotsOf,
  toPayload,
  updateEntryAt,
  type Bundle,
  type EntryValue,
  type ParentDates,
  type RequirementsFrom,
} from "@/lib/instance-entry"
import { UPLOADER_LABELS } from "@/lib/templates"
import { addSlotEntry } from "../template-actions"
import { SlotEditor } from "../new-from-template/entry-editors"
import { RequirementsFromQuestion } from "../new-from-template/requirements-from"

type Props = {
  instanceId: string
  slot: { id: string; name: string; slotTemplateId: string; ownerLabel: string | null; entryDates: boolean }
  bundle: Bundle
  people: PersonItem[]
  departmentCode: string
  /** The instance this entry goes into: its dates apply when the entry's are left blank. */
  parent: ParentDates
  today: string
}

/** Adds one more entry (e.g. a subject) to a slot of an existing instance. */
export function AddEntryDialog({ instanceId, slot, bundle, people, departmentCode, parent, today }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [entry, setEntry] = useState<EntryValue>(emptyEntry())
  const [requirementsFrom, setRequirementsFrom] = useState<RequirementsFrom | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const child = bundle.templates[slot.slotTemplateId]
  const label = child?.instanceLabel ?? "Name"
  const items = useMemo(() => itemsOf(bundle, slot.slotTemplateId, entry), [bundle, slot.slotTemplateId, entry])
  const entryAt = (path: [string, number][]) => path.reduce<EntryValue>((e, [s, i]) => e.slots[s]![i]!, entry)
  const personName = new Map(people.map((p) => [p.value, p.label]))
  const datesOptional = parent.isEntry
  // Slots without their own dates never start before today when adding to an existing folder.
  const startsFrom = slot.entryDates || parent.start >= today ? parent : { ...parent, start: today }
  const inside = datesInside(entry, startsFrom, label)
  const pastEntries = pastStartEntries(bundle, slot.slotTemplateId, entry, inside, today)

  const submit = () =>
    startTransition(async () => {
      setError(null)
      if (!entry.name.trim()) return setError(`Enter the ${label.toLowerCase()}.`)
      if (slot.entryDates && !datesOptional && (!entry.startDate || !entry.endDate)) return setError("Enter the start and end date.")
      if (inside.start && inside.end && inside.end < inside.start) return setError("The end date must be after the start date.")
      const nestedDates = entryDateProblem(bundle, slot.slotTemplateId, entry, inside)
      if (nestedDates) return setError(nestedDates)
      const missing = items.find((i) => i.node.uploaderRule === "chosen" && !entryAt(i.path).uploaders[i.node.id])
      if (missing) return setError(`Choose who uploads “${missing.node.name}”.`)
      if (items.some((i) => i.node.uploaderRule === "slot_owner" && !i.ownerId))
        return setError(`Choose the ${slot.ownerLabel?.toLowerCase() ?? "owner"} — some files are uploaded by them.`)

      if (pastEntries.length > 0 && !requirementsFrom) return setError("Choose where to generate requirements from.")

      const payload = { ...toPayload(entry), ...(pastEntries.length > 0 && requirementsFrom ? { requirements_from: requirementsFrom } : {}) }
      const result = await addSlotEntry(instanceId, slot.id, payload)
      if (!result.ok) return setError(result.error)
      toast.success(`“${entry.name.trim()}” added`)
      setOpen(false)
      setEntry(emptyEntry())
      setRequirementsFrom(null)
      router.push(`/repository/${departmentCode}/${result.data.folderId}`)
    })

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus /> Add to {slot.name.toLowerCase()}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add to {slot.name}</DialogTitle>
            <DialogDescription>Creates a folder from the “{child?.name}” template with all its files.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ae-name" label={label}>
                {(d) => <Input id="ae-name" autoFocus value={entry.name} onChange={(e) => setEntry({ ...entry, name: e.target.value })} aria-describedby={d} />}
              </Field>
              {slot.entryDates && (
                <>
                  <Field id="ae-start" label="Start date" optional={datesOptional}>
                    {(d) => <Input id="ae-start" type="date" value={entry.startDate} onChange={(e) => setEntry({ ...entry, startDate: e.target.value })} aria-describedby={d} />}
                  </Field>
                  <Field
                    id="ae-end"
                    label="End date"
                    optional={datesOptional}
                    hint={datesOptional ? inheritedDatesHint(parent) : "Recurring files inside run only between these dates."}
                  >
                    {(d) => (
                      <Input
                        id="ae-end"
                        type="date"
                        min={entry.startDate || undefined}
                        value={entry.endDate}
                        onChange={(e) => setEntry({ ...entry, endDate: e.target.value })}
                        aria-describedby={d}
                      />
                    )}
                  </Field>
                </>
              )}
              {slot.ownerLabel && (
                <Field id="ae-owner" label={slot.ownerLabel}>
                  {(d) => <PersonCombobox id="ae-owner" people={people} value={entry.ownerId} onChange={(v) => setEntry({ ...entry, ownerId: v })} aria-describedby={d} />}
                </Field>
              )}
            </div>

            {slotsOf(bundle, slot.slotTemplateId).map(({ node }) => (
              <SlotEditor
                key={node.id}
                bundle={bundle}
                slot={{ id: node.id, name: node.name, slotTemplateId: node.slotTemplateId!, ownerLabel: node.slotOwnerLabel, entryDates: node.slotEntryDates }}
                entries={entry.slots[node.id] ?? []}
                onChange={(list) => setEntry({ ...entry, slots: { ...entry.slots, [node.id]: list } })}
                people={people}
                parent={inside}
              />
            ))}

            {items.length > 0 && (
              <div className="grid gap-2">
                <span className="text-sm font-medium">Who uploads</span>
                {items.map((i) => (
                  <div key={i.key} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_16rem] sm:items-center">
                    <span className="min-w-0 truncate text-sm">
                      {i.node.name}
                      <span className="block truncate text-xs text-muted-foreground">{i.location}</span>
                    </span>
                    {i.node.uploaderRule === "chosen" ? (
                      <PersonCombobox
                        people={people}
                        value={entryAt(i.path).uploaders[i.node.id] ?? null}
                        onChange={(v) => setEntry(updateEntryAt(entry, i.path, (e) => ({ ...e, uploaders: { ...e.uploaders, [i.node.id]: v } })))}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {i.node.uploaderRule === "slot_owner" ? (i.ownerId ? personName.get(i.ownerId) : `The ${slot.ownerLabel?.toLowerCase() ?? "owner"}`) : UPLOADER_LABELS[i.node.uploaderRule]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {pastEntries.length > 0 && <RequirementsFromQuestion entries={pastEntries} today={today} value={requirementsFrom} onChange={setRequirementsFrom} />}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
