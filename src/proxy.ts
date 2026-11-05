import type { NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // /preview/* is the sandboxed renderer: static code, no data, loaded in an iframe.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|preview/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
