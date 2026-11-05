import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { canCreateDocuments, canManageFolderAccess, canManageFolders } from "@/lib/auth/permissions"
import { getRepositoryDepartment, listRepositoryDepartments, listSubfolders } from "@/lib/data/repository"
import { Breadcrumbs } from "../breadcrumbs"
import { FolderAccessButton } from "../folder-access-dialog"
import { FolderDocumentsSection } from "../folder-documents-section"
import { FolderList } from "../folder-list"

export async function generateMetadata({ params }: PageProps<"/repository/[dept]">): Promise<Metadata> {
  const { dept } = await params
  const department = await getRepositoryDepartment(dept)
  return { title: department ? `${department.name} · Repository` : "Repository" }
}

export default async function DepartmentRepositoryPage({ params }: PageProps<"/repository/[dept]">) {
  const { dept } = await params
  const [ctx, department, visible] = await Promise.all([requireNavAccess("/repository"), getRepositoryDepartment(dept), listRepositoryDepartments()])
  if (!department) notFound()

  const folders = await listSubfolders(department.rootFolderId)
  const canManage = canManageFolders(ctx, department.id)

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumbs
          items={[...(visible.length > 1 ? [{ label: "Repository", href: "/repository" }] : []), { label: department.name }]}
        />
        <PageHeader
          title={department.name}
          description={
            canManage
              ? "Create child folders with a Reference ID. Tick “Allow sub-folders” for folders organised per programme, student or employee."
              : "The folders of this department that you can see. Only the department head or an administrator can create folders."
          }
          actions={
            canManageFolderAccess(ctx, department.id) ? <FolderAccessButton folder={{ id: department.rootFolderId, name: department.name }} /> : undefined
          }
        />
      </div>

      <FolderList
        title="Folders"
        folders={folders}
        parent={{ id: department.rootFolderId, level: "root", depth: 0, name: department.name, referenceId: null }}
        departmentCode={department.code}
        canManage={canManage}
        templateHref={canManage && canCreateDocuments(ctx, department.id) ? `/repository/${department.code}/new-from-template` : undefined}
        emptyText={canManage ? "No folders yet. Create the first one." : "No folders yet."}
      />

      <FolderDocumentsSection
        ctx={ctx}
        folder={{ id: department.rootFolderId, name: department.name, standalone: true }}
        departmentId={department.id}
      />
    </div>
  )
}
