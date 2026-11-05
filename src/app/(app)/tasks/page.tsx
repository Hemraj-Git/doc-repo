import type { Metadata } from "next"
import Link from "next/link"
import { ClipboardCheck, FileUp, Gauge, MessageSquareWarning, PenLine } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { DocumentsTable } from "@/components/documents/documents-table"
import { PageHeader } from "@/components/page-header"
import { ShowMore, shownRows } from "@/components/show-more"
import { requireNavAccess } from "@/lib/auth/guards"
import { listReviewTasks, listUploadTasks } from "@/lib/data/documents"
import { listKpiFillTasks, listKpiReviewTasks, listKpiScoreTasks, type KpiTask } from "@/lib/data/kpis"
import { daysSince, isOverdue } from "@/lib/documents"
import { formatDate, todayIso } from "@/lib/format"

export const metadata: Metadata = { title: "My Tasks" }

function Section({ icon: Icon, title, count, children }: { icon: typeof FileUp; title: string; count: number; children: React.ReactNode }) {
  return (
    <section className={count === 0 ? "order-last space-y-3" : "space-y-3"}>
      <h2 className="flex items-center gap-2 section-heading">
        <Icon className="size-4" /> {title} <span className="tabular-nums">({count})</span>
      </h2>
      {children}
    </section>
  )
}

const plural = (n: number, word = "period") => `${n} ${word}${n === 1 ? "" : "s"}`

function KpiTaskList({ tasks, action, detail, empty }: { tasks: KpiTask[]; action: string; detail: (t: KpiTask) => React.ReactNode; empty: string }) {
  if (tasks.length === 0) return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {tasks.map((t) => (
        <li key={t.assignmentId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <Gauge className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="block truncate font-medium">{t.kpiName}</span>
            <span className="block text-xs text-muted-foreground">{detail(t)}</span>
          </span>
          <Link href={`/kpis/assignments/${t.assignmentId}`} className={buttonVariants({ size: "sm" })}>
            {action}
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const [ctx, params] = await Promise.all([requireNavAccess("/tasks"), searchParams])
  const shown = shownRows(params.show)
  // Overdue first, then by due date (no due date last), then oldest first.
  const today = todayIso()
  const [reviews, uploads, kpiToFill, kpiToReview, kpiToScore] = await Promise.all([
    listReviewTasks(ctx),
    listUploadTasks(ctx),
    listKpiFillTasks(ctx.user.id, today),
    listKpiReviewTasks(ctx.user.id, today),
    listKpiScoreTasks(ctx.user.id, today),
  ])
  const sorted = [...uploads].sort(
    (a, b) =>
      Number(isOverdue(b.status, b.dueDate, today)) - Number(isOverdue(a.status, a.dueDate, today)) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      a.createdAt.localeCompare(b.createdAt)
  )
  const changes = sorted.filter((d) => d.status === "changes_requested")
  const pending = sorted.filter((d) => d.status === "pending_upload")
  const reviewByDoc = new Map(reviews.map((r) => [r.document.id, r]))

  return (
    <div className="space-y-8">
      <PageHeader title="My Tasks" description="KPIs to review, score and fill in, reviews waiting for your decision, and documents you have been asked to upload." />

      <div className="flex flex-col gap-8">
      <Section icon={ClipboardCheck} title="KPIs to review" count={kpiToReview.length}>
        <KpiTaskList
          tasks={kpiToReview}
          action="Review"
          empty="No KPI periods are waiting for your approval."
          detail={(t) => (
            <>
              {t.person} · {plural(t.periods)} waiting
              {t.missed > 0 && <span className="font-medium text-destructive"> · {t.missed} with nothing submitted</span>}
            </>
          )}
        />
      </Section>

      <Section icon={ClipboardCheck} title="KPIs to score" count={kpiToScore.length}>
        <KpiTaskList
          tasks={kpiToScore}
          action="Score"
          empty="No KPI periods are waiting for your score."
          detail={(t) => (
            <>
              {t.person} · {plural(t.periods)} waiting
              {t.missed > 0 && <span className="font-medium text-destructive"> · {t.missed} with nothing submitted</span>}
            </>
          )}
        />
      </Section>

      <Section icon={PenLine} title="KPIs to fill in" count={kpiToFill.length}>
        <KpiTaskList
          tasks={kpiToFill}
          action="Fill in"
          empty="No KPI periods are waiting for you."
          detail={(t) => (
            <>
              {plural(t.periods)} open
              {t.overdue > 0 ? (
                <span className="font-medium text-destructive"> · {t.overdue} overdue</span>
              ) : (
                t.nextDue && <> · next due {formatDate(t.nextDue)}</>
              )}
            </>
          )}
        />
      </Section>

      <Section icon={ClipboardCheck} title="To review" count={reviews.length}>
        <DocumentsTable
          compactEmpty
          documents={reviews.map((r) => r.document)}
          columns={["location", "uploader", "version"]}
          emptyText="No reviews are waiting for you."
          action={(d) => {
            const r = reviewByDoc.get(d.id)!
            return (
              <span className="flex items-center justify-end gap-3 whitespace-nowrap">
                <span className="text-xs text-muted-foreground">
                  Step {r.stepOrder}/{r.totalSteps} · {daysSince(r.activatedAt)}d waiting
                </span>
                <Link href={`/documents/${d.id}`} className={buttonVariants({ size: "sm" })}>
                  Review
                </Link>
              </span>
            )
          }}
        />
      </Section>

      <Section icon={MessageSquareWarning} title="Changes requested" count={changes.length}>
        <DocumentsTable
          compactEmpty
          documents={changes}
          columns={["location", "version", "due"]}
          emptyText="Nothing has been sent back to you."
          action={(d) => (
            <Link href={`/documents/${d.id}`} className={buttonVariants({ size: "sm" })}>
              Upload fix
            </Link>
          )}
        />
      </Section>

      <Section icon={FileUp} title="To upload" count={pending.length}>
        <DocumentsTable
          compactEmpty
          documents={pending.slice(0, shown)}
          columns={["location", "due", "pending"]}
          emptyText="No uploads are waiting for you."
          action={(d) => (
            <Link href={`/documents/${d.id}`} className={buttonVariants({ size: "sm" })}>
              Upload
            </Link>
          )}
        />
        {pending.length > shown && <ShowMore shown={shown} />}
      </Section>
      </div>
    </div>
  )
}
