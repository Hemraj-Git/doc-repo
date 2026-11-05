"use client"

import { useTransition } from "react"
import Link from "next/link"
import { Download, Eye, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import { previewKind } from "@/lib/files"
import { getFileUrl } from "../actions"

type Props = {
  documentId: string
  versionId: string
  fileName: string
  canDownload: boolean
  /** Hidden on the preview page itself. */
  showPreview?: boolean
  size?: "sm" | "default"
}

/** Preview (in-app viewer) and Download buttons. Each use is recorded in the audit trail. */
export function FileButtons({ documentId, versionId, fileName, canDownload, showPreview = true, size = "sm" }: Props) {
  const [pending, startTransition] = useTransition()

  const download = () =>
    startTransition(async () => {
      const result = await getFileUrl(versionId, "download")
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      window.location.href = result.data.url
    })

  return (
    <span className="inline-flex gap-1.5">
      {showPreview && previewKind(fileName) && (
        <Link href={`/documents/${documentId}/preview/${versionId}`} className={buttonVariants({ variant: "outline", size })}>
          <Eye /> Preview
        </Link>
      )}
      {canDownload && (
        <Button type="button" variant="outline" size={size} onClick={download} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Download />} Download
        </Button>
      )}
    </span>
  )
}
