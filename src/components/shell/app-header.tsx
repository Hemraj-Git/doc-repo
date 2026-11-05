import { Suspense } from "react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import type { NotificationRow } from "@/lib/data/documents"
import { HeaderSearch } from "./header-search"
import { NotificationsMenu } from "./notifications-menu"
import { UserMenu } from "./user-menu"

type Props = {
  user: { fullName: string; email: string; designation: string | null }
  roles: string[]
  notifications: NotificationRow[]
  unreadNotifications: number
}

export function AppHeader({ user, roles, notifications, unreadNotifications }: Props) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <Suspense>
        <HeaderSearch />
      </Suspense>
      <div className="ml-auto flex items-center gap-1">
        <NotificationsMenu notifications={notifications} unread={unreadNotifications} />
        <UserMenu user={user} roles={roles} />
      </div>
    </header>
  )
}
