"use client"

import { useState } from "react"
import { Check, Copy, KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Props = {
  credentials: { title: string; email: string; password: string } | null
  onClose: () => void
}

/** Shows a temporary password exactly once, with a copy button. */
export function TempPasswordDialog({ credentials, onClose }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!credentials) return
    await navigator.clipboard.writeText(`Email: ${credentials.email}\nTemporary password: ${credentials.password}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={Boolean(credentials)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> {credentials?.title}
          </DialogTitle>
          <DialogDescription>
            Share these sign-in details with the user. The password is shown only once and must be changed at first
            sign-in.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="truncate font-medium">{credentials?.email}</dd>
          <dt className="text-muted-foreground">Password</dt>
          <dd className="font-mono text-base font-semibold tracking-wider">{credentials?.password}</dd>
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy details"}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
