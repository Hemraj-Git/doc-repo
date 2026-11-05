import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

const REASONS = new Set(["inactive", "no-profile"])

// Used when a session exists but the account may not use the app
// (deactivated, or an auth user without a profile).
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const reason = request.nextUrl.searchParams.get("reason")
  const target = new URL("/login", request.url)
  if (reason && REASONS.has(reason)) target.searchParams.set("error", reason)
  return NextResponse.redirect(target)
}
