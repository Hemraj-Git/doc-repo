"use client"

import { useEffect, useRef, useState } from "react"
import { CircleAlert, Info, Loader2 } from "lucide-react"
import { getFileUrl } from "@/app/(app)/documents/actions"
import { getEvidenceFileUrl } from "@/app/(app)/kpis/actions"
import { formatBytes, type PreviewKind } from "@/lib/files"

/** A document version, or a file attached to a KPI period (which has its own access check). */
type Props = { versionId?: string; kpiFileId?: string; fileName: string; kind: PreviewKind }

/** Reads the response body, reporting "Loading file… 42% of 10.7 MB" so large files don't look stuck. */
async function readWithProgress(res: Response, report: (message: string) => void): Promise<ArrayBuffer> {
  const total = Number(res.headers.get("content-length")) || 0
  if (!res.body || !total) return res.arrayBuffer()
  const reader = res.body.getReader()
  const bytes = new Uint8Array(total)
  let received = 0
  let shown = -1
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (received + value.byteLength > total) return new Blob([bytes.subarray(0, received), value]).arrayBuffer() // length header was wrong
    bytes.set(value, received)
    received += value.byteLength
    const pct = Math.floor((received / total) * 100)
    if (pct !== shown) {
      shown = pct
      report(`Loading file… ${pct}% of ${formatBytes(total)}`)
    }
  }
  return received === total ? bytes.buffer : bytes.slice(0, received).buffer
}

type State =
  | { phase: "loading"; message: string }
  | { phase: "ready"; blobUrl?: string; note?: string }
  | { phase: "error"; message: string }

/**
 * Fetches the file once (logged as a "view") and shows it:
 *  - PDFs and images in the browser's own viewer, from a local blob URL
 *  - Word / Excel / PowerPoint in the sandboxed /preview/frame iframe
 */
export function FilePreview({ versionId, kpiFileId, fileName, kind }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<State>({ phase: "loading", message: "Loading file…" })
  const office = kind === "docx" || kind === "sheet" || kind === "pptx"

  useEffect(() => {
    let cancelled = false
    let blobUrl: string | undefined
    let buffer: ArrayBuffer | null = null
    let frameReady = false

    const sendToFrame = () => {
      if (!buffer || !frameReady || !frameRef.current?.contentWindow) return
      setState({ phase: "loading", message: "Rendering…" })
      frameRef.current.contentWindow.postMessage({ type: "render", kind, fileName, buffer }, "*", [buffer])
      buffer = null
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.source !== "dms-preview") return
      const msg = event.data as { type: string; note?: string; message?: string }
      if (msg.type === "ready") {
        frameReady = true
        sendToFrame()
      } else if (msg.type === "rendered") {
        setState({ phase: "ready", note: msg.note })
      } else if (msg.type === "error") {
        setState({ phase: "error", message: `This file could not be previewed (${msg.message}). Download it to open it.` })
      }
    }
    if (office) window.addEventListener("message", onMessage)

    ;(async () => {
      const link = kpiFileId ? await getEvidenceFileUrl(kpiFileId, "view") : await getFileUrl(versionId ?? "", "view")
      if (cancelled) return
      if (!link.ok) return setState({ phase: "error", message: link.error })
      const res = await fetch(link.data.url)
      if (!res.ok) return setState({ phase: "error", message: "The file could not be loaded. Please try again." })
      const bytes = await readWithProgress(res, (message) => !cancelled && setState({ phase: "loading", message }))
      if (cancelled) return

      if (office) {
        buffer = bytes
        sendToFrame()
      } else {
        const type = kind === "pdf" ? "application/pdf" : (res.headers.get("content-type") ?? "image/*")
        blobUrl = URL.createObjectURL(new Blob([bytes], { type }))
        setState({ phase: "ready", blobUrl })
      }
    })().catch(() => !cancelled && setState({ phase: "error", message: "The file could not be loaded. Please try again." }))

    return () => {
      cancelled = true
      window.removeEventListener("message", onMessage)
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [versionId, kpiFileId, fileName, kind, office])

  return (
    <div className="relative h-[calc(100svh-12rem)] min-h-[28rem] overflow-hidden rounded-xl border bg-muted/30">
      {office && (
        <iframe
          ref={frameRef}
          src="/preview/frame"
          title={`Preview of ${fileName}`}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          onLoad={(e) => e.currentTarget.contentWindow?.postMessage({ type: "hello" }, "*")}
          className="size-full border-0"
          style={{ visibility: state.phase === "ready" ? "visible" : "hidden" }}
        />
      )}
      {state.phase === "ready" && kind === "pdf" && state.blobUrl && (
        <iframe src={state.blobUrl} title={`Preview of ${fileName}`} className="size-full border-0" />
      )}
      {state.phase === "ready" && kind === "image" && state.blobUrl && (
        <div className="flex size-full items-center justify-center overflow-auto p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, not optimisable */}
          <img src={state.blobUrl} alt={fileName} className="max-h-full max-w-full rounded-md shadow-sm" />
        </div>
      )}

      {state.phase === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {state.message}
        </div>
      )}
      {state.phase === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="flex max-w-md items-start gap-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> {state.message}
          </p>
        </div>
      )}
      {state.phase === "ready" && state.note && (
        <p className="absolute right-3 bottom-3 left-3 flex items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm">
          <Info className="size-3.5 shrink-0" /> {state.note}
        </p>
      )}
    </div>
  )
}
