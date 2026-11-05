"use client"

import { useEffect } from "react"
import { CircleAlert, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * For pages outside the signed-in app, such as sign-in and the public verify pages, when
 * something fails (e.g. a brief network error reaching Supabase).
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <CircleAlert className="size-10 text-destructive" />
      <div className="max-w-md space-y-1">
        <h1 className="text-lg font-semibold">This page could not be loaded</h1>
        <p className="text-sm text-muted-foreground">
          It may be a brief connection problem. Please try again{error.digest ? ` (reference ${error.digest})` : ""}.
        </p>
      </div>
      <Button onClick={() => retry()}>
        <RotateCw /> Try again
      </Button>
    </main>
  )
}
