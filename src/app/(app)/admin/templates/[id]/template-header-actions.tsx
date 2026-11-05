"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import type { TemplateDetailsInput } from "@/lib/validation/templates"
import { deleteTemplate } from "../actions"
import { TemplateDetailsDialog } from "../template-details-dialog"

type Props = {
  template: { id: string } & TemplateDetailsInput
  departments: { id: string; name: string }[]
  usedBy: string[]
}

export function TemplateHeaderActions({ template, departments, usedBy }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  return (
    <>
      <Button variant="outline" onClick={() => setEditing(true)}>
        <Pencil /> Details
      </Button>
      <Button variant="outline" onClick={() => setDeleting(true)} disabled={usedBy.length > 0} title={usedBy.length ? `Used inside: ${usedBy.join(", ")}` : undefined}>
        <Trash2 /> Delete
      </Button>
      <TemplateDetailsDialog open={editing} onOpenChange={setEditing} template={template} departments={departments} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the “${template.name}” template?`}
        description="Folders and requirements already created from it are kept. To stop new use without deleting, mark it inactive instead."
        confirmLabel="Delete template"
        destructive
        onConfirm={async () => {
          const result = await deleteTemplate(template.id)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success("Template deleted")
          router.push("/admin/templates")
        }}
      />
    </>
  )
}
