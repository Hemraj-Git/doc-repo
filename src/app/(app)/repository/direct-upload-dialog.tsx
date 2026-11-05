"use client"

import { useRef, useState, useTransition } from "react"
import { CircleAlert, Loader2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import { ReviewerList } from "@/components/documents/reviewer-list"
import type { DocumentTypeOption } from "@/components/documents/document-dialog"
import type { PersonItem } from "@/components/person-combobox"
import { finalizeDirectUpload, requestDirectUpload } from "@/app/(app)/documents/actions"
import { ACCEPT_ATTRIBUTE, ACCEPTED_SUMMARY, describeFile, formatBytes, MAX_UPLOAD_BYTES } from "@/lib/files"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

const MAX_FILES = 20

type Item = { key: string; file: File; name: string; referenceId: string; error: string | null }

type Props = {
  folder: { id: string; name: string; standalone: boolean } | null
  onClose: () => void
  documentTypes: DocumentTypeOption[]
  /** Possible reviewers, without the uploader. */
  people: PersonItem[]
}

export function DirectUploadDialog({ folder, onClose, documentTypes, people }: Props) {
  return (
    <Dialog open={Boolean(folder)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        {folder && <UploadForm key={folder.id} folder={folder} onClose={onClose} documentTypes={documentTypes} people={people} />}
      </DialogContent>
    </Dialog>
  )
}

const nameFromFile = (fileName: string) => fileName.replace(/\.[^.]+$/, "").slice(0, 200)

function UploadForm({ folder, onClose, documentTypes, people }: Omit<Props, "folder"> & { folder: NonNullable<Props["folder"]> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [typeId, setTypeId] = useState<string | null>(null)
  const [description, setDescription] = useState("")
  const [review, setReview] = useState(false)
  const [reviewerIds, setReviewerIds] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [, startTransition] = useTransition()
  const busy = progress !== null

  const add = (chosen: File[]) => {
    if (inputRef.current) inputRef.current.value = ""
    const next: Item[] = []
    for (const file of chosen) {
      if (!describeFile(file.name)) toast.error(`“${file.name}” is not an accepted file type.`)
      else if (file.size > MAX_UPLOAD_BYTES) toast.error(`“${file.name}” is larger than 50 MB.`)
      else if (file.size === 0) toast.error(`“${file.name}” is empty.`)
      else next.push({ key: `${file.name}-${file.size}-${file.lastModified}`, file, name: nameFromFile(file.name), referenceId: "", error: null })
    }
    setItems((current) => {
      const known = new Set(current.map((i) => i.key))
      const merged = [...current, ...next.filter((i) => !known.has(i.key))]
      if (merged.length > MAX_FILES) toast.error(`You can upload at most ${MAX_FILES} files at once.`)
      return merged.slice(0, MAX_FILES)
    })
  }
  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const missingName = items.some((i) => !i.name.trim())
  const missingRef = folder.standalone && items.some((i) => !i.referenceId.trim())
  const noReviewer = review && reviewerIds.length === 0
  const canSubmit = items.length > 0 && !!typeId && !missingName && !missingRef && !noReviewer

  const uploadOne = async (item: Item) => {
    const input = {
      name: item.name,
      documentTypeId: typeId!,
      referenceId: item.referenceId,
      description,
      reviewerIds: review ? reviewerIds : [],
    }
    const ticket = await requestDirectUpload(folder.id, item.file.name, item.file.size, input)
    if (!ticket.ok) throw new Error(ticket.fieldErrors?.referenceId ?? ticket.fieldErrors?.name ?? ticket.error)
    const { error } = await createClient()
      .storage.from("documents")
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, item.file, { contentType: ticket.data.contentType })
    if (error) throw new Error(`Upload failed: ${error.message}`)
    const result = await finalizeDirectUpload(folder.id, ticket.data.documentId, ticket.data.path, item.file.name, input)
    if (!result.ok) throw new Error(result.fieldErrors?.referenceId ?? result.error)
  }

  /** One after another. A file that fails stays in the list with its reason, and the rest still go up. */
  const submit = () => {
    setSubmitted(true)
    if (!canSubmit) return
    startTransition(async () => {
      const queue = [...items]
      let uploaded = 0
      for (const [i, item] of queue.entries()) {
        setProgress({ done: i + 1, total: queue.length })
        update(item.key, { error: null })
        try {
          await uploadOne(item)
          uploaded++
          setItems((list) => list.filter((x) => x.key !== item.key))
        } catch (e) {
          update(item.key, { error: e instanceof Error ? e.message : "Upload failed" })
        }
      }
      setProgress(null)
      const failed = queue.length - uploaded
      if (uploaded > 0) {
        const what = uploaded === 1 ? "File" : `${uploaded} files`
        toast.success(review ? `${what} uploaded and sent for review` : `${what} uploaded`)
      }
      if (failed === 0) onClose()
      else toast.error(`${failed} ${failed === 1 ? "file" : "files"} could not be uploaded. See the reason below.`)
    })
  }

  const typeOptions = documentTypes
    .filter((t) => t.isActive)
    .map((t) => ({ value: t.id, label: t.name === t.code ? t.code : `${t.code} — ${t.name}` }))

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Upload to {folder.name}</DialogTitle>
        <DialogDescription>Each file becomes its own document. You will be its uploader and can add new versions later.</DialogDescription>
      </DialogHeader>

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
          if (!busy) add(Array.from(e.dataTransfer.files ?? []))
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
          busy && "pointer-events-none opacity-60"
        )}
      >
        <Upload className="size-5 text-muted-foreground" />
        <span>
          <span className="font-medium text-primary">Choose files</span> or drag them here
        </span>
        <span className="text-xs text-muted-foreground">{ACCEPTED_SUMMARY}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          aria-label="Choose files"
          onChange={(e) => add(Array.from(e.target.files ?? []))}
        />
      </div>

      {items.length > 0 && (
        <ul className="grid gap-2">
          {items.map((item) => (
            <li key={item.key} className={cn("grid gap-2 rounded-lg border p-2.5", item.error && "border-destructive/50")}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate" title={item.file.name}>
                  {item.file.name} · {formatBytes(item.file.size)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${item.file.name}`}
                  disabled={busy}
                  onClick={() => setItems((list) => list.filter((x) => x.key !== item.key))}
                >
                  <X />
                </Button>
              </div>
              <div className={cn("grid gap-2", folder.standalone && "sm:grid-cols-2")}>
                <Input
                  aria-label={`Document name for ${item.file.name}`}
                  placeholder="Document name"
                  maxLength={200}
                  value={item.name}
                  disabled={busy}
                  aria-invalid={(submitted && !item.name.trim()) || undefined}
                  onChange={(e) => update(item.key, { name: e.target.value })}
                />
                {folder.standalone && (
                  <Input
                    aria-label={`Reference ID for ${item.file.name}`}
                    placeholder="Reference ID, e.g. ACD-SYL-2026"
                    className="font-mono"
                    autoComplete="off"
                    maxLength={60}
                    value={item.referenceId}
                    disabled={busy}
                    aria-invalid={(submitted && !item.referenceId.trim()) || undefined}
                    onChange={(e) => update(item.key, { referenceId: e.target.value })}
                  />
                )}
              </div>
              {item.error && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <CircleAlert className="mt-px size-3.5 shrink-0" /> {item.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {submitted && items.length === 0 && <p className="text-xs text-destructive">Choose at least one file.</p>}
      {submitted && missingName && <p className="text-xs text-destructive">Every file needs a document name.</p>}
      {submitted && missingRef && <p className="text-xs text-destructive">Files placed directly in a department each need their own Reference ID.</p>}

      <Field id="upload-type" label="Document type" error={submitted && !typeId ? "Select a document type" : undefined}>
        {(d) => (
          <OptionSelect
            id="upload-type"
            options={typeOptions}
            value={typeId}
            onChange={setTypeId}
            placeholder="Select type"
            disabled={busy}
            invalid={submitted && !typeId}
            aria-describedby={d}
          />
        )}
      </Field>

      <Field id="upload-description" label="Description" optional>
        {(d) => (
          <Textarea id="upload-description" rows={2} maxLength={1000} aria-describedby={d} value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
        )}
      </Field>

      <div className="grid gap-3 rounded-lg border p-3">
        <label className="flex items-start gap-3">
          <Checkbox className="mt-0.5" checked={review} disabled={busy} onCheckedChange={(c) => setReview(Boolean(c))} />
          <span className="grid gap-0.5 text-sm">
            <span className="font-medium">Send for review</span>
            <span className="text-xs text-muted-foreground">
              Reviewers approve in the order below. Without review, the files are available as soon as they are uploaded.
            </span>
          </span>
        </label>
        {review && (
          <div className="grid gap-2 pl-7">
            <ReviewerList id="upload-add-reviewer" people={people} reviewerIds={reviewerIds} onChange={setReviewerIds} locked={busy} />
            {submitted && noReviewer && <p className="text-xs text-destructive">Add at least one reviewer, or turn review off.</p>}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}
          {busy ? `Uploading ${progress.done} of ${progress.total}…` : items.length > 1 ? `Upload ${items.length} files` : "Upload file"}
        </Button>
      </DialogFooter>
    </div>
  )
}
