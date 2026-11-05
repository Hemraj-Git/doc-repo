import { createBrowserClient } from "@supabase/ssr"
import { supabaseEnv } from "@/lib/config"

export function createClient() {
  const { url, key } = supabaseEnv()
  return createBrowserClient(url, key)
}
