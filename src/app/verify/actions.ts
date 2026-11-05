"use server"

import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { VERIFICATION_PURPOSES } from "@/lib/students"
import { hashIp, requestMeta, verifyTurnstile } from "@/lib/verification/site"
import type { VerificationResult, VerificationSnapshot } from "@/lib/verification/types"

const schema = z.object({
  regdNo: z.string().trim().min(1, "Enter the Regd No.").max(60),
  studentName: z.string().trim().min(2, "Enter the student's name").max(160),
  certificateNo: z.string().trim().max(80),
  requesterName: z.string().trim().min(2, "Enter your name").max(120),
  requesterOrg: z.string().trim().min(2, "Enter your organisation").max(160),
  requesterEmail: z.email("Enter a valid email address").max(160),
  purpose: z.enum(VERIFICATION_PURPOSES),
  captchaToken: z.string(),
})
export type VerifyInput = z.input<typeof schema>

type Response = { ok: true; result: VerificationResult } | { ok: false; error: string; fieldErrors?: Record<string, string> }

/** The public verification form. Runs on the server; the database never sees the public directly. */
export async function verifyCertificate(input: VerifyInput): Promise<Response> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors }
  }
  const v = parsed.data
  const { ip, userAgent } = await requestMeta()
  const captchaOk = await verifyTurnstile(v.captchaToken, ip)

  const { data, error } = await createAdminClient().rpc("public_verify", {
    p_regd_no: v.regdNo,
    p_name: v.studentName,
    p_certificate_no: v.certificateNo,
    p_requester_name: v.requesterName,
    p_requester_org: v.requesterOrg,
    p_requester_email: v.requesterEmail,
    p_purpose: v.purpose,
    p_ip_hash: hashIp(ip),
    p_user_agent: userAgent,
    p_captcha_ok: captchaOk,
  })
  if (error) {
    console.error("public_verify failed", error)
    return { ok: false, error: "The verification service is unavailable. Please try again later." }
  }
  const r = data as { outcome: VerificationResult["outcome"]; code: string; slip_token: string | null; created_at: string; snapshot: VerificationSnapshot | null }
  return {
    ok: true,
    result:
      r.outcome === "matched"
        ? { outcome: "matched", code: r.code, slipToken: r.slip_token!, createdAt: r.created_at, snapshot: r.snapshot! }
        : { outcome: r.outcome, code: r.code, createdAt: r.created_at },
  }
}
