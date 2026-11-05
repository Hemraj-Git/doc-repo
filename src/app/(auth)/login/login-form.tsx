"use client"

import { useActionState } from "react"
import { CircleAlert, Loader2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { signIn, type FormState } from "../actions"

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {})
  const error = state.error ?? (state.fieldErrors ? undefined : initialError)

  return (
    <form action={action} className="grid gap-4" noValidate>
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="next" value={next ?? ""} />
      <FormField
        name="email"
        label="Email"
        type="email"
        autoComplete="username"
        placeholder="name@institute.edu"
        required
        autoFocus
        errors={state.fieldErrors?.email}
      />
      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />
      <Button type="submit" size="lg" disabled={pending} className="mt-2">
        {pending && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
    </form>
  )
}
