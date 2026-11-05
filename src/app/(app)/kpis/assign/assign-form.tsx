"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus, Search, Send, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import { PersonCombobox, type PersonItem } from "@/components/person-combobox"
import type { AssignablePerson } from "@/lib/data/kpis"
import { kpiYearOf } from "@/lib/kpis"
import { assignKpi } from "../actions"

type KpiOption = { id: string; name: string; designation: string | null; yearStartMonth: number; areaCount: number }
type Props = {
  kpis: KpiOption[]
  initialKpiId: string | null
  people: AssignablePerson[]
  reviewers: PersonItem[]
  activeAssignments: { kpiId: string | null; userId: string; startDate: string; endDate: string }[]
  today: string
}

export function AssignForm({ kpis, initialKpiId, people, reviewers, activeAssignments, today }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [kpiId, setKpiId] = useState<string | null>(initialKpiId)
  const kpi = kpis.find((k) => k.id === kpiId) ?? null
  const year = kpiYearOf(today, kpi?.yearStartMonth ?? 4)
  const [dates, setDates] = useState(year)
  const [designation, setDesignation] = useState<string>(kpi?.designation ?? "")
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(people.filter((p) => kpi?.designation && (p.designation ?? "").trim() === kpi.designation).map((p) => p.id))
  )
  const [reviewerId, setReviewerId] = useState<string | null>(null)
  const [useReviewer, setUseReviewer] = useState(false)
  const [scorerId, setScorerId] = useState<string | null>(null)
  const [useScorer, setUseScorer] = useState(false)
  const [backfill, setBackfill] = useState(false)

  const designations = useMemo(() => [...new Set(people.map((p) => (p.designation ?? "").trim()).filter(Boolean))].sort(), [people])
  const alreadyHas = (userId: string) =>
    activeAssignments.some((a) => a.kpiId === kpiId && a.userId === userId && a.startDate <= dates.end && a.endDate >= dates.start)
  const shown = people.filter((p) => {
    if (designation && (p.designation ?? "").trim() !== designation) return false
    const term = q.trim().toLowerCase()
    return !term || p.fullName.toLowerCase().includes(term) || p.department.name.toLowerCase().includes(term)
  })
  const chosen = people.filter((p) => selected.has(p.id) && !alreadyHas(p.id))

  const pickKpi = (id: string | null) => {
    setKpiId(id)
    const k = kpis.find((x) => x.id === id)
    if (!k) return
    setDates(kpiYearOf(today, k.yearStartMonth))
    setDesignation(k.designation ?? "")
    setSelected(new Set(people.filter((p) => k.designation && (p.designation ?? "").trim() === k.designation).map((p) => p.id)))
  }
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const submit = () =>
    startTransition(async () => {
      if (!kpi) return void toast.error("Choose a KPI.")
      if (chosen.length === 0) return void toast.error("Choose at least one person.")
      const result = await assignKpi({
        kpiId: kpi.id,
        userIds: chosen.map((p) => p.id),
        startDate: dates.start,
        endDate: dates.end,
        reviewerId: useReviewer ? reviewerId : null,
        scorerId: useScorer ? scorerId : null,
        backfill,
      })
      if (!result.ok) return void toast.error(result.error)
      toast.success(`“${kpi.name}” assigned to ${chosen.length} ${chosen.length === 1 ? "person" : "people"} · ${result.data.created} ${result.data.created === 1 ? "period" : "periods"} opened`)
      router.push(`/kpis/assignments?kpi=${kpi.id}`)
    })

  if (kpis.length === 0) {
    return <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No active KPIs yet. Activate a KPI first.</p>
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid gap-6">
        <section className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-3">
          <Field id="as-kpi" label="KPI">
            {(d) => (
              <OptionSelect id="as-kpi" options={kpis.map((k) => ({ value: k.id, label: k.name }))} value={kpiId} onChange={pickKpi} aria-describedby={d} />
            )}
          </Field>
          <Field id="as-start" label="From">
            {(d) => <Input id="as-start" type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} aria-describedby={d} />}
          </Field>
          <Field id="as-end" label="To">
            {(d) => <Input id="as-end" type="date" min={dates.start} max={dates.start ? kpiYearOf(dates.start, kpi?.yearStartMonth ?? 4).end : undefined} value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })} aria-describedby={d} />}
          </Field>
        </section>

        <section className="rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <OptionSelect
              className="w-full sm:w-56"
              options={[{ value: "__all__", label: "Every designation" }, ...designations.map((x) => ({ value: x, label: x }))]}
              value={designation || "__all__"}
              onChange={(v) => setDesignation(!v || v === "__all__" ? "" : v)}
            />
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or department" className="pl-8" aria-label="Search people" />
            </div>
            <span className="flex gap-1 sm:ml-auto">
              <Button variant="ghost" size="sm" onClick={() => setSelected((s) => new Set([...s, ...shown.map((p) => p.id)]))}>
                Select all shown
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </span>
          </div>
          <ul className="max-h-[28rem] divide-y overflow-y-auto">
            {shown.length === 0 && <li className="p-4 text-sm text-muted-foreground">No one matches.</li>}
            {shown.map((p) => {
              const has = alreadyHas(p.id)
              return (
                <li key={p.id}>
                  <label className={`flex items-center gap-3 px-3 py-2 text-sm ${has ? "opacity-50" : ""}`}>
                    <Checkbox checked={selected.has(p.id) && !has} disabled={has} onCheckedChange={(c) => toggle(p.id, Boolean(c))} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{p.fullName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.designation ?? "No designation"} · {p.department.name}
                      </span>
                    </span>
                    {has && <Badge variant="outline">Already assigned</Badge>}
                  </label>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="grid gap-3 rounded-xl border bg-card p-4">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={useReviewer} onCheckedChange={(c) => setUseReviewer(Boolean(c))} />
            <span>
              <span className="font-medium">Choose the reviewer</span>
              <span className="block text-xs text-muted-foreground">
                Otherwise the KPI&apos;s reviewer is used (e.g. the person&apos;s reporting manager). The reviewer approves each period before it is scored.
              </span>
            </span>
          </label>
          {useReviewer && (
            <div className="pl-6">
              <PersonCombobox people={reviewers} value={reviewerId} onChange={setReviewerId} placeholder="Reviewer" />
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={useScorer} onCheckedChange={(c) => setUseScorer(Boolean(c))} />
            <span>
              <span className="font-medium">Choose the scorer</span>
              <span className="block text-xs text-muted-foreground">
                Otherwise the KPI&apos;s scorer is used (e.g. the head of HR or Quality). The scorer gives each approved period a score from 1 to 10.
              </span>
            </span>
          </label>
          {useScorer && (
            <div className="pl-6">
              <PersonCombobox people={reviewers} value={scorerId} onChange={setScorerId} placeholder="Scorer" />
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={backfill} onCheckedChange={(c) => setBackfill(Boolean(c))} />
            <span>
              <span className="font-medium">Also create periods that have already passed</span>
              <span className="block text-xs text-muted-foreground">
                Off: monthly, quarterly and half-yearly areas start from the current period. On: every period since the start date opens (and may be overdue
                straight away).
              </span>
            </span>
          </label>
        </section>
      </div>

      <aside className="h-fit space-y-3 rounded-xl border bg-muted/20 p-4 lg:sticky lg:top-4">
        <h2 className="font-medium">Summary</h2>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{chosen.length}</span> {chosen.length === 1 ? "person" : "people"} ·{" "}
          {kpi ? `${kpi.areaCount} area${kpi.areaCount === 1 ? "" : "s"} each` : "no KPI"}
        </p>
        {chosen.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {chosen.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                {p.fullName}
                <button type="button" aria-label={`Remove ${p.fullName}`} onClick={() => toggle(p.id, false)}>
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button className="w-full" onClick={submit} disabled={pending || !kpi || chosen.length === 0 || (useReviewer && !reviewerId) || (useScorer && !scorerId)}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          Assign
        </Button>
        <p className="text-xs text-muted-foreground">
          <Plus className="inline size-3" /> You can assign more KPIs to the same person later (e.g. Simulator Incharge).
        </p>
      </aside>
    </div>
  )
}
