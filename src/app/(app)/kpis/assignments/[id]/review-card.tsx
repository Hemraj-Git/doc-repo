"use client"

import { useState, useTransition } from "react"
import { Ban, Check, ClipboardCheck, Forward, Loader2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { approveEntry, markEntryNotApplicable, returnEntry } from "../../actions"
import { EntryEvidence, type ScoreEntry } from "./score-card"

/**
 * The reviewer's decision on one period: approve or send back what was submitted. A period
 * past its due date with nothing new submitted can be forwarded to the scorer instead.
 */
export function ReviewCard({ entry, canDownload, canSendBack }: { entry: ScoreEntry; canDownload: boolean; canSendBack: boolean }) {
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [acting, setActing] = useState<"approve" | "return" | "na" | null>(null)
  const [forwarding, setForwarding] = useState(false)
  const submitted = entry.status === "submitted"

  const act = (kind: "approve" | "return" | "na") =>
    startTransition(async () => {
      setError(null)
      if (kind === "return" && !comment.trim()) return setError("Explain what needs to change so they can fix it.")
      if (kind === "na" && !comment.trim()) return setError("Write the reason it is not applicable.")
      setActing(kind)
      const result = kind === "approve" ? await approveEntry(entry.id, comment) : kind === "return" ? await returnEntry(entry.id, comment) : await markEntryNotApplicable(entry.id, comment)
      setActing(null)
      if (!result.ok) {
        setError(result.error)
        return void toast.error(result.error)
      }
      toast.success(kind === "approve" ? "Approved and sent to the scorer" : kind === "return" ? "Sent back. They have been notified." : "Marked not applicable")
    })

  return (
    <li className="grid gap-3 rounded-xl border bg-card p-4 ring-2 ring-info-line">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          <h3 className="font-medium">{entry.areaName}</h3>
          <Badge>{entry.weightage}%</Badge>
          <span className="text-sm text-muted-foreground">{entry.periodLabel}</span>
        </div>
        {entry.measured && <p className="text-sm whitespace-pre-line text-muted-foreground">What is measured: {entry.measured}</p>}
      </div>

      <EntryEvidence entry={entry} canDownload={canDownload} />

      <div className="grid gap-1.5">
        <Label htmlFor={`review-${entry.id}`}>
          Comment{" "}
          <span className="font-normal text-muted-foreground">
            ({[canSendBack ? "required to send back" : null, "required for not applicable", "optional otherwise"].filter(Boolean).join(", ")})
          </span>
        </Label>
        <Textarea id={`review-${entry.id}`} rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} disabled={pending} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {submitted ? (
          <Button type="button" size="sm" onClick={() => act("approve")} disabled={pending}>
            {acting === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => setForwarding(true)} disabled={pending}>
            <Forward /> Forward to scorer
          </Button>
        )}
        {canSendBack && (
          <Button type="button" size="sm" variant="outline" onClick={() => act("return")} disabled={pending}>
            {acting === "return" ? <Loader2 className="animate-spin" /> : <Undo2 />} Send back
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => act("na")} disabled={pending}>
          {acting === "na" ? <Loader2 className="animate-spin" /> : <Ban />} Not applicable
        </Button>
      </div>

      <ConfirmDialog
        open={forwarding}
        onOpenChange={setForwarding}
        title="Forward to the scorer?"
        description={`${entry.periodLabel} of ${entry.areaName} passed its due date with nothing new submitted. Once forwarded, the person can no longer submit it, and the scorer gives it a score or marks it not applicable.`}
        confirmLabel="Forward"
        onConfirm={async () => {
          const result = await approveEntry(entry.id, comment)
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success("Forwarded to the scorer")
        }}
      />
    </li>
  )
}
