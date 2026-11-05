import type { Metadata } from "next"
import { PageHeader } from "@/components/page-header"
import { requireNavAccess } from "@/lib/auth/guards"
import { listGroups } from "@/lib/data/folder-access"
import { listPeoplePicker } from "@/lib/data/org"
import { GroupsView } from "./groups-view"

export const metadata: Metadata = { title: "Groups" }

export default async function GroupsPage() {
  await requireNavAccess("/admin/groups")
  const [groups, people] = await Promise.all([listGroups(), listPeoplePicker()])

  return (
    <>
      <PageHeader
        title="Groups"
        description="Named groups of people from any department, e.g. Exam Committee. Give a group access to a folder with Manage access on the folder's page. Groups give folder access only, no other rights."
      />
      <GroupsView groups={groups} people={people} />
    </>
  )
}
