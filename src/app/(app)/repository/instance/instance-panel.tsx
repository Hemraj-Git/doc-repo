import Link from "next/link"
import { Copy, LayoutTemplate } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { canCreateDocuments, canManageFolders } from "@/lib/auth/permissions"
import type { AppContext } from "@/lib/auth/session"
import { folderTemplateContext, loadTracker, slotNeedsDates, templateBundleFor } from "@/lib/data/instances"
import { listPeoplePicker } from "@/lib/data/org"
import type { FolderRow } from "@/lib/data/repository"
import { getInstituteSettings } from "@/lib/data/settings"
import { formatDate, todayIso } from "@/lib/format"
import { AddEntryDialog } from "./add-entry-dialog"
import { InstanceDatesButton } from "./instance-dates-button"
import { InstanceStatusButton } from "./instance-status-button"
import { ProgramTracker } from "./program-tracker"
import { SeriesList } from "./series-list"

/** On folders created from a template: where it came from, "Add <entry>" for its slots, its tracker and recurring files. */
export async function InstancePanel({ ctx, folder, departmentCode }: { ctx: AppContext; folder: FolderRow; departmentCode: string }) {
  const context = await folderTemplateContext(folder)
  if (!context) return null
  const { instance, slots, isRoot } = context
  const canManage = canManageFolders(ctx, folder.departmentId) && canCreateDocuments(ctx, folder.departmentId)
  const active = instance.status === "active"

  const [bundle, people, tracker, settings, datesRequired] = await Promise.all([
    canManage && active && slots.length ? templateBundleFor(folder.departmentId) : Promise.resolve(null),
    canManage ? listPeoplePicker() : Promise.resolve([]),
    isRoot ? loadTracker(instance) : Promise.resolve(null),
    getInstituteSettings(),
    canManage && isRoot ? slotNeedsDates(instance.slotNodeId) : Promise.resolve(false),
  ])
  const series = tracker?.series ?? []
  // Only top-level instances can be duplicated; nested ones are added through their slot.
  const duplicateHref =
    canManage && isRoot && !instance.parentInstanceId && instance.templateId && folder.parentId
      ? `/repository/${departmentCode}/new-from-template?in=${folder.parentId}&from=${instance.id}`
      : null

  return (
    <div className="space-y-6">
      {isRoot && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-muted/20 px-4 py-3 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <LayoutTemplate className="size-4 text-primary" /> Created from “{instance.templateName}”
          </span>
          <span className="text-muted-foreground">
            From {formatDate(instance.startDate)}
            {instance.endDate ? ` to ${formatDate(instance.endDate)}` : ""}
            {instance.slotOwner ? ` · ${instance.slotOwner}` : ""}
            {!active ? " · closed" : ""}
          </span>
          {canManage && (
            <span className="ml-auto flex gap-2">
              {duplicateHref && (
                <Link href={duplicateHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <Copy /> Duplicate
                </Link>
              )}
              <InstanceDatesButton
                instanceId={instance.id}
                name={instance.name}
                startDate={instance.startDate}
                endDate={instance.endDate}
                endRequired={datesRequired}
              />
              <InstanceStatusButton instanceId={instance.id} name={instance.name} active={active} />
            </span>
          )}
        </div>
      )}

      {bundle && slots.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {slots.map((s) => (
            <AddEntryDialog
              key={s.id}
              instanceId={instance.id}
              slot={s}
              bundle={bundle}
              people={people}
              departmentCode={departmentCode}
              parent={{ name: instance.name, start: instance.startDate, end: instance.endDate ?? "", isEntry: Boolean(instance.slotNodeId) }}
              today={todayIso()}
            />
          ))}
        </div>
      )}

      {tracker && series.length > 0 && (
        <Tabs defaultValue="tracker">
          <TabsList>
            <TabsTrigger value="tracker">Tracker</TabsTrigger>
            <TabsTrigger value="series">Recurring files ({series.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="tracker" className="pt-3">
            <ProgramTracker series={series} view={tracker.view} startMonth={settings.academicYearStartMonth} today={todayIso()} />
          </TabsContent>
          <TabsContent value="series" className="pt-3">
            <SeriesList series={series} departmentCode={departmentCode} canManage={canManage} people={people} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
