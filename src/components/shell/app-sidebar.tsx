"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Anchor } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { AccessContext } from "@/lib/auth/permissions"
import { visibleNav, type NavItem } from "@/lib/nav/config"

type Props = {
  appName: string
  department: { name: string; code: string }
  access: AccessContext
  badges: Partial<Record<NonNullable<NavItem["badge"]>, number>>
}

export function AppSidebar({ appName, department, access, badges }: Props) {
  const pathname = usePathname()
  const groups = visibleNav(access)
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />} tooltip={appName}>
              <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Anchor className="size-4" />
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{appName}</span>
                <span className="truncate text-xs text-muted-foreground">Document Management</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const count = item.badge ? (badges[item.badge] ?? 0) : 0
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={isActive(item.href)}
                        tooltip={item.title}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                      {count > 0 && (
                        <SidebarMenuBadge className="bg-primary text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-active/menu-button:text-primary-foreground">
                          {count}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="rounded-md border bg-background px-3 py-2 text-xs group-data-[collapsible=icon]:hidden">
          <div className="text-muted-foreground">Department</div>
          <div className="truncate font-medium">
            {department.name} <span className="text-muted-foreground">· {department.code}</span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
