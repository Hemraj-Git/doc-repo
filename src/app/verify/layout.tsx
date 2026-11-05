import type { Metadata } from "next"
import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { publicInstitute } from "@/lib/verification/site"

// Branding and the CAPTCHA key are read per request, not frozen at build time.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Certificate verification",
  robots: { index: false, follow: false },
}

/** Public, sign-in-free pages: branding only, no app navigation. */
export default async function VerifyLayout({ children }: { children: React.ReactNode }) {
  const institute = await publicInstitute()
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          {institute.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo from the public branding bucket
            <img src={institute.logoUrl} alt="" className="h-10 w-auto max-w-32 object-contain" />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <Link href="/verify" className="block truncate font-semibold">
              {institute.name}
            </Link>
            <p className="text-xs text-muted-foreground">Certificate verification</p>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t bg-background">
        <div className="mx-auto max-w-4xl px-4 py-4 text-xs text-muted-foreground">
          {institute.address && <p className="whitespace-pre-line">{institute.address}</p>}
          {institute.contactEmail && (
            <p>
              Questions about a verification:{" "}
              <a href={`mailto:${institute.contactEmail}`} className="text-primary hover:underline">
                {institute.contactEmail}
              </a>
            </p>
          )}
          <p className="mt-1">Every verification request is logged.</p>
        </div>
      </footer>
    </div>
  )
}
