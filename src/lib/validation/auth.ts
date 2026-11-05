import { z } from "zod"

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
})

// Keep in sync with supabase/config.toml [auth] password rules.
export const newPasswordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .regex(/[a-z]/, "At least one lowercase letter")
  .regex(/[A-Z]/, "At least one uppercase letter")
  .regex(/[0-9]/, "At least one digit")

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from the current one",
  })

/** Only allow same-site relative redirects after login. */
export function safeNextPath(next: string | undefined | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard"
  return next
}
