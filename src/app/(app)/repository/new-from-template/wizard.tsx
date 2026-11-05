"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronLeft, ChevronRight, FileText, Folder, FolderTree, LayoutTemplate, Loader2, Repeat, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/field"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import {
  emptyEntry,
  entryDateProblem,
  itemsOf,
  pastStartEntries,
  slotsOf,
  summarise,
  toPayload,
  treeOf,
  updateEntryAt,
  type Bundle,
  type EntryValue,
  type ParentDates,
  type RequirementsFrom,
} from "@/lib/instance-entry"
import { RECURRENCE_LABELS, UPLOADER_LABELS, type TemplateTreeNode } from "@/lib/templates"
import { REFERENCE_ID_HINT, REFERENCE_ID_PATTERN, refIdRule } from "@/lib/validation/repository"
import { cn } from "@/lib/utils"
import { createFromTemplate } from "../template-actions"
import { SlotEditor } from "./entry-editors"
import { RequirementsFromQuestion } from "./requirements-from"

type Props = {
  departmentCode: string
  parent: { id: string; name: string; depth: number; referenceId: string | null }
  bundle: Bundle & { available: string[] }
  people: PersonItem[]
  today: string
  /** Duplicating an existing instance: its template and entries, with a blank name. */
  initial?: { templateId: string; entry: EntryValue; sourceName: string }
}

const STEPS = ["Template", "Name & dates", "Entries", "Uploaders", "Review"] as const

export function Wizard({ departmentCode, parent, bundle, people, today, initial }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [step, setStep] = useState(initial ? 1 : 0)
  const [templateId, setTemplateId] = useState<string | null>(
    initial?.templateId ?? (bundle.available.length === 1 ? bundle.available[0]! : null)
  )
  const [entry, setEntry] = useState<EntryValue>(initial?.entry ?? emptyEntry())
  const [dates, setDates] = useState({ start: today, end: "" })
  const [requirementsFrom, setRequirementsFrom] = useState<RequirementsFrom | null>(null)
  const [fillAll, setFillAll] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const template = templateId ? bundle.templates[templateId] : null
  const depth = parent.depth + 1
  const refRule = refIdRule(depth)
  const slots = templateId ? slotsOf(bundle, templateId) : []
  const items = useMemo(() => (templateId ? itemsOf(bundle, templateId, entry) : []), [bundle, templateId, entry])
  const chosen = items.filter((i) => i.node.uploaderRule === "chosen")
  const personName = useMemo(() => new Map(people.map((p) => [p.value, p.label])), [people])
  const ownDates: ParentDates = { name: entry.name.trim() || (template?.instanceLabel ?? ""), start: dates.start, end: dates.end, isEntry: false }
  const pastEntries = templateId ? pastStartEntries(bundle, templateId, entry, ownDates, today) : []

  // ---- step validation -------------------------------------------------------
  const problems = (s: number): string | null => {
    if (s === 0) return templateId ? null : "Choose a template."
    if (s === 1) {
      if (!entry.name.trim()) return `Enter the ${template?.instanceLabel.toLowerCase() ?? "name"}.`
      if (refRule === "required" && !entry.referenceId.trim()) return "Enter a Reference ID."
      if (entry.referenceId.trim() && !REFERENCE_ID_PATTERN.test(entry.referenceId.trim())) return REFERENCE_ID_HINT
      if (!dates.start) return "Choose a start date."
      if (dates.end && dates.end < dates.start) return "The end date must be after the start date."
      return null
    }
    if (s === 2) {
      const unnamed = items.some((i) => !i.entryName.trim())
      if (unnamed) return "Every entry needs a name."
      return templateId ? entryDateProblem(bundle, templateId, entry, ownDates) : null
    }
    if (s === 3) {
      const missing = chosen.find((i) => !entryAt(i.path).uploaders[i.node.id])
      if (missing) return `Choose who uploads “${missing.node.name}” in ${missing.location}.`
      const noOwner = items.find((i) => i.node.uploaderRule === "slot_owner" && !i.ownerId)
      if (noOwner) return `“${noOwner.node.name}” is uploaded by the owner of “${noOwner.entryName || "…"}” — choose one in Entries.`
      return null
    }
    return null
  }

  function entryAt(path: [string, number][]): EntryValue {
    return path.reduce<EntryValue>((e, [slot, i]) => e.slots[slot]![i]!, entry)
  }

  const go = (to: number) => {
    // Skip the Entries step for templates without slots.
    let target = to
    if (target === 2 && slots.length === 0) target = to > step ? 3 : 1
    if (target > step) {
      for (let s = step; s < target; s++) {
        const p = problems(s)
        if (p) {
          setError(p)
          return
        }
      }
    }
    setError(null)
    setStep(target)
  }

  const create = () =>
    startTransition(async () => {
      for (let s = 0; s < 4; s++) {
        const p = problems(s)
        if (p) {
          setError(p)
          setStep(s === 2 && slots.length === 0 ? 3 : s)
          return
        }
      }
      if (pastEntries.length > 0 && !requirementsFrom) {
        setError("Choose where to generate requirements from.")
        setStep(4)
        return
      }
      const payload = { ...toPayload(entry, dates), ...(pastEntries.length > 0 && requirementsFrom ? { requirements_from: requirementsFrom } : {}) }
      const result = await createFromTemplate(parent.id, templateId!, payload)
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success(`“${entry.name.trim()}” created`)
      router.push(`/repository/${departmentCode}/${result.data.folderId}`)
    })

  const summary = templateId ? summarise(bundle, templateId, entry) : null

  return (
    <div className="grid gap-6">
      {initial && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          Starting from <span className="font-medium">“{initial.sourceName}”</span>: its entries, owners and uploaders are copied. Give the new one a
          name and check each step.
        </p>
      )}
      {/* Steps */}
      <ol className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((label, i) => {
          const skipped = i === 2 && templateId !== null && slots.length === 0
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => go(i)}
                disabled={skipped}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1",
                  i === step ? "border-primary bg-primary text-primary-foreground" : i < step ? "border-primary/40 text-primary" : "text-muted-foreground",
                  skipped && "opacity-40"
                )}
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-background/20 text-xs font-medium">
                  {i < step ? <Check className="size-3" /> : i + 1}
                </span>
                {label}
              </button>
            </li>
          )
        })}
      </ol>

      <div className="min-h-64 rounded-xl border bg-card p-4 md:p-6">
        {step === 0 && (
          <div className="grid gap-3">
            {bundle.available.length === 0 ? (
              <p className="text-sm text-muted-foreground">No templates are available to this department yet. An administrator can create them under Templates.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {bundle.available.map((id) => {
                  const t = bundle.templates[id]!
                  const s = summarise(bundle, id, emptyEntry("x"))
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setTemplateId(id)
                        setEntry(emptyEntry(entry.name))
                      }}
                      className={cn(
                        "flex gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40",
                        templateId === id && "border-primary bg-primary/5 ring-2 ring-primary/20"
                      )}
                    >
                      <LayoutTemplate className="mt-0.5 size-5 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <span className="block font-medium">{t.name}</span>
                        {t.description && <span className="block text-sm text-muted-foreground">{t.description}</span>}
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {s.folders - 1} {s.folders - 1 === 1 ? "folder" : "folders"} · {s.once} one-time · {s.series} recurring
                          {slotsOf(bundle, id).length ? ` · repeats ${slotsOf(bundle, id).map((x) => x.node.name).join(", ")}` : ""}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {step === 1 && template && (
          <div className="grid max-w-xl gap-4">
            <Field id="w-name" label={template.instanceLabel}>
              {(d) => (
                <Input id="w-name" autoFocus value={entry.name} onChange={(e) => setEntry({ ...entry, name: e.target.value })} aria-describedby={d} placeholder="e.g. Diploma In Nautical Science" />
              )}
            </Field>
            {refRule === "auto" ? (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Reference ID</span>
                <div className="rounded-lg border bg-muted/40 px-2.5 py-1.5 font-mono text-sm">
                  {parent.referenceId} ({entry.name.trim() || "…"})
                </div>
              </div>
            ) : (
              <Field id="w-ref" label="Reference ID" optional={refRule === "optional"} hint={REFERENCE_ID_HINT}>
                {(d) => (
                  <Input id="w-ref" className="font-mono" value={entry.referenceId} onChange={(e) => setEntry({ ...entry, referenceId: e.target.value })} aria-describedby={d} />
                )}
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="w-start" label="Start date" hint="Recurring files start from the period containing this date.">
                {(d) => <Input id="w-start" type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} aria-describedby={d} />}
              </Field>
              <Field id="w-end" label="End date" optional hint="No new periods are created after it.">
                {(d) => <Input id="w-end" type="date" value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })} aria-describedby={d} />}
              </Field>
            </div>
          </div>
        )}

        {step === 2 && templateId && (
          <div className="grid gap-6">
            {slots.map(({ node, path }) => (
              <div key={node.id}>
                {path.length > 0 && <p className="mb-1 text-xs text-muted-foreground">Inside {path.join(" › ")}</p>}
                <SlotEditor
                  bundle={bundle}
                  slot={{ id: node.id, name: node.name, slotTemplateId: node.slotTemplateId!, ownerLabel: node.slotOwnerLabel, entryDates: node.slotEntryDates }}
                  entries={entry.slots[node.id] ?? []}
                  onChange={(list) => setEntry({ ...entry, slots: { ...entry.slots, [node.id]: list } })}
                  people={people}
                  parent={ownDates}
                />
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4">
            {chosen.length > 1 && (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-64 flex-1">
                  <span className="mb-1 block text-xs text-muted-foreground">Same person for every item below</span>
                  <PersonCombobox people={people} value={fillAll} onChange={setFillAll} />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!fillAll}
                  onClick={() => {
                    let next = entry
                    for (const i of chosen) next = updateEntryAt(next, i.path, (e) => ({ ...e, uploaders: { ...e.uploaders, [i.node.id]: fillAll } }))
                    setEntry(next)
                  }}
                >
                  Apply to all
                </Button>
              </div>
            )}
            <ul className="grid gap-2">
              {items.map((i) => (
                <li key={i.key} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_18rem] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <FileText className="size-4 text-muted-foreground" /> {i.node.name}
                      {i.node.recurrence !== "once" && <Badge variant="secondary">{RECURRENCE_LABELS[i.node.recurrence]}</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{i.location}</div>
                  </div>
                  {i.node.uploaderRule === "chosen" ? (
                    <PersonCombobox
                      people={people}
                      value={entryAt(i.path).uploaders[i.node.id] ?? null}
                      onChange={(v) => setEntry(updateEntryAt(entry, i.path, (e) => ({ ...e, uploaders: { ...e.uploaders, [i.node.id]: v } })))}
                      invalid={!entryAt(i.path).uploaders[i.node.id] || undefined}
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {i.node.uploaderRule === "slot_owner"
                        ? i.ownerId
                          ? personName.get(i.ownerId)
                          : "Owner not chosen yet"
                        : i.node.uploaderRule === "fixed"
                          ? (personName.get(i.node.fixedUploaderId ?? "") ?? "A specific person")
                          : UPLOADER_LABELS[i.node.uploaderRule]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {items.length === 0 && <p className="text-sm text-muted-foreground">This template has no document items.</p>}
          </div>
        )}

        {step === 4 && templateId && summary && (
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            {pastEntries.length > 0 && (
              <div className="lg:col-span-2">
                <RequirementsFromQuestion entries={pastEntries} today={today} value={requirementsFrom} onChange={setRequirementsFrom} />
              </div>
            )}
            <div className="rounded-lg border bg-muted/20 p-4 text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <FolderTree className="size-4 text-primary" /> {entry.name}
              </span>
              <ReviewTree bundle={bundle} list={treeOf(bundle, templateId)} entry={entry} />
            </div>
            <div className="grid content-start gap-3">
              <dl className="grid grid-cols-2 gap-3">
                {[
                  ["Folders", summary.folders],
                  ["One-time files", summary.once],
                  ["Recurring files", summary.series],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg border p-3">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">
                One-time requirements are created now and their uploaders notified. Recurring files get their requirements
                up to the current period now; the scheduler creates the following periods automatically.
              </p>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={() => go(step - 1)} disabled={step === 0 || pending}>
          <ChevronLeft /> Back
        </Button>
        {step < 4 ? (
          <Button type="button" onClick={() => go(step + 1)} disabled={!templateId}>
            Next <ChevronRight />
          </Button>
        ) : (
          <Button type="button" onClick={create} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            Create {template?.instanceLabel.toLowerCase().replace(/ name$/, "") ?? "it"}
          </Button>
        )}
      </div>
    </div>
  )
}

function ReviewTree({ bundle, list, entry }: { bundle: Bundle; list: TemplateTreeNode[]; entry: EntryValue }) {
  return (
    <ul className="ml-4 border-l pl-3">
      {list.map((n) =>
        n.kind === "folder" ? (
          <li key={n.id} className="py-0.5">
            <span className="flex items-center gap-1.5">
              <Folder className="size-3.5 text-primary" /> {n.name}
            </span>
            <ReviewTree bundle={bundle} list={n.children} entry={entry} />
          </li>
        ) : n.kind === "document" ? (
          <li key={n.id} className="flex items-center gap-1.5 py-0.5 text-muted-foreground">
            {n.recurrence === "once" ? <FileText className="size-3.5" /> : <Repeat className="size-3.5" />}
            {n.name}
            {n.recurrence !== "once" && <span className="text-xs">({RECURRENCE_LABELS[n.recurrence].toLowerCase()})</span>}
          </li>
        ) : (
          (entry.slots[n.id] ?? []).map((child, i) => (
            <li key={`${n.id}-${i}`} className="py-0.5">
              <span className="flex items-center gap-1.5">
                <FolderTree className="size-3.5 text-primary" /> {child.name || "…"}
              </span>
              <ReviewTree bundle={bundle} list={treeOf(bundle, n.slotTemplateId!)} entry={child} />
            </li>
          ))
        )
      )}
    </ul>
  )
}
