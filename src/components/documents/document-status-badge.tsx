import { Badge } from "@/components/ui/badge"
import { STATUS_LABELS, STATUS_STYLES, type DocumentStatus } from "@/lib/documents"
import { cn } from "@/lib/utils"

export function DocumentStatusBadge({ status, unreviewed, className }: { status: DocumentStatus; unreviewed?: boolean; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STATUS_STYLES[status], className)}>
      {status === "approved" && unreviewed ? "Uploaded" : STATUS_LABELS[status]}
    </Badge>
  )
}
