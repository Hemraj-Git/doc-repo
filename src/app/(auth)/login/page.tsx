import type { Metadata } from "next"
import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Sign in" }

const ERRORS: Record<string, string> = {
  inactive: "Your account has been deactivated. Contact the administrator.",
  "no-profile": "Your account has not been set up yet. Contact the administrator.",
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams
  const nextPath = typeof next === "string" ? next : undefined
  const errorText = typeof error === "string" ? ERRORS[error] : undefined

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Use the email and password provided by your administrator.
        </p>
      </div>
      <LoginForm next={nextPath} initialError={errorText} />
      <p className="text-xs text-muted-foreground">
        Forgot your password? Ask the administrator to reset it.
      </p>
    </div>
  )
}
