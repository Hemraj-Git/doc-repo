"use client"

import { useRef, useState, useTransition } from "react"
import { FileUp, Loader2, MessageSquareWarning, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ACCEPT_ATTRIBUTE, ACCEPTED_SUMMARY, describeFile, formatBytes, MAX_UPLOAD_BYTES } from "@/lib/files"
import type { DocumentStatus } from "@/lib/documents"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { finalizeUpload, requestUpload } from "../actions"

type Props = {
  documentId: string
  status: DocumentStatus
  nextVersion: number
  requiresReview: boolean
  /** The reviewer's comment when changes were requested. */
  changeRequest: { reviewer: string; comment: string | null } | null
}

type Stage = "idle" | "preparing" | "uploading" | "verifying"

const STAGE_LABEL: Record<Stage, string> = {
  idle: "",
  preparing: "Preparing…",
  uploading: "Uploading…",
  verifying: "Verifying file…",
}

export function UploadPanel({ documentId, status, nextVersion, requiresReview, changeRequest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [stage, setStage] = useState<Stage>("idle")
  const [, startTransition] = useTransition()
  const busy = stage !== "idle"

  const pick = (f: File | undefined | null) => {
    setError(null)
    if (!f) return setFile(null)
    if (!describeFile(f.name)) return setError(`“${f.name}” is not an accepted file type.`)
    if (f.size > MAX_UPLOAD_BYTES) return setError("Files can be at most 50 MB.")
    if (f.size === 0) return setError("The file is empty.")
    setFile(f)
  }

  const upload = () =>
    startTransition(async () => {
      if (!file) return
      setError(null)
      try {
        setStage("preparing")
        const ticket = await requestUpload(documentId, file.name, file.size)
        if (!ticket.ok) throw new Error(ticket.error)

        setStage("uploading")
        const { error: uploadError } = await createClient()
          .storage.from("documents")
          .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: ticket.data.contentType })
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

        setStage("verifying")
        const result = await finalizeUpload(documentId, ticket.data.path, file.name, note)
        if (!result.ok) throw new Error(result.error)

        toast.success(
          requiresReview ? `Version ${nextVersion} uploaded and sent for review` : `Version ${nextVersion} uploaded`
        )
        setFile(null)
        setNote("")
      } catch (e) {
        const message = e instanceof Error ? e.message : "Upload failed"
        setError(message)
        toast.error(message)
      } finally {
        setStage("idle")
      }
    })

  const title =
    status === "pending_upload"
      ? "Upload the document"
      : status === "changes_requested"
        ? "Upload a corrected version"
        : "Upload a revised version"

  return (
    <Card className={cn(status !== "approved" && "ring-2 ring-primary/30")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileUp className="size-4" /> {title}
        </CardTitle>
        <CardDescription>
          You are the assigned uploader. This becomes version {nextVersion}
          {requiresReview ? " and is sent to the first reviewer." : "."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {changeRequest && (
          <div className="flex gap-2 rounded-lg border border-danger-line bg-danger-soft p-3 text-sm text-danger-text">
            <MessageSquareWarning className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">{changeRequest.reviewer} requested changes</div>
              {changeRequest.comment && <p className="whitespace-pre-wrap">{changeRequest.comment}</p>}
            </div>
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (!busy) pick(e.dataTransfer.files?.[0])
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
            busy && "pointer-events-none opacity-60"
          )}
        >
          <Upload className="size-5 text-muted-foreground" />
          {file ? (
            <span className="font-medium">
              {file.name} <span className="font-normal text-muted-foreground">· {formatBytes(file.size)}</span>
            </span>
          ) : (
            <span>
              <span className="font-medium text-primary">Choose a file</span> or drag it here
            </span>
          )}
          <span className="text-xs text-muted-foreground">{ACCEPTED_SUMMARY}</span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>

        {file && !busy && (
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => pick(null)}>
            <X /> Remove file
          </Button>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="version-note">
            Note for this version <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="version-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={status === "changes_requested" ? "What did you change?" : "e.g. Final draft for semester 1"}
            disabled={busy}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="button" onClick={upload} disabled={!file || busy} className="justify-self-start">
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}
          {busy ? STAGE_LABEL[stage] : `Upload version ${nextVersion}`}
        </Button>
      </CardContent>
    </Card>
  )
}
