"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Bell, CheckCheck, ClipboardCheck, Eye, FileCheck2, FileUp, Gauge, MessageSquareWarning, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { markNotificationsRead } from "@/app/(app)/documents/actions"
import type { NotificationRow } from "@/lib/data/documents"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  upload_requested: FileUp,
  review_requested: ClipboardCheck,
  changes_requested: MessageSquareWarning,
  document_approved: FileCheck2,
  document_uploaded: FileCheck2,
  kpi_to_fill: Gauge,
  kpi_to_review: ClipboardCheck,
  kpi_to_score: ClipboardCheck,
  kpi_no_scorer: MessageSquareWarning,
  kpi_missed: Gauge,
  kpi_reviewed: Gauge,
  kpi_scores_released: Eye,
}

export function NotificationsMenu({ notifications, unread }: { notifications: NotificationRow[]; unread: number }) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const open = (n: NotificationRow) =>
    startTransition(async () => {
      // Unread with a link: the action marks it read and redirects, in one round trip.
      if (!n.readAt) await markNotificationsRead([n.id], n.link ?? undefined)
      else if (n.link) router.push(n.link)
    })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} />
        }
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute -top-1 left-1/2 flex min-w-4 ring-2 ring-card items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-medium text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            Notifications
            {unread > 0 && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-normal text-primary hover:underline"
                onClick={() => startTransition(async () => void (await markNotificationsRead()))}
              >
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {notifications.map((n) => {
              const Icon = ICONS[n.type] ?? Bell
              return (
                <DropdownMenuItem key={n.id} onClick={() => open(n)} className="items-start gap-2.5 py-2">
                  <Icon className={cn("mt-0.5", n.readAt ? "text-muted-foreground" : "text-primary")} />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className={cn("truncate text-sm", !n.readAt && "font-medium")}>{n.title}</span>
                    {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
                    <span className="text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </DropdownMenuItem>
              )
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
