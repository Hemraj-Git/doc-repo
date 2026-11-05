"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DocumentDialog, type DocumentDialogMode, type DocumentTypeOption } from "@/components/documents/document-dialog"
import type { PersonItem } from "@/components/person-combobox"

type Props = {
  mode: Extract<DocumentDialogMode, { kind: "edit" }>
  documentTypes: DocumentTypeOption[]
  people: PersonItem[]
}

export function EditDocumentButton({ mode, documentTypes, people }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil /> Edit requirement
      </Button>
      <DocumentDialog mode={open ? mode : null} onClose={() => setOpen(false)} documentTypes={documentTypes} people={people} />
    </>
  )
}
