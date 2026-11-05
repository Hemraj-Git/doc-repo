import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { canCreateDocuments, canManageFolders } from "@/lib/auth/permissions"
import { APP_TIMEZONE } from "@/lib/config"
import { entryFromInstance, templateBundleFor } from "@/lib/data/instances"
import { listPeoplePicker } from "@/lib/data/org"
import { getFolder, getRepositoryDepartment } from "@/lib/data/repository"
import { Breadcrumbs } from "../../breadcrumbs"
import { Wizard } from "../../new-from-template/wizard"

export const metadata: Metadata = { title: "New from template" }

export default async function NewFromTemplatePage({ params, searchParams }: PageProps<"/repository/[dept]/new-from-template">) {
  const ctx = await requireNavAccess("/repository")
  const { dept } = await params
  const { in: inFolder, from } = await searchParams
  const department = await getRepositoryDepartment(dept)
  if (!department) notFound()
  if (!canManageFolders(ctx, department.id) || !canCreateDocuments(ctx, department.id)) notFound()

  // Inside a folder (?in=<id>) or directly in the department.
  const folderId = typeof inFolder === "string" ? inFolder : null
  const folder = folderId ? await getFolder(folderId) : null
  if (folderId && (!folder || folder.departmentId !== department.id || !folder.allowSubfolders)) notFound()

  const parent = folder
    ? { id: folder.id, name: folder.name, depth: folder.depth, referenceId: folder.referenceId }
    : { id: department.rootFolderId, name: department.name, depth: 0, referenceId: null }

  const [bundle, people, source] = await Promise.all([
    templateBundleFor(department.id),
    listPeoplePicker(),
    typeof from === "string" ? entryFromInstance(from) : Promise.resolve(null),
  ])
  // Duplicating only works while the source template is still available here.
  const initial =
    source && bundle.available.includes(source.templateId)
      ? { templateId: source.templateId, entry: source.entry, sourceName: source.name }
      : undefined
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(new Date())

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: department.name, href: `/repository/${department.code}` },
            ...(folder ? [{ label: folder.name, href: `/repository/${department.code}/${folder.id}` }] : []),
            { label: "New from template" },
          ]}
        />
        <PageHeader
          title="New from template"
          description={`Creates the folders and file requirements of a template inside ${parent.name} in one step.`}
        />
      </div>
      <Wizard departmentCode={department.code} parent={parent} bundle={bundle} people={people} today={today} initial={initial} />
    </div>
  )
}
