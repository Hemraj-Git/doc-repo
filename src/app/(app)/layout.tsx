import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppHeader } from "@/components/shell/app-header"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { requireAppContext } from "@/lib/auth/session"
import { APP_NAME } from "@/lib/config"
import { getTaskCounts, listNotifications } from "@/lib/data/documents"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext()
  if (ctx.user.mustChangePassword) redirect("/change-password")

  const [cookieStore, counts, notifications] = await Promise.all([cookies(), getTaskCounts(), listNotifications()])
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false"
  const access = { permissions: ctx.permissions, isHod: ctx.isHod, hasSubordinates: ctx.hasSubordinates }

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>
      <AppSidebar
        appName={APP_NAME}
        department={ctx.department}
        access={access}
        badges={{ tasks: counts.toUpload + counts.toReview + counts.kpiToFill + counts.kpiToReview + counts.kpiToScore }}
      />
      <SidebarInset>
        <AppHeader
          user={ctx.user}
          roles={ctx.roles.map((r) => r.name)}
          notifications={notifications}
          unreadNotifications={counts.unreadNotifications}
        />
        <div id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 p-4 outline-none md:p-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
