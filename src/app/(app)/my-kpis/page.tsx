import type { Metadata } from "next"
import Link from "next/link"
import { Target } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { listMyAssignments } from "@/lib/data/kpis"
import { formatDate } from "@/lib/format"
import { formatKpiScore, PROJECTED_SCORE_HINT, ratingClass } from "@/lib/kpis"

export const metadata: Metadata = { title: "My KPIs" }

export default async function MyKpisPage() {
  const ctx = await requireNavAccess("/my-kpis")
  const assignments = (await listMyAssignments(ctx.user.id)).filter((a) => a.reviewer)

  return (
    <>
      <PageHeader title="My KPIs" description="The KPIs assigned to you. For each period, write what you did and attach any evidence. Your reviewer approves it, then the scorer scores it." />
      {assignments.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed py-14 text-center">
          <Target className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">No KPIs assigned to you</p>
          <p className="text-sm text-muted-foreground">When HR or Quality assigns one, it appears here.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {assignments.map((a) => {
            const s = a.summary
            const final = s.finalScore !== null
            const toFill = s.openPeriods + s.overdue
            return (
              <Link key={a.id} href={`/kpis/assignments/${a.id}`} className="grid gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/30">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.kpiName}</span>
                  <Badge variant={a.status === "active" ? "secondary" : "outline"}>{a.status === "active" ? "Active" : "Ended"}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(a.startDate)} – {formatDate(a.endDate)}
                  {a.reviewer ? ` · reviewed by ${a.reviewer.fullName}` : ""}
                </p>
                {a.scoresReleasedAt ? (
                  <p className="text-sm" title={final ? undefined : PROJECTED_SCORE_HINT}>
                    <span className="text-muted-foreground">{final ? "Final Score" : "Projected Score"} </span>
                    <span className="text-lg font-semibold tabular-nums">{formatKpiScore(final ? s.finalScore : s.projectedScore)}</span>
                    <span className="text-muted-foreground"> / 100</span>
                    {final && s.finalRating && (
                      <Badge variant="outline" className={`ml-2 ${ratingClass(s.finalRating)}`}>
                        {s.finalRating}
                      </Badge>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Scores not released yet</p>
                )}
                <p className="text-xs">
                  {s.overdue > 0 && <span className="font-medium text-destructive">{s.overdue} overdue · </span>}
                  <span className="text-muted-foreground tabular-nums">
                    {a.status === "active" && toFill > 0 ? `${toFill} to fill in · ` : ""}
                    {s.submitted} waiting for approval · {s.approved} waiting for score · {s.scored} scored
                  </span>
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}
