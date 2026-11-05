import "server-only"
import { createHmac } from "node:crypto"
import { headers } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"

/** Absolute base URL for QR codes and slips: NEXT_PUBLIC_SITE_URL, else the request's host. */
export async function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "")
  if (configured) return configured
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}

// Cloudflare's documented test keys: always pass. Used only outside production.
const TEST_SITE_KEY = "1x00000000000000000000AA"
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA"
const isProduction = process.env.NODE_ENV === "production"

export function turnstileSiteKey() {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || (isProduction ? null : TEST_SITE_KEY)
}

/** Verifies a Turnstile token with Cloudflare. */
export async function verifyTurnstile(token: string, ip: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY || (isProduction ? null : TEST_SECRET_KEY)
  if (!secret || !token) return false
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (ip) body.set("remoteip", ip)
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, cache: "no-store" })
    const json = (await res.json()) as { success?: boolean }
    return json.success === true
  } catch {
    return false
  }
}

export async function requestMeta() {
  const h = await headers()
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null
  return { ip, userAgent: h.get("user-agent") ?? "" }
}

/** IPs are stored only as a keyed hash: enough to rate-limit, not to identify. */
export function hashIp(ip: string | null) {
  const salt = process.env.VERIFY_IP_SALT || process.env.SUPABASE_SECRET_KEY || "dms"
  return createHmac("sha256", salt).update(ip ?? "unknown").digest("hex")
}

export type PublicInstitute = { name: string; address: string | null; contactEmail: string | null; logoUrl: string | null }

/** Institute branding for the public pages (no sign-in needed). */
export async function publicInstitute(): Promise<PublicInstitute> {
  const admin = createAdminClient()
  const { data } = await admin.rpc("public_institute")
  const i = (data ?? {}) as { name?: string; address?: string | null; contact_email?: string | null; logo_path?: string | null }
  return {
    name: i.name ?? "Marine Institute",
    address: i.address ?? null,
    contactEmail: i.contact_email ?? null,
    logoUrl: i.logo_path ? admin.storage.from("branding").getPublicUrl(i.logo_path).data.publicUrl : null,
  }
}
