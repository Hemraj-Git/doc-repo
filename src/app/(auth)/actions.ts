"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getAppContext } from "@/lib/auth/session"
import { changePasswordSchema, safeNextPath, signInSchema } from "@/lib/validation/auth"

export type FormState = {
  error?: string
  fieldErrors?: Record<string, string[] | undefined>
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })
  if (error) return { error: "Invalid email or password." }

  const { data: ctx } = await supabase.rpc("my_context")
  if (!ctx || !ctx.profile?.is_active) {
    await supabase.auth.signOut()
    return {
      error: ctx
        ? "Your account has been deactivated. Contact the administrator."
        : "Your account has not been set up yet. Contact the administrator.",
    }
  }

  await supabase.rpc("log_auth_event", { p_action: "login" })
  redirect(ctx.profile.must_change_password ? "/change-password" : safeNextPath(parsed.data.next))
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getAppContext()
  if (!ctx) redirect("/login")

  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors }

  const supabase = await createClient()

  // Supabase does not check the old password on update, so verify it first.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: ctx.user.email,
    password: parsed.data.currentPassword,
  })
  if (verifyError) return { fieldErrors: { currentPassword: ["Current password is incorrect"] } }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword })
  if (error) return { error: error.message }

  await supabase.rpc("mark_password_changed")
  await supabase.rpc("log_auth_event", { p_action: "password_change" })
  redirect("/dashboard?notice=password-changed")
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.rpc("log_auth_event", { p_action: "logout" })
  await supabase.auth.signOut()
  redirect("/login")
}
