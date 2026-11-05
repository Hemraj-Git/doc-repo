import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Folder, FolderTree } from "lucide-react"
import { requireNavAccess } from "@/lib/auth/guards"
import { canCreateDocuments, canManageFolderAccess, canManageFolders } from "@/lib/auth/permissions"
import {
  folderAncestors,
  getFolder,
  getRepositoryDepartment,
  listRepositoryDepartments,
  listSubfolders,
} from "@/lib/data/repository"
import { formatDateTime } from "@/lib/format"
import { Breadcrumbs, type Crumb } from "../../breadcrumbs"
import { CopyReference } from "../../copy-reference"
import { FolderAccessButton } from "../../folder-access-dialog"
import { FolderDocumentsSection } from "../../folder-documents-section"
import { FolderList } from "../../folder-list"
import { InstancePanel } from "../../instance/instance-panel"

export async function generateMetadata({ params }: PageProps<"/repository/[dept]/[folderId]">): Promise<Metadata> {
  const { folderId } = await params
  const folder = await getFolder(folderId)
  return { title: folder ? `${folder.name} · Repository` : "Repository" }
}

export default async function FolderPage({ params }: PageProps<"/repository/[dept]/[folderId]">) {
  const { dept, folderId } = await params
  const [ctx, department, folder] = await Promise.all([requireNavAccess("/repository"), getRepositoryDepartment(dept), getFolder(folderId)])
  if (!department || !folder || folder.level === "root" || folder.departmentId !== department.id) notFound()

  const [ancestors, subfolders, visible] = await Promise.all([
    folderAncestors(folder.id),
    folder.allowSubfolders ? listSubfolders(folder.id) : Promise.resolve([]),
    listRepositoryDepartments(),
  ])
  const canManage = canManageFolders(ctx, department.id)

  const crumbs: Crumb[] = [
    ...(visible.length > 1 ? [{ label: "Repository", href: "/repository" }] : []),
    ...ancestors.map((a) => ({
      label: a.name,
      href: a.level === "root" ? `/repository/${department.code}` : `/repository/${department.code}/${a.id}`,
    })),
    { label: folder.name },
  ]

  const typeLabel = folder.depth === 1 ? "Folder" : "Sub-folder"

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumbs items={crumbs} />
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {folder.allowSubfolders ? <FolderTree className="size-5" /> : <Folder className="size-5" />}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{folder.name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {folder.referenceId && <CopyReference value={folder.referenceId} />}
              <span>
                {typeLabel}
                {folder.allowSubfolders ? " with sub-folders" : ""}
              </span>
              <span>
                Created {formatDateTime(folder.createdAt)}
                {folder.createdBy && ` by ${folder.createdBy.fullName}`}
              </span>
            </div>
            {folder.description && <p className="max-w-2xl text-sm text-muted-foreground">{folder.description}</p>}
          </div>
          {!folder.isPrivate && canManageFolderAccess(ctx, department.id) && <FolderAccessButton folder={{ id: folder.id, name: folder.name }} />}
        </div>
      </div>

      <InstancePanel ctx={ctx} folder={folder} departmentCode={department.code} />

      {folder.allowSubfolders && (
        <FolderList
          title="Sub-folders"
          folders={subfolders}
          parent={{ id: folder.id, level: folder.level, depth: folder.depth, name: folder.name, referenceId: folder.referenceId }}
          departmentCode={department.code}
          canManage={canManage}
          templateHref={
            canManage && canCreateDocuments(ctx, department.id)
              ? `/repository/${department.code}/new-from-template?in=${folder.id}`
              : undefined
          }
          emptyText={
            canManage
              ? folder.depth === 1
                ? `No sub-folders yet. Create one per programme, student or employee — its Reference ID will be “${folder.referenceId} (Name)”.`
                : "No sub-folders yet."
              : "No sub-folders yet."
          }
        />
      )}

      <FolderDocumentsSection
        ctx={ctx}
        folder={{ id: folder.id, name: folder.name, standalone: false }}
        departmentId={department.id}
      />
    </div>
  )
}
