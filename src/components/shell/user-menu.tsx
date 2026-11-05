"use client"

import { useTransition } from "react"
import Link from "next/link"
import { ChevronDown, KeyRound, LogOut } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
import { signOut } from "@/app/(auth)/actions"

type Props = {
  user: { fullName: string; email: string; designation: string | null }
  roles: string[]
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")
}

export function UserMenu({ user, roles }: Props) {
  const [pending, startTransition] = useTransition()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-9 gap-2 px-1.5" />}>
        <Avatar className="size-7">
          <AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials(user.fullName)}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{user.fullName}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-0.5 py-2 font-normal">
            <div className="truncate text-sm font-medium text-foreground">{user.fullName}</div>
            <div className="truncate">{user.email}</div>
            {user.designation && <div className="truncate">{user.designation}</div>}
            <div className="flex flex-wrap gap-1 pt-1.5">
              {roles.map((r) => (
                <span key={r} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
                  {r}
                </span>
              ))}
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/change-password" />}>
          <KeyRound /> Change password
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onClick={() => startTransition(() => signOut())}
        >
          <LogOut /> {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
