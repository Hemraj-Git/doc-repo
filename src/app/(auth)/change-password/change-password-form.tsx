"use client"

import { useActionState } from "react"
import { CircleAlert, Loader2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { changePassword, type FormState } from "../actions"

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {})

  return (
    <form action={action} className="grid gap-4" noValidate>
      {state.error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <FormField
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        errors={state.fieldErrors?.currentPassword}
      />
      <FormField
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 8 characters, with upper- and lowercase letters and a digit."
        errors={state.fieldErrors?.newPassword}
      />
      <FormField
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />
      <Button type="submit" size="lg" disabled={pending} className="mt-2">
        {pending && <Loader2 className="animate-spin" />}
        Update password
      </Button>
    </form>
  )
}
