import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashIp, requestMeta } from "./site"
import type { CertificateCheck, Slip } from "./types"

/** A matched verification, re-read from the stored record. */
export async function getSlip(token: string): Promise<Slip | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const { data } = await createAdminClient().rpc("public_slip", { p_token: token })
  return (data as Slip | null) ?? null
}

/** A certificate's QR link. Each check is logged. */
export async function checkCertificate(token: string): Promise<CertificateCheck> {
  const { ip, userAgent } = await requestMeta()
  const { data, error } = await createAdminClient().rpc("public_certificate_by_token", {
    p_token: /^[0-9a-f]{64}$/.test(token) ? token : "",
    p_ip_hash: hashIp(ip),
    p_user_agent: userAgent,
  })
  if (error) throw new Error("The verification service is unavailable.")
  const r = data as { outcome: CertificateCheck["outcome"]; code: string; created_at: string; snapshot: CertificateCheck["snapshot"] }
  return { outcome: r.outcome, code: r.code, createdAt: r.created_at, snapshot: r.snapshot }
}
