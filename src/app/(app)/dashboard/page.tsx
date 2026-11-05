import type { Metadata } from "next"
import { Suspense } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import type { AccessContext } from "@/lib/auth/permissions"
import { requireAppContext, type AppContext } from "@/lib/auth/session"
import { APP_TIMEZONE } from "@/lib/config"
import { widgetsFor, type WidgetDef } from "@/lib/dashboard/widgets"
import {
  getTaskCounts,
  listDocumentsByIds,
  listRecentlyApproved,
  listRequirements,
  listReviewTasks,
  listTeamDocuments,
  listUploadTasks,
  type DocumentListRow,
  type ReviewTask,
  type TaskCounts,
} from "@/lib/data/documents"
import { daysSince, isClosed } from "@/lib/documents"
import { formatDate, todayIso } from "@/lib/format"
import { ActivityChart, type ActivityPoint } from "@/components/charts/activity-chart"
import { BarList, type BarDatum } from "@/components/charts/bar-list"
import {
  activitySeries,
  auditFeed,
  countsByDepartment,
  countsByType,
  departmentCompliance,
  departmentSummary,
  recentDocumentIds,
} from "@/lib/data/insights"
import { listSchedulerRuns, schedulerIsStale, type SchedulerRun } from "@/lib/data/scheduler"
import { verificationsThisMonth } from "@/lib/data/students"
import { listAssignments, listMyAssignments, myKpiEntryCounts } from "@/lib/data/kpis"
import { NoticeToast } from "./notice-toast"
import { AuditFeed } from "./widgets/audit-feed"
import { OrgStats } from "./widgets/org-stats"
import { QuickActions } from "./widgets/quick-actions"
import { RecurringCompliance, SchedulerHealth } from "./widgets/recurring-widgets"
import { KpiCompliance, KpisToScore, MyKpiEvidence } from "./widgets/kpi-widgets"
import { SetupHealth } from "./widgets/setup-health"
import { WidgetCard } from "./widgets/widget-card"
import { DocList, MyKpis, RequirementTracker, ReviewList, StatusBreakdown, TeamWorkload, Tiles } from "./widgets/work-widgets"

export const metadata: Metadata = { title: "Dashboard" }

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: APP_TIMEZONE }).format(new Date())
  )
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

type Feed = Awaited<ReturnType<typeof auditFeed>>

type Data = {
  counts: TaskCounts
  uploads: DocumentListRow[]
  reviews: ReviewTask[]
  requirements: DocumentListRow[]
  team: DocumentListRow[]
  byDepartment: BarDatum[]
  byType: BarDatum[]
  deptByType: BarDatum[]
  activity: ActivityPoint[]
  recentlyApproved: DocumentListRow[]
  recentlyAccessed: DocumentListRow[]
  recentAudit: Feed | null
  deptAudit: Feed | null
  deptSummary: Awaited<ReturnType<typeof departmentSummary>> | null
  compliance: Awaited<ReturnType<typeof departmentCompliance>> | null
  schedulerRuns: SchedulerRun[]
  verifications: { total: number; matched: number } | null
  myKpi: { assignments: number; open: number; overdue: number; dueSoon: number } | null
  kpiByDepartment: { department: string; assignments: number; overdue: number }[] | null
}

/** Loads only what the visible widgets need. */
async function loadData(ctx: AppContext, ids: Set<string>): Promise<Data> {
  const needs = (...w: string[]) => w.some((id) => ids.has(id))
  const none = Promise.resolve([] as never[])
  const [counts, uploads, reviews, requirements, team, byDepartment, byType, deptByType, activity, recentlyApproved, recentIds, recentAudit, deptAudit, deptSummary, compliance, schedulerRuns, verifications, myKpi, kpiByDepartment] =
    await Promise.all([
      getTaskCounts(),
      needs("to-upload", "changes-requested") ? listUploadTasks(ctx) : none,
      needs("to-review") ? listReviewTasks(ctx) : none,
      needs("requirement-tracker") ? listRequirements(ctx, { state: "open" }).then((p) => p.rows) : none,
      needs("team-workload", "team-pending", "team-recent", "team-status") ? listTeamDocuments(ctx).then((p) => p.rows) : none,
      needs("docs-by-department") ? countsByDepartment() : none,
      needs("docs-by-type") ? countsByType() : none,
      needs("dept-docs-by-type") ? countsByType(ctx.department.id) : none,
      needs("activity-trend") ? activitySeries(30) : none,
      needs("recently-approved") ? listRecentlyApproved() : none,
      needs("recently-accessed") ? recentDocumentIds() : Promise.resolve([] as string[]),
      needs("recent-audit") ? auditFeed() : Promise.resolve(null),
      needs("dept-activity") ? auditFeed({ departmentId: ctx.department.id }) : Promise.resolve(null),
      needs("dept-kpis") ? departmentSummary(ctx.department.id) : Promise.resolve(null),
      needs("recurring-compliance") ? departmentCompliance(ctx.department.id) : Promise.resolve(null),
      needs("scheduler-health") ? listSchedulerRuns(5) : Promise.resolve([] as SchedulerRun[]),
      needs("verification-stats") ? verificationsThisMonth(`${todayIso().slice(0, 8)}01`) : Promise.resolve(null),
      needs("my-kpi-evidence") ? loadMyKpi(ctx.user.id) : Promise.resolve(null),
      needs("kpi-compliance") ? loadKpiByDepartment() : Promise.resolve(null),
    ])
  const recentlyAccessed = await listDocumentsByIds(recentIds)
  return {
    counts,
    uploads,
    reviews,
    requirements,
    team,
    byDepartment,
    byType,
    deptByType,
    activity,
    recentlyApproved,
    recentlyAccessed,
    recentAudit,
    deptAudit,
    deptSummary,
    compliance,
    schedulerRuns,
    verifications,
    myKpi,
    kpiByDepartment,
  }
}

async function loadMyKpi(userId: string) {
  const today = todayIso()
  const weekAhead = new Date(`${today}T00:00:00Z`)
  weekAhead.setUTCDate(weekAhead.getUTCDate() + 7)
  const [mine, counts] = await Promise.all([listMyAssignments(userId), myKpiEntryCounts(userId, today, weekAhead.toISOString().slice(0, 10))])
  return { assignments: mine.filter((a) => a.status === "active").length, ...counts }
}

async function loadKpiByDepartment() {
  const rows = await listAssignments({ status: "active" })
  const by = new Map<string, { department: string; assignments: number; overdue: number }>()
  for (const r of rows) {
    const x = by.get(r.department.id) ?? { department: r.department.name, assignments: 0, overdue: 0 }
    x.assignments++
    x.overdue += r.summary.overdue
    by.set(r.department.id, x)
  }
  return [...by.values()].sort((a, b) => b.overdue - a.overdue || a.department.localeCompare(b.department))
}

/** Widgets with live data; the rest render a phase placeholder. */
function renderWidget(widget: WidgetDef, access: AccessContext, data: Data) {
  switch (widget.id) {
    // These load their own data; stream them in rather than holding back the dashboard.
    case "org-stats":
      return (
        <Suspense fallback={<Skeleton className="h-24" />}>
          <OrgStats />
        </Suspense>
      )
    case "setup-health":
      return (
        <Suspense fallback={<Skeleton className="h-24" />}>
          <SetupHealth />
        </Suspense>
      )
    case "quick-actions":
      return <QuickActions access={access} />
    case "scheduler-health":
      return <SchedulerHealth run={data.schedulerRuns[0] ?? null} stale={schedulerIsStale(data.schedulerRuns)} />
    case "my-kpi-evidence":
      return data.myKpi && <MyKpiEvidence data={data.myKpi} />
    case "kpis-to-score":
      return <KpisToScore toReview={data.counts.kpiToReview} toScore={data.counts.kpiToScore} />
    case "kpi-compliance":
      return data.kpiByDepartment && <KpiCompliance rows={data.kpiByDepartment} />
    case "verification-stats":
      return (
        data.verifications && (
          <Tiles
            tiles={[
              { label: "Requests", value: data.verifications.total, href: "/admin/verifications" },
              { label: "Matched", value: data.verifications.matched, href: "/admin/verifications?outcome=matched" },
            ]}
          />
        )
      )
    case "recurring-compliance":
      return data.compliance && <RecurringCompliance data={data.compliance} />
    case "my-kpis":
      return <MyKpis counts={data.counts} />
    case "to-upload":
      return (
        <DocList
          documents={data.uploads.filter((d) => d.status === "pending_upload")}
          empty="No uploads are waiting for you."
          moreHref="/tasks"
          meta={(d) => `${d.department.code} · ${d.dueDate ? `due ${formatDate(d.dueDate)}` : `${daysSince(d.createdAt)}d pending`}`}
        />
      )
    case "to-review":
      return <ReviewList tasks={data.reviews} />
    case "changes-requested":
      return (
        <DocList
          documents={data.uploads.filter((d) => d.status === "changes_requested")}
          empty="Nothing has been sent back to you."
          moreHref="/tasks"
          meta={(d) => `${d.department.code} · v${d.currentVersion?.versionNo ?? 0}`}
        />
      )
    case "requirement-tracker":
      return <RequirementTracker documents={data.requirements} />
    case "team-workload":
      return <TeamWorkload documents={data.team} />
    case "team-pending":
      return (
        <DocList
          documents={data.team.filter((d) => !isClosed(d.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))}
          empty="Nothing pending in your team."
          moreHref="/team"
          meta={(d) => `${d.uploader.fullName} · ${daysSince(d.createdAt)}d`}
        />
      )
    case "team-recent":
      return (
        <DocList
          documents={data.team
            .filter((d) => d.currentVersion)
            .sort((a, b) => b.currentVersion!.uploadedAt.localeCompare(a.currentVersion!.uploadedAt))}
          empty="No uploads by your team yet."
          moreHref="/team"
          meta={(d) => `v${d.currentVersion!.versionNo} by ${d.uploader.fullName} · ${formatDate(d.currentVersion!.uploadedAt)}`}
        />
      )
    case "team-status":
      return <StatusBreakdown documents={data.team} />
    case "docs-by-department":
      return <BarList data={data.byDepartment} empty="No documents yet." />
    case "docs-by-type":
      return <BarList data={data.byType} empty="No documents yet." />
    case "dept-docs-by-type":
      return <BarList data={data.deptByType} empty="No documents in your department yet." />
    case "activity-trend":
      return <ActivityChart data={data.activity} />
    case "recently-approved":
      return (
        <DocList
          documents={data.recentlyApproved}
          empty="Nothing approved yet."
          moreHref="/search?status=approved"
          meta={(d) => `${d.department.code} · v${d.currentVersion?.versionNo ?? 0} · ${formatDate(d.updatedAt)}`}
        />
      )
    case "recently-accessed":
      return (
        <DocList
          documents={data.recentlyAccessed}
          empty="Documents you view or download appear here."
          moreHref="/my-documents"
          meta={(d) => `${d.department.code} · ${d.folder.level === "root" ? "Standalone" : d.folder.name}`}
        />
      )
    case "recent-audit":
      return data.recentAudit && <AuditFeed {...data.recentAudit} moreHref="/audit" />
    case "dept-activity":
      return data.deptAudit && <AuditFeed {...data.deptAudit} moreHref="/audit" />
    case "dept-kpis":
      return (
        data.deptSummary && (
          <Tiles
            tiles={[
              { label: "Documents", value: data.deptSummary.total, href: "/team" },
              { label: "Pending uploads", value: data.deptSummary.pendingUpload + data.deptSummary.changesRequested, href: "/requirements", tone: "attention" },
              { label: "In review", value: data.deptSummary.inReview, href: "/requirements" },
              { label: "Approved this month", value: data.deptSummary.approvedThisMonth },
            ]}
          />
        )
      )
    default:
      return null
  }
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const ctx = await requireAppContext()
  const { notice } = await searchParams
  const access: AccessContext = { permissions: ctx.permissions, isHod: ctx.isHod, hasSubordinates: ctx.hasSubordinates }
  const data = await loadData(ctx, new Set(widgetsFor(access).flatMap((s) => s.widgets.map((w) => w.id))))
  // The KPI cards only for people who have KPIs, or KPIs waiting for their approval or score.
  const sections = widgetsFor(access)
    .map((s) => ({
      ...s,
      widgets: s.widgets.filter(
        (w) => (w.id !== "my-kpi-evidence" || (data.myKpi?.assignments ?? 0) > 0) && (w.id !== "kpis-to-score" || data.counts.kpiToReview + data.counts.kpiToScore > 0)
      ),
    }))
    .filter((s) => s.widgets.length > 0)

  return (
    <div className="space-y-8">
      <NoticeToast notice={typeof notice === "string" ? notice : undefined} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}, {ctx.user.fullName.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[ctx.user.designation, ctx.department.name].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ctx.roles.map((r) => (
            <Badge key={r.id} variant={r.systemKey === "employee" ? "outline" : "secondary"}>
              {r.name}
            </Badge>
          ))}
        </div>
      </div>

      {sections.map((s) => (
        <section key={s.section} aria-labelledby={`section-${s.section}`} className="space-y-3">
          <h2 id={`section-${s.section}`} className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            {s.title}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {s.widgets.map((w) => (
              <WidgetCard key={w.id} widget={w}>
                {renderWidget(w, access, data)}
              </WidgetCard>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
