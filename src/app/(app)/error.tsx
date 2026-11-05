"use client"

import { useEffect } from "react"
import Link from "next/link"
import { CircleAlert, RotateCw } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"

/**
 * Keeps the sidebar and header when a page fails (e.g. a brief network error reaching
 * Supabase), instead of replacing the whole app with Next.js's error screen.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <CircleAlert className="size-10 text-destructive" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">This page could not be loaded</h1>
        <p className="text-sm text-muted-foreground">
          It may be a brief connection problem. Try again, and if it keeps happening, tell your administrator
          {error.digest ? ` (reference ${error.digest})` : ""}.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>
          <RotateCw /> Try again
        </Button>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Go to the dashboard
        </Link>
      </div>
    </div>
  )
}
