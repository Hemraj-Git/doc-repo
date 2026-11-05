"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"

/** Global search box: submits to /search. Press "/" anywhere to focus it. */
export function HeaderSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState(pathname === "/search" ? (params.get("q") ?? "") : "")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      if (e.key === "/" && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <form
      role="search"
      className="relative w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault()
        const term = q.trim()
        if (term) router.push(`/search?q=${encodeURIComponent(term)}`)
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search documents, folders or Ref ID…"
        className="pr-8 pl-8"
        aria-label="Search documents, folders or Reference ID"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:block">
        /
      </kbd>
    </form>
  )
}
