"use client"

import { useState, useTransition } from "react"
import { Check, ClipboardCheck, Loader2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { FileFormat } from "@/lib/files"
import { decideReview } from "../actions"
import { FileButtons } from "./file-buttons"

type Props = {
  documentId: string
  stepId: string
  stepOrder: number
  totalSteps: number
  version: { id: string; versionNo: number; fileName: string; fileFormat: FileFormat }
  canDownload: boolean
}

export function ReviewPanel({ documentId, stepId, stepOrder, totalSteps, version, canDownload }: Props) {
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null)
  const isLast = stepOrder === totalSteps

  const decide = (approve: boolean) =>
    startTransition(async () => {
      setError(null)
      if (!approve && !comment.trim()) {
        setError("Explain what needs to change so the uploader can fix it.")
        return
      }
      setDeciding(approve ? "approve" : "reject")
      const result = await decideReview(documentId, stepId, approve, comment)
      setDeciding(null)
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success(
        approve
          ? isLast
            ? "Approved — the document is now approved"
            : "Approved — sent to the next reviewer"
          : "Changes requested — the uploader has been notified"
      )
    })

  return (
    <Card className="ring-2 ring-sky-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="size-4" /> Your review
        </CardTitle>
        <CardDescription>
          You are reviewer {stepOrder} of {totalSteps}
          {isLast ? " — your approval completes the review." : "."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <span className="min-w-0">
            <span className="font-medium">Version {version.versionNo}</span>
            <span className="block truncate text-xs text-muted-foreground">{version.fileName}</span>
          </span>
          <FileButtons documentId={documentId} versionId={version.id} fileName={version.fileName} canDownload={canDownload} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="review-comment">
            Comment <span className="font-normal text-muted-foreground">(required when requesting changes)</span>
          </Label>
          <Textarea
            id="review-comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={pending}
            aria-invalid={Boolean(error) || undefined}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => decide(true)} disabled={pending}>
            {deciding === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve
          </Button>
          <Button type="button" variant="destructive" onClick={() => decide(false)} disabled={pending}>
            {deciding === "reject" ? <Loader2 className="animate-spin" /> : <Undo2 />} Request changes
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
