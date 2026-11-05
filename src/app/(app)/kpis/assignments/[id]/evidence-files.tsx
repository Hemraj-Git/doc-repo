"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { Check, Download, Eye, FolderSearch, Library, Loader2, Paperclip, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { EntryFile } from "@/lib/data/kpis"
import { STATUS_LABELS, type DocumentStatus } from "@/lib/documents"
import { ACCEPT_ATTRIBUTE, ACCEPTED_SUMMARY, describeFile, formatBytes, MAX_UPLOAD_BYTES, previewKind } from "@/lib/files"
import { MAX_ENTRY_FILES } from "@/lib/kpis"
import { createClient } from "@/lib/supabase/client"
import {
  attachRepositoryFile,
  finalizeEvidenceUpload,
  getEvidenceFileUrl,
  removeEvidenceFile,
  requestEvidenceUpload,
  searchRepository,
  type RepositoryPick,
} from "../../actions"

function FileRow({ file, canDownload, onRemove, removing }: { file: EntryFile; canDownload: boolean; onRemove?: () => void; removing?: boolean }) {
  const [pending, startTransition] = useTransition()
  const download = () =>
    startTransition(async () => {
      const result = await getEvidenceFileUrl(file.id, "download")
      if (!result.ok) return void toast.error(result.error)
      window.location.href = result.data.url
    })
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-1.5 text-sm">
      {file.source === "repository" ? <Library className="size-4 shrink-0 text-muted-foreground" /> : <Paperclip className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate" title={file.fileName}>
        {file.fileName}
      </span>
      {file.source === "repository" && <Badge variant="outline">From repository</Badge>}
      <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(file.sizeBytes)}</span>
      {previewKind(file.fileName) && (
        <Link href={`/kpis/evidence/${file.id}`} aria-label={`Preview ${file.fileName}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
          <Eye />
        </Link>
      )}
      {canDownload && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Download ${file.fileName}`} onClick={download} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Download />}
        </Button>
      )}
      {onRemove && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${file.fileName}`} onClick={onRemove} disabled={removing}>
          {removing ? <Loader2 className="animate-spin" /> : <X />}
        </Button>
      )}
    </li>
  )
}

/** Attached files, read only. */
export function EvidenceList({ files, canDownload }: { files: EntryFile[]; canDownload: boolean }) {
  if (files.length === 0) return null
  return (
    <ul className="grid gap-1.5">
      {files.map((f) => (
        <FileRow key={f.id} file={f} canDownload={canDownload} />
      ))}
    </ul>
  )
}

/** Attached files, with Upload and Choose from repository, in any mix. Same checks as document uploads. */
export function EvidenceEditor({ entryId, files, canDownload }: { entryId: string; files: EntryFile[]; canDownload: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [, startTransition] = useTransition()
  const full = files.length >= MAX_ENTRY_FILES

  const uploadOne = async (file: File) => {
    if (!describeFile(file.name)) throw new Error("This file type is not accepted.")
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Files can be at most 50 MB.")
    if (file.size === 0) throw new Error("The file is empty.")
    const ticket = await requestEvidenceUpload(entryId, file.name, file.size)
    if (!ticket.ok) throw new Error(ticket.error)
    const { error } = await createClient().storage.from("documents").uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: ticket.data.contentType })
    if (error) throw new Error(`Upload failed: ${error.message}`)
    const result = await finalizeEvidenceUpload(entryId, ticket.data.path, file.name)
    if (!result.ok) throw new Error(result.error)
  }

  /** One after another. A file that fails is reported and the rest still go up. */
  const upload = (chosen: File[]) => {
    if (inputRef.current) inputRef.current.value = ""
    if (chosen.length === 0) return
    const room = MAX_ENTRY_FILES - files.length
    if (chosen.length > room) return void toast.error(`You can add ${room} more ${room === 1 ? "file" : "files"} to this period (${MAX_ENTRY_FILES} at most).`)
    startTransition(async () => {
      let attached = 0
      for (const [i, file] of chosen.entries()) {
        setProgress({ done: i + 1, total: chosen.length })
        try {
          await uploadOne(file)
          attached++
        } catch (e) {
          toast.error(`${file.name}: ${e instanceof Error ? e.message : "Upload failed"}`)
        }
      }
      setProgress(null)
      if (attached > 0) toast.success(attached === 1 ? "File attached" : `${attached} files attached`)
    })
  }

  const remove = (id: string) => {
    setRemovingId(id)
    startTransition(async () => {
      const result = await removeEvidenceFile(id)
      setRemovingId(null)
      if (!result.ok) toast.error(result.error)
    })
  }

  return (
    <div className="grid gap-2">
      {files.length > 0 && (
        <ul className="grid gap-1.5">
          {files.map((f) => (
            <FileRow key={f.id} file={f} canDownload={canDownload} onRemove={() => remove(f.id)} removing={removingId === f.id} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={progress !== null || full} onClick={() => inputRef.current?.click()}>
          {progress ? <Loader2 className="animate-spin" /> : <Paperclip />}
          {progress ? `Uploading ${progress.done} of ${progress.total}…` : "Upload files"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={progress !== null || full} onClick={() => setPicking(true)}>
          <FolderSearch /> Choose from repository
        </Button>
        <span className="text-xs text-muted-foreground">{full ? `Up to ${MAX_ENTRY_FILES} files per period.` : ACCEPTED_SUMMARY}</span>
        <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTRIBUTE} className="sr-only" onChange={(e) => upload(Array.from(e.target.files ?? []))} aria-label="Upload files" />
      </div>
      {picking && (
        <RepositoryPicker
          entryId={entryId}
          attachedIds={files.flatMap((f) => (f.source === "repository" && f.documentId ? [f.documentId] : []))}
          room={MAX_ENTRY_FILES - files.length}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

/** Searches documents the person can already see and attaches their current files. Stays open to pick several. */
function RepositoryPicker({ entryId, attachedIds, room, onClose }: { entryId: string; attachedIds: string[]; room: number; onClose: () => void }) {
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<RepositoryPick[] | null>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const [, startTransition] = useTransition()
  const attached = new Set([...attachedIds, ...added])
  // attachedIds catches up with `added` when the page refreshes, so count only the new ones.
  const left = room - added.filter((id) => !attachedIds.includes(id)).length

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await searchRepository(q)
      if (cancelled) return
      if (result.ok) setRows(result.data)
      else toast.error(result.error)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q])

  const attach = (id: string) => {
    setAttaching(id)
    startTransition(async () => {
      const result = await attachRepositoryFile(entryId, id)
      setAttaching(null)
      if (!result.ok) return void toast.error(result.error)
      setAdded((a) => [...a, id])
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose from repository</DialogTitle>
          <DialogDescription>Attach as many as you need. Each is attached as it is now, so later changes to that document don&apos;t change what you submitted.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Document name or reference ID" className="pl-8" aria-label="Search documents" />
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
          {rows === null && (
            <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </li>
          )}
          {rows?.length === 0 && <li className="p-3 text-sm text-muted-foreground">No documents with a file match. You can only choose documents you can already see.</li>}
          {rows?.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 p-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[d.referenceId, d.department, STATUS_LABELS[d.status as DocumentStatus]].filter(Boolean).join(" · ")}
                </span>
              </span>
              {attached.has(d.id) ? (
                <span className="flex items-center gap-1 px-2 text-sm text-success-text">
                  <Check className="size-4" /> Attached
                </span>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => attach(d.id)} disabled={attaching !== null || left <= 0}>
                  {attaching === d.id && <Loader2 className="animate-spin" />}
                  Attach
                </Button>
              )}
            </li>
          ))}
        </ul>
        <DialogFooter>
          {left <= 0 && <span className="mr-auto self-center text-xs text-muted-foreground">This period has reached {MAX_ENTRY_FILES} files.</span>}
          <Button type="button" onClick={onClose} disabled={attaching !== null}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
