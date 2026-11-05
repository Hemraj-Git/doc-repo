"use client"

import { useRef, useTransition } from "react"
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { setInstituteLogo } from "./actions"

/** The logo on the public verification portal and on verification slips. */
export function LogoCard({ logoUrl, canEdit }: { logoUrl: string | null; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()

  const save = (file: File | null) =>
    startTransition(async () => {
      const data = new FormData()
      if (file) data.set("logo", file)
      const result = await setInstituteLogo(data)
      if (!result.ok) return void toast.error(result.error)
      toast.success(file ? "Logo updated" : "Logo removed")
    })

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="size-4" /> Logo
        </CardTitle>
        <CardDescription>Shown on the public verification portal and printed on verification slips. PNG or JPEG, up to 800 KB.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-40 items-center justify-center rounded-lg border bg-muted/30">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- from the public branding bucket
            <img src={logoUrl} alt="Institute logo" className="max-h-16 max-w-36 object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">No logo</span>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ""
                if (f) save(f)
              }}
            />
            <Button variant="outline" onClick={() => input.current?.click()} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Upload />}
              {logoUrl ? "Replace" : "Upload"}
            </Button>
            {logoUrl && (
              <Button variant="ghost" onClick={() => save(null)} disabled={pending}>
                <Trash2 /> Remove
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
