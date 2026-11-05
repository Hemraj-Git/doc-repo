import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { listDocumentTypes } from "@/lib/data/repository"
import { DocumentTypesTable } from "./document-types-table"

export const metadata: Metadata = { title: "Document Types" }

export default async function DocumentTypesPage() {
  await requireNavAccess("/admin/document-types")
  const types = await listDocumentTypes()

  return (
    <>
      <PageHeader
        title="Document Types"
        description="Classifications chosen when a document requirement is created — e.g. Doc, Form, QP, Template, CL, QM."
      />
      <DocumentTypesTable types={types} />
    </>
  )
}
