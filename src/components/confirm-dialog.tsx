"use client"

import { useState, useTransition } from "react"
import { Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  destructive?: boolean
  /** Return false (or throw) to keep the dialog open. */
  onConfirm: () => Promise<boolean | void>
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, onConfirm }: Props) {
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  const confirm = () =>
    startTransition(async () => {
      setBusy(true)
      try {
        const keepOpen = (await onConfirm()) === false
        if (!keepOpen) onOpenChange(false)
      } finally {
        setBusy(false)
      }
    })

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending || busy}>Cancel</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={pending || busy}>
            {(pending || busy) && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
