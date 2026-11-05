import { canCreateDocuments } from "@/lib/auth/permissions"
import type { AppContext } from "@/lib/auth/session"
import { listFolderDocuments } from "@/lib/data/documents"
import { getMyFolderAccess } from "@/lib/data/folder-access"
import { listPeoplePicker } from "@/lib/data/org"
import { listDocumentTypes } from "@/lib/data/repository"
import { FolderDocuments } from "./folder-documents"

/** Loads a folder's documents and, for people who may create or upload them, the forms' options. */
export async function FolderDocumentsSection({
  ctx,
  folder,
  departmentId,
}: {
  ctx: AppContext
  folder: { id: string; name: string; standalone: boolean }
  departmentId: string
}) {
  const canCreate = canCreateDocuments(ctx, departmentId)
  const [documents, access] = await Promise.all([listFolderDocuments(folder.id), getMyFolderAccess(folder.id)])
  const canUpload = access === "write"
  const needsOptions = canCreate || canUpload
  const [documentTypes, people] = await Promise.all([
    needsOptions ? listDocumentTypes() : Promise.resolve([]),
    needsOptions ? listPeoplePicker() : Promise.resolve([]),
  ])

  return (
    <FolderDocuments
      folder={folder}
      documents={documents}
      canCreate={canCreate}
      canUpload={canUpload}
      documentTypes={documentTypes}
      people={people}
      myId={ctx.user.id}
    />
  )
}
