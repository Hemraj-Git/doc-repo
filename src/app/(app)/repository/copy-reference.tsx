"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

export function CopyReference({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-xs hover:bg-muted"
      title="Copy Reference ID"
    >
      {value}
      {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3 text-muted-foreground" />}
    </button>
  )
}
