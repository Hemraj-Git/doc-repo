"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import Script from "next/script"
import { CheckCircle2, Download, Loader2, RotateCcw, SearchX, ShieldAlert, XCircle } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import { formatDateTime } from "@/lib/format"
import { VERIFICATION_PURPOSES } from "@/lib/students"
import type { VerificationResult } from "@/lib/verification/types"
import { verifyCertificate, type VerifyInput } from "./actions"
import { CertificateList, CertificateStatusBadge, StudentSummary } from "./verification-details"

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

const EMPTY = {
  regdNo: "",
  studentName: "",
  certificateNo: "",
  requesterName: "",
  requesterOrg: "",
  requesterEmail: "",
  purpose: VERIFICATION_PURPOSES[0] as string,
}

export function VerifyForm({ siteKey }: { siteKey: string }) {
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)

  const renderWidget = useCallback(() => {
    if (!window.turnstile || !box.current || widget.current) return
    widget.current = window.turnstile.render(box.current, {
      sitekey: siteKey,
      callback: (t: string) => setToken(t),
      "expired-callback": () => setToken(null),
      "error-callback": () => setToken(null),
    })
  }, [siteKey])
  useEffect(renderWidget, [renderWidget])

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [k]: e.target.value })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const response = await verifyCertificate({ ...values, captchaToken: token ?? "" } as VerifyInput)
      // Tokens are single-use.
      setToken(null)
      if (widget.current) window.turnstile?.reset(widget.current)
      if (!response.ok) {
        setErrors(response.fieldErrors ?? {})
        if (!response.fieldErrors) setErrors({ form: response.error })
        return
      }
      setErrors({})
      setResult(response.result)
      window.scrollTo({ top: 0, behavior: "smooth" })
    })
  }

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={renderWidget} />
      {result && <ResultCard result={result} onReset={() => setResult(null)} />}

      <form onSubmit={submit} noValidate className={result ? "hidden" : "grid gap-6 rounded-xl border bg-background p-4 md:p-6"}>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Student</legend>
          <Field id="v-regd" label="Regd No." error={errors.regdNo}>
            {(d) => <Input id="v-regd" autoComplete="off" value={values.regdNo} onChange={set("regdNo")} aria-describedby={d} aria-invalid={Boolean(errors.regdNo) || undefined} />}
          </Field>
          <Field id="v-name" label="Student name" error={errors.studentName} hint="As printed on the certificate.">
            {(d) => (
              <Input id="v-name" autoComplete="off" value={values.studentName} onChange={set("studentName")} aria-describedby={d} aria-invalid={Boolean(errors.studentName) || undefined} />
            )}
          </Field>
          <Field id="v-cert" label="Certificate No." optional error={errors.certificateNo} hint="To confirm one specific certificate.">
            {(d) => <Input id="v-cert" autoComplete="off" value={values.certificateNo} onChange={set("certificateNo")} aria-describedby={d} />}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">You</legend>
          <Field id="v-rname" label="Your name" error={errors.requesterName}>
            {(d) => <Input id="v-rname" autoComplete="name" value={values.requesterName} onChange={set("requesterName")} aria-describedby={d} />}
          </Field>
          <Field id="v-org" label="Organisation" error={errors.requesterOrg}>
            {(d) => <Input id="v-org" autoComplete="organization" value={values.requesterOrg} onChange={set("requesterOrg")} aria-describedby={d} />}
          </Field>
          <Field id="v-email" label="Work email" error={errors.requesterEmail}>
            {(d) => <Input id="v-email" type="email" autoComplete="email" value={values.requesterEmail} onChange={set("requesterEmail")} aria-describedby={d} />}
          </Field>
          <Field id="v-purpose" label="Purpose" error={errors.purpose}>
            {(d) => (
              <OptionSelect
                id="v-purpose"
                options={VERIFICATION_PURPOSES.map((p) => ({ value: p, label: p }))}
                value={values.purpose}
                onChange={(v) => setValues({ ...values, purpose: v ?? VERIFICATION_PURPOSES[0] })}
                aria-describedby={d}
              />
            )}
          </Field>
        </fieldset>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div ref={box} className="min-h-16" />
          <Button type="submit" disabled={pending || !token}>
            {pending && <Loader2 className="animate-spin" />}
            Verify
          </Button>
        </div>
        {errors.form && <p className="text-sm text-destructive">{errors.form}</p>}
        <p className="text-xs text-muted-foreground">
          Your details are recorded with the request and printed on the verification slip. We do not tell the student who verified them.
        </p>
      </form>
    </>
  )
}

function ResultCard({ result, onReset }: { result: VerificationResult; onReset: () => void }) {
  const again = (
    <Button variant="outline" onClick={onReset}>
      <RotateCcw /> Verify another
    </Button>
  )

  if (result.outcome !== "matched") {
    const copy = {
      not_matched: {
        icon: SearchX,
        title: "No record matches these details",
        body: "Check the registration number and the name exactly as printed on the certificate, then try again. If it still does not match, contact the institute.",
      },
      rate_limited: { icon: ShieldAlert, title: "Too many requests", body: "Please wait an hour before trying again, or contact the institute." },
      captcha_failed: { icon: ShieldAlert, title: "Security check failed", body: "Complete the security check and try again." },
    }[result.outcome]
    return (
      <section className="mb-6 grid gap-4 rounded-xl border bg-background p-6">
        <div className="flex items-start gap-3">
          <copy.icon className="mt-0.5 size-6 shrink-0 text-amber-600" />
          <div>
            <h2 className="font-semibold">{copy.title}</h2>
            <p className="text-sm text-muted-foreground">{copy.body}</p>
            <p className="mt-1 text-xs text-muted-foreground">Reference {result.code}</p>
          </div>
        </div>
        <div>{again}</div>
      </section>
    )
  }

  const s = result.snapshot
  const asked = s.certificate_query
  const highlighted = s.certificates.find((c) => c.highlight)
  return (
    <section className="mb-6 grid gap-5 rounded-xl border border-emerald-600/30 bg-background p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-600" />
          <div>
            <h2 className="font-semibold">Record found</h2>
            <p className="text-sm text-muted-foreground">
              Verification ID <span className="font-mono">{result.code}</span> · {formatDateTime(result.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/verify/slip/${result.slipToken}/pdf`} className={buttonVariants()}>
            <Download /> Download verification slip (PDF)
          </a>
          {again}
        </div>
      </div>

      {asked && (
        <div className={`rounded-lg border p-3 text-sm ${highlighted?.status === "issued" ? "border-emerald-600/30 bg-emerald-50" : "border-rose-600/30 bg-rose-50"}`}>
          {highlighted ? (
            <span className="flex flex-wrap items-center gap-2">
              {highlighted.status === "issued" ? <CheckCircle2 className="size-4 text-emerald-700" /> : <XCircle className="size-4 text-rose-700" />}
              Certificate <span className="font-mono">{highlighted.certificate_no}</span> ({highlighted.type}):
              <CertificateStatusBadge c={highlighted} />
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <XCircle className="size-4 text-rose-700" /> Certificate <span className="font-mono">{asked}</span> is not on record for this student.
            </span>
          )}
        </div>
      )}

      <StudentSummary student={s.student} />
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Certificates issued</h3>
        <CertificateList certificates={s.certificates} />
      </div>
    </section>
  )
}
