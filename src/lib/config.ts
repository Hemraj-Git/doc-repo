export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Marine Institute DMS"
/** Institute's local timezone, used for greetings and displayed timestamps. */
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Kolkata"

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local."
    )
  }
  return { url, key }
}
