import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { AlertTriangle, ArrowLeft, ClipboardCheck, EyeOff, Gauge, ListChecks } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { canAssignKpis, hasPerm, seesKpiAdmin } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { getAssignment, type AssignmentDetail, type KpiEntry } from "@/lib/data/kpis"
import { listPeoplePicker } from "@/lib/data/org"
import { formatDate, formatDateTime, todayIso } from "@/lib/format"
import { formatKpiScore, formatScore, KPI_RATING_BANDS, PROJECTED_SCORE_HINT, ratingClass } from "@/lib/kpis"
import { MONTHS } from "@/lib/validation/settings"
import { AreaHistory, type HistoryArea } from "./area-history"
import { AssignmentActions } from "./assignment-actions"
import { FillSection, type FillEntry } from "./fill-section"
import { ReviewCard } from "./review-card"
import { ScoreCard, type ScoreEntry } from "./score-card"

export async function generateMetadata({ params }: PageProps<"/kpis/assignments/[id]">): Promise<Metadata> {
  const { id } = await params
  const a = await getAssignment(id)
  return { title: a ? `${a.kpiName} · ${a.user.fullName}` : "KPI" }
}

/** The Projected Score during the year; the stored Final Score once it is generated. */
function ScorePanel({ a, today }: { a: AssignmentDetail; today: string }) {
  const s = a.summary
  const final = s.finalScore !== null
  const periodOver = a.status === "ended" || a.endDate < today
  return (
    <section className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-4 md:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="space-y-1">
        <h2 className="text-sm font-medium" title={final ? undefined : PROJECTED_SCORE_HINT}>
          {final ? "Final Score" : "Projected Score"}
        </h2>
        <p className="text-3xl font-semibold tabular-nums">
          {formatKpiScore(final ? s.finalScore : s.projectedScore)}
          <span className="text-base font-normal text-muted-foreground"> / 100</span>
        </p>
        {final && s.finalRating && (
          <Badge variant="outline" className={ratingClass(s.finalRating)}>
            {s.finalRating}
          </Badge>
        )}
        <p className="text-xs text-muted-foreground">
          {final ? (
            <>Generated {s.finalGeneratedAt ? formatDateTime(s.finalGeneratedAt) : ""}</>
          ) : periodOver && s.undecided > 0 ? (
            <span className="font-medium text-warning-text">
              Final Score waiting on {s.undecided} {s.undecided === 1 ? "period" : "periods"}
            </span>
          ) : (
            "Based on periods scored so far"
          )}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {s.scored} of {s.total - s.notApplicable} periods scored
          {s.notApplicable > 0 && ` · ${s.notApplicable} not applicable`}
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-1 content-start gap-2 sm:grid-cols-2">
        {a.areas
          .filter((ar) => ar.recurrence)
          .map((ar) => (
            <div key={ar.id} className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{ar.name}</span>
                <span className="text-xs text-muted-foreground">{ar.weightage}% weight</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{formatScore(ar.score)}</span>
                <span className="text-xs text-muted-foreground"> / 10</span>
              </span>
            </div>
          ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground md:col-span-2">
        <span className="mr-1">Final rating</span>
        {KPI_RATING_BANDS.map((b) => (
          <Badge key={b.label} variant="outline" className={b.className}>
            {b.range} {b.label}
          </Badge>
        ))}
      </div>
    </section>
  )
}

/** One person's KPI for one year: they fill it in, their reviewer approves it, the scorer scores it. Visible to their line and HR (RLS). */
export default async function AssignmentPage({ params }: PageProps<"/kpis/assignments/[id]">) {
  const { id } = await params
  const [ctx, a] = await Promise.all([requireAppContext(), getAssignment(id)])
  if (!a) notFound()

  const today = todayIso()
  const me = ctx.user.id
  const mine = a.user.id === me
  const isReviewer = a.reviewer?.id === me
  const isScorer = a.scorer?.id === me
  const isHr = canAssignKpis(ctx, a.department.id)
  const released = Boolean(a.scoresReleasedAt)
  const scoresVisible = !mine || released
  const canDownload = hasPerm(ctx, "document.download")
  const legacy = a.reviewer === null
  const back = seesKpiAdmin(ctx) ? { href: "/kpis/assignments", label: "KPI assignments" } : mine ? { href: "/my-kpis", label: "My KPIs" } : { href: "/tasks", label: "My Tasks" }

  const decorate = (ar: AssignmentDetail["areas"][number], e: KpiEntry): ScoreEntry => ({
    ...e,
    areaName: ar.name,
    weightage: ar.weightage,
    measured: ar.description,
    areaScore: ar.score,
    earlier: ar.entries.filter((x) => x.id !== e.id && x.score).map((x) => ({ label: x.periodLabel, value: x.score!.value })),
  })
  const areas: HistoryArea[] = a.areas.map((ar) => ({
    id: ar.id,
    name: ar.name,
    weightage: ar.weightage,
    description: ar.description,
    recurrence: ar.recurrence,
    score: ar.score,
    entries: ar.entries.map((e) => decorate(ar, e)),
  }))
  const all = areas.flatMap((ar) => ar.entries)

  const toFill: FillEntry[] = mine && a.status === "active" ? all.filter((e) => e.status === "open" || e.status === "changes_requested") : []
  const toReview = isReviewer
    ? all.filter((e) => e.status === "submitted" || ((e.status === "open" || e.status === "changes_requested") && (e.dueDate < today || a.status === "ended")))
    : []
  const toScore = isScorer ? all.filter((e) => e.status === "approved") : []
  const canCorrect = !mine && (isHr || (isScorer && !released && a.summary.finalScore === null))
  const canDecide = !mine && (isReviewer || isScorer || isHr)
  const canAct = !mine && (isHr || isReviewer || isScorer || hasPerm(ctx, "kpi.manage"))
  const people = isHr ? await listPeoplePicker() : []

  return (
    <div className="space-y-6">
      <div>
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {back.label}
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Gauge className="size-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{a.kpiName}</h1>
              <Badge variant={a.status === "active" ? "secondary" : "outline"}>{a.status === "active" ? "Active" : "Ended"}</Badge>
              {!mine && <Badge variant="outline">{released ? "Scores released" : "Scores hidden from the person"}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {mine ? "Your KPI" : a.user.fullName}
              {a.user.designation ? ` · ${a.user.designation}` : ""} · {a.department.name} · {formatDate(a.startDate)} – {formatDate(a.endDate)} · year from{" "}
              {MONTHS[a.yearStartMonth - 1]}
            </p>
            <p className="text-xs text-muted-foreground">
              Assigned{a.assignedBy ? ` by ${a.assignedBy}` : ""}
              {a.reviewer ? ` · reviewed by ${isReviewer ? "you" : a.reviewer.fullName}` : ""}
              {a.scorer ? ` · scored by ${isScorer ? "you" : a.scorer.fullName}` : ""}. Only {mine ? "you" : a.user.fullName}, the reporting line, the reviewer, the scorer and HR can see this
              record.
            </p>
          </div>
          {canAct && (
            <AssignmentActions
              id={a.id}
              status={a.status}
              canChange={isHr}
              canRelease={isHr || isScorer}
              released={released}
              undecided={a.summary.undecided}
              outdated={a.latestKpiVersion !== null && a.latestKpiVersion > a.kpiVersion}
              endDate={a.endDate}
              reviewerId={a.reviewer?.id ?? null}
              scorerId={a.scorer?.id ?? null}
              people={people}
              personId={a.user.id}
              legacy={legacy}
            />
          )}
        </div>
      </div>

      {legacy && (
        <p className="rounded-xl border bg-muted/30 p-4 text-sm">
          This assignment was made before KPI scoring. Nothing was uploaded for it, so it has been closed. Assign the KPI again to use periods and scores.
        </p>
      )}

      {!legacy && !a.scorer && !mine && (
        <p className="flex gap-2 rounded-xl border border-warning-line bg-warning-soft p-4 text-sm text-warning-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium">No scorer set.</span> Approved periods wait here until someone is chosen.{isHr && " Use Set scorer above."}
          </span>
        </p>
      )}

      {!legacy &&
        (scoresVisible ? (
          <ScorePanel a={a} today={today} />
        ) : (
          <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm">
            <EyeOff className="size-5 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Your scores have not been released yet</span>
              <span className="text-muted-foreground">
                {a.summary.scored} of {a.summary.total - a.summary.notApplicable} periods scored
                {a.summary.overdue > 0 && (
                  <span className="font-medium text-destructive">
                    {" "}
                    · {a.summary.overdue} overdue
                  </span>
                )}
              </span>
            </span>
          </section>
        ))}

      {toReview.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 section-heading">
            <ListChecks className="size-4" /> To review <span className="tabular-nums">({toReview.length})</span>
          </h2>
          <ul className="grid gap-3">
            {toReview.map((e) => (
              <ReviewCard key={e.id} entry={e} canDownload={canDownload} canSendBack={e.status === "submitted" && a.status === "active"} />
            ))}
          </ul>
        </section>
      )}

      {toScore.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 section-heading">
            <ClipboardCheck className="size-4" /> To score <span className="tabular-nums">({toScore.length})</span>
          </h2>
          <ul className="grid gap-3">
            {toScore.map((e) => (
              <ScoreCard key={e.id} entry={e} canDownload={canDownload} />
            ))}
          </ul>
        </section>
      )}

      {toFill.length > 0 && <FillSection entries={toFill} canDownload={canDownload} today={today} />}

      {!legacy && (
        <section className="space-y-3">
          <h2 className="section-heading">History by area</h2>
          <div className="grid grid-cols-1 gap-4">
            {areas.map((ar) => (
              <AreaHistory key={ar.id} area={ar} today={today} canDownload={canDownload} scoresVisible={scoresVisible} canCorrect={canCorrect} canDecide={canDecide} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
