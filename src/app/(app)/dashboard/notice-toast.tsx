"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

const NOTICES: Record<string, string> = {
  "password-changed": "Your password has been updated.",
}

/** Shows a one-off toast for ?notice=… and removes the parameter from the URL. */
export function NoticeToast({ notice }: { notice?: string }) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!notice || !NOTICES[notice]) return
    toast.success(NOTICES[notice])
    router.replace(pathname)
  }, [notice, pathname, router])

  return null
}
