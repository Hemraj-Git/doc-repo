import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { listDepartments } from "@/lib/data/org"
import { listSchedulerRuns, schedulerIsStale } from "@/lib/data/scheduler"
import { listTemplates } from "@/lib/data/templates"
import { SchedulerCard } from "./scheduler-card"
import { TemplatesList } from "./templates-list"

export const metadata: Metadata = { title: "Templates" }

export default async function TemplatesPage() {
  await requireNavAccess("/admin/templates")
  const [templates, departments, runs] = await Promise.all([listTemplates(), listDepartments(), listSchedulerRuns(10)])

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable folder structures with their file requirements. HODs create programs, subjects, employee files and more from them."
      />
      <SchedulerCard runs={runs} stale={schedulerIsStale(runs)} />
      <TemplatesList templates={templates} departments={departments.map((d) => ({ id: d.id, name: d.name }))} />
    </>
  )
}
