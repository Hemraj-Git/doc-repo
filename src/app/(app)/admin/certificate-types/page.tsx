import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { listCertificateTypes } from "@/lib/data/students"
import { CertificateTypesTable } from "./certificate-types-table"

export const metadata: Metadata = { title: "Certificate Types" }

export default async function CertificateTypesPage() {
  await requireNavAccess("/admin/certificate-types")
  const types = await listCertificateTypes()

  return (
    <>
      <PageHeader
        title="Certificate Types"
        description="Kinds of certificate issued to students — marksheets, diplomas, STCW courses. Choose whether each needs a semester and whether its result is shown on the public portal."
      />
      <CertificateTypesTable types={types} />
    </>
  )
}
