import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { supabaseEnv } from "@/lib/config"

/** Supabase client acting as the signed-in user (RLS applies). Create one per request. */
export async function createClient() {
  const { url, key } = supabaseEnv()
  const cookieStore = await cookies()

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  })
}
