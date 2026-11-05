import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { getInstituteSettings } from "@/lib/data/settings"
import { supabaseEnv } from "@/lib/config"
import { LogoCard } from "./logo-card"
import { SettingsForm } from "./settings-form"

export const metadata: Metadata = { title: "Institute Settings" }

export default async function SettingsPage() {
  await requireNavAccess("/admin/settings")
  const s = await getInstituteSettings()

  return (
    <>
      <PageHeader
        title="Institute Settings"
        description="Institute details for the verification portal and slips, and the academic year used for recurring requirements."
      />
      <SettingsForm
        canEdit
        initial={{
          instituteName: s.instituteName,
          address: s.address ?? "",
          contactEmail: s.contactEmail ?? "",
          academicYearStartMonth: s.academicYearStartMonth,
        }}
      />
      <div className="mt-6">
        <LogoCard logoUrl={s.logoPath ? `${supabaseEnv().url}/storage/v1/object/public/branding/${s.logoPath}` : null} canEdit />
      </div>
    </>
  )
}
