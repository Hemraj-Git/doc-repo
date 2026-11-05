import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"
import { requireNavAccess } from "@/lib/auth/guards"
import { listTemplateInstances } from "@/lib/data/instances"
import { listDepartments, listPeoplePicker } from "@/lib/data/org"
import { listDocumentTypes } from "@/lib/data/repository"
import { getTemplate, getTemplateNodes, listTemplates } from "@/lib/data/templates"
import { formatDateTime } from "@/lib/format"
import { buildTree, type TemplateNode } from "@/lib/templates"
import { TemplateBuilder } from "../template-builder"
import { TemplatePreview } from "../template-preview"
import { TemplateHeaderActions } from "./template-header-actions"
import { TemplateInstances } from "./template-instances"

export async function generateMetadata({ params }: PageProps<"/admin/templates/[id]">): Promise<Metadata> {
  const { id } = await params
  const t = await getTemplate(id)
  return { title: t ? `${t.template.name} · Templates` : "Templates" }
}

/** Nodes of every template reachable through slots (for the nested preview), a few levels deep. */
async function collectSlotNodes(nodes: TemplateNode[]) {
  const out: Record<string, TemplateNode[]> = {}
  let frontier = [...new Set(nodes.filter((n) => n.kind === "slot" && n.slotTemplateId).map((n) => n.slotTemplateId!))]
  for (let level = 0; level < 3 && frontier.length; level++) {
    const fetched = await getTemplateNodes(frontier.filter((id) => !(id in out)))
    Object.assign(out, fetched)
    frontier = [
      ...new Set(
        Object.values(fetched)
          .flat()
          .filter((n) => n.kind === "slot" && n.slotTemplateId && !(n.slotTemplateId in out))
          .map((n) => n.slotTemplateId!)
      ),
    ]
  }
  return out
}

export default async function TemplatePage({ params }: PageProps<"/admin/templates/[id]">) {
  const { id } = await params
  const [, data] = await Promise.all([requireNavAccess("/admin/templates"), getTemplate(id)])
  if (!data) notFound()
  const { template, nodes } = data

  const [all, departments, types, people, slotNodes, instances] = await Promise.all([
    listTemplates(),
    listDepartments(),
    listDocumentTypes({ activeOnly: true }),
    listPeoplePicker(),
    collectSlotNodes(nodes),
    listTemplateInstances(template.id),
  ])
  const self = all.find((t) => t.id === template.id)
  const usedBy = self?.usedBy ?? []
  const tree = buildTree(nodes)
  const templateInfo = Object.fromEntries(all.map((t) => [t.id, { name: t.name, instanceLabel: t.instanceLabel }]))
  const deptName = new Map(departments.map((d) => [d.id, d.name]))

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/templates" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Templates
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{template.name}</h1>
              <StatusBadge active={template.isActive} />
            </div>
            <p className="text-sm text-muted-foreground">
              Instances are named by “{template.instanceLabel}” ·{" "}
              {template.departmentIds?.length
                ? `Available to ${template.departmentIds.map((d) => deptName.get(d) ?? "?").join(", ")}`
                : "Available to every department"}{" "}
              · edited {formatDateTime(template.updatedAt)}
            </p>
            {usedBy.length > 0 && <p className="text-xs text-muted-foreground">Used as a slot inside: {usedBy.join(", ")}</p>}
            {template.description && <p className="max-w-3xl text-sm">{template.description}</p>}
          </div>
          <div className="flex gap-2">
            <TemplateHeaderActions
              template={{
                id: template.id,
                name: template.name,
                description: template.description ?? "",
                instanceLabel: template.instanceLabel,
                departmentIds: template.departmentIds ?? [],
                allowExtraFolders: template.allowExtraFolders,
                isActive: template.isActive,
              }}
              departments={departments.map((d) => ({ id: d.id, name: d.name }))}
              usedBy={usedBy}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <TemplateBuilder
          templateId={template.id}
          tree={tree}
          nodes={nodes}
          usedAsSlot={usedBy.length > 0}
          documentTypes={types.map((t) => ({ value: t.id, label: t.name === t.code ? t.code : `${t.code} — ${t.name}` }))}
          otherTemplates={all.filter((t) => t.id !== template.id).map((t) => ({ value: t.id, label: t.name }))}
          people={people}
          templateNames={Object.fromEntries(all.map((t) => [t.id, t.name]))}
        />
        <TemplatePreview instanceLabel={template.instanceLabel} tree={tree} slotNodes={slotNodes} templates={templateInfo} />
      </div>

      <TemplateInstances templateId={template.id} version={template.version} instances={instances} />
    </div>
  )
}
