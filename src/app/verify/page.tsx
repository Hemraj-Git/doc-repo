import { turnstileSiteKey } from "@/lib/verification/site"
import { VerifyForm } from "./verify-form"

export default function VerifyPage() {
  const siteKey = turnstileSiteKey()
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Verify a certificate</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          For employers, background-verification agencies and other institutions. Enter the student’s registration number and name exactly as they
          appear on the certificate. If they match our records you will see the certificates we have issued and can download a verification slip.
        </p>
      </div>
      {siteKey ? (
        <VerifyForm siteKey={siteKey} />
      ) : (
        <p className="rounded-lg border border-warning-line bg-warning-soft p-4 text-sm text-warning-text">
          Verification is not available right now. Please contact the institute.
        </p>
      )}
    </div>
  )
}
