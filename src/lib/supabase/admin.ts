import "server-only"
import { createClient } from "@supabase/supabase-js"
import { supabaseEnv } from "@/lib/config"

// supabase-js refuses to start without a global WebSocket (Node < 22). The admin
// client never uses realtime, so give it a stand-in on older runtimes.
class NoRealtime {
  constructor() {
    throw new Error("Realtime is not available on the admin client")
  }
}

/**
 * Service-role client that BYPASSES Row Level Security. Use it only for Supabase
 * Auth admin calls, Storage, the service-role-only functions that record files the
 * server has checked, and the public verification portal. Do all other table writes
 * with the user's own client so RLS applies and the audit log records the right actor.
 */
export function createAdminClient() {
  const { url } = supabaseEnv()
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!secret) throw new Error("Missing SUPABASE_SECRET_KEY in .env.local")

  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: globalThis.WebSocket ?? NoRealtime },
  })
}
