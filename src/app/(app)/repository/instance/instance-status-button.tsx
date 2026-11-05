"use client"

import { useState } from "react"
import { Archive, ArchiveRestore } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { setInstanceStatus } from "../template-actions"

/** Close (stop all recurring generation) or reopen a folder created from a template. */
export function InstanceStatusButton({ instanceId, name, active }: { instanceId: string; name: string; active: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {active ? <Archive /> : <ArchiveRestore />}
        {active ? "Close" : "Reopen"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={active ? `Close ${name}?` : `Reopen ${name}?`}
        description={
          active
            ? "No new weekly, monthly, semester or yearly requirements will be created here or in anything inside it. Existing files and open requirements stay as they are."
            : "Recurring files restart from the current period. Periods missed while it was closed are not created."
        }
        confirmLabel={active ? "Close" : "Reopen"}
        destructive={active}
        onConfirm={async () => {
          const result = await setInstanceStatus(instanceId, !active)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success(
            active ? `${name} closed` : `${name} reopened${result.data.created ? ` · ${result.data.created} requirements created` : ""}`
          )
        }}
      />
    </>
  )
}
