import Link from "next/link"
import { FileQuestion } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"

/** Shown inside the app shell for missing records and pages the user may not see. */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <FileQuestion className="size-10 text-muted-foreground" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Not found</h1>
        <p className="text-sm text-muted-foreground">
          This page does not exist, or you do not have access to it.
        </p>
      </div>
      <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
        Go to the dashboard
      </Link>
    </div>
  )
}
