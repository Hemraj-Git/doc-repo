import "server-only"
import { notFound } from "next/navigation"
import { requireAppContext } from "@/lib/auth/session"
import { findNavItem } from "@/lib/nav/config"

/**
 * Page guard that applies the same visibility rule as the sidebar entry for href.
 * Hidden pages respond 404 rather than revealing that they exist.
 */
export async function requireNavAccess(href: string) {
  const ctx = await requireAppContext()
  const item = findNavItem(href)
  if (!item) throw new Error(`No nav item registered for ${href}`)
  if (item.visible && !item.visible(ctx)) notFound()
  return ctx
}
