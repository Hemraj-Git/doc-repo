"use client"

import { useState, useTransition } from "react"
import { Ban, Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { markNotApplicable, reopenDocument } from "../actions"

/** "Mark not applicable" for open documents (e.g. a holiday week), "Reopen" for managers. */
export function NotApplicableControls({
  documentId,
  canMark,
  canReopen,
}: {
  documentId: string
  canMark: boolean
  canReopen: boolean
}) {
  const [marking, setMarking] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const mark = () =>
    startTransition(async () => {
      setError(null)
      const result = await markNotApplicable(documentId, reason)
      if (!result.ok) {
        setError(result.fieldErrors?.reason ?? result.error)
        return
      }
      toast.success("Marked not applicable")
      setMarking(false)
      setReason("")
    })

  return (
    <>
      {canMark && (
        <Button variant="outline" onClick={() => setMarking(true)}>
          <Ban /> Not applicable
        </Button>
      )}
      {canReopen && (
        <Button variant="outline" onClick={() => setReopening(true)}>
          <RotateCcw /> Reopen
        </Button>
      )}

      <Dialog open={marking} onOpenChange={setMarking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as not applicable</DialogTitle>
            <DialogDescription>
              Use this when no file is needed for this document — for example a holiday or exam week. The reason is kept
              in the document&apos;s history.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="na-reason">Reason</Label>
            <Textarea
              id="na-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Diwali holidays — no classes this week"
              aria-invalid={Boolean(error) || undefined}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarking(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={mark} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Mark not applicable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={reopening}
        onOpenChange={setReopening}
        title="Reopen this document?"
        description="It goes back to waiting for an upload, and the uploader is notified."
        confirmLabel="Reopen"
        onConfirm={async () => {
          const result = await reopenDocument(documentId)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success("Reopened — the uploader has been notified")
        }}
      />
    </>
  )
}
