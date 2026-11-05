import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { requireAppContext } from "@/lib/auth/session"
import { ChangePasswordForm } from "./change-password-form"

export const metadata: Metadata = { title: "Change password" }

export default async function ChangePasswordPage() {
  const ctx = await requireAppContext()
  const forced = ctx.user.mustChangePassword

  return (
    <div className="space-y-6">
      {!forced && (
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to dashboard
        </Link>
      )}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {forced ? "Set your password" : "Change password"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {forced
            ? `Welcome, ${ctx.user.fullName}. Replace the temporary password from your administrator before continuing.`
            : `Signed in as ${ctx.user.email}.`}
        </p>
      </div>
      <ChangePasswordForm />
    </div>
  )
}
