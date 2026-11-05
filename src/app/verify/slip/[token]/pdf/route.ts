import { NextResponse } from "next/server"
import { buildSlipPdf } from "@/lib/verification/slip-pdf"
import { getSlip } from "@/lib/verification/slips"
import { publicInstitute, siteUrl } from "@/lib/verification/site"

export async function GET(_request: Request, { params }: RouteContext<"/verify/slip/[token]/pdf">) {
  const { token } = await params
  const slip = await getSlip(token)
  if (!slip) return new NextResponse("Not found", { status: 404 })

  const [institute, base] = await Promise.all([publicInstitute(), siteUrl()])
  const pdf = await buildSlipPdf(slip, institute, `${base}/verify/slip/${token}`)
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${slip.code}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  })
}
