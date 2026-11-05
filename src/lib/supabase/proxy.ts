import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { supabaseEnv } from "@/lib/config"

const PUBLIC_PATHS = ["/login", "/auth", "/verify"]

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** Refreshes the auth session cookie and guards private routes. */
export async function updateSession(request: NextRequest) {
  const { url, key } = supabaseEnv()
  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v))
      },
    },
  })

  // Must run before anything else: verifies the JWT and refreshes it if needed.
  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)
  const { pathname, search } = request.nextUrl

  const redirectTo = (path: string, params?: Record<string, string>) => {
    const target = request.nextUrl.clone()
    target.pathname = path
    target.search = params ? `?${new URLSearchParams(params)}` : ""
    const res = NextResponse.redirect(target)
    // Carry over any refreshed session cookies.
    response.cookies.getAll().forEach((c) => res.cookies.set(c))
    return res
  }

  if (!signedIn && !isPublic(pathname)) {
    return redirectTo("/login", pathname === "/" ? undefined : { next: `${pathname}${search}` })
  }
  if (signedIn && pathname === "/login" && !request.nextUrl.searchParams.has("error")) {
    return redirectTo("/dashboard")
  }

  return response
}
