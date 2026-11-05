import Link from "next/link"
import { Building2, ClipboardPlus, FolderPlus, UserPlus } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { hasPerm, type AccessContext } from "@/lib/auth/permissions"
import { cn } from "@/lib/utils"

export function QuickActions({ access }: { access: AccessContext }) {
  const actions = [
    { label: "Department", href: "/admin/departments", icon: Building2, show: hasPerm(access, "department.manage") },
    { label: "User", href: "/admin/users", icon: UserPlus, show: hasPerm(access, "user.manage") },
    {
      label: "Child folder",
      href: "/repository",
      icon: FolderPlus,
      show: hasPerm(access, "folder.create.own_dept", "folder.create.any_dept"),
    },
    {
      label: "Document requirement",
      href: "/requirements",
      icon: ClipboardPlus,
      show: hasPerm(access, "document.create.own_dept", "document.create.any_dept"),
    },
  ].filter((a) => a.show)

  return (
    <div className="grid gap-2">
      {actions.map(({ label, href, icon: Icon }) => (
        <Link key={label} href={href} className={cn(buttonVariants({ variant: "outline" }), "justify-start")}>
          <Icon /> New {label.toLowerCase()}
        </Link>
      ))}
    </div>
  )
}
