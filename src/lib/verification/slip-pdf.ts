import "server-only"
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib"
import QRCode from "qrcode"
import { formatDate, formatDateTime } from "@/lib/format"
import { CERTIFICATE_STATUS_LABELS, STUDENT_STATUS_LABELS } from "@/lib/students"
import type { PublicInstitute } from "./site"
import type { Slip } from "./types"

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 48
const INK = rgb(0.1, 0.12, 0.16)
const MUTED = rgb(0.42, 0.45, 0.5)
const RULE = rgb(0.86, 0.87, 0.9)
const ACCENT = rgb(0.05, 0.4, 0.3)

// The standard PDF fonts only cover Latin-1 plus a few typographic marks.
const EXTRA = new Set("–—‘’“”•…€™")
const safe = (s: string | null | undefined) =>
  [...(s ?? "")].map((ch) => (ch.charCodeAt(0) <= 0xff || EXTRA.has(ch) ? ch : "?")).join("")

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = []
  for (const paragraph of safe(text).split("\n")) {
    let line = ""
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
  }
  return lines
}

/** Breaks text without spaces (a URL) wherever it reaches the width. */
function wrapChars(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = []
  let line = ""
  for (const ch of safe(text)) {
    if (font.widthOfTextAtSize(line + ch, size) > width && line) {
      lines.push(line)
      line = ch
    } else line += ch
  }
  if (line) lines.push(line)
  return lines
}

async function loadLogo(doc: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes)
  } catch {
    // Without a logo the slip is still complete.
  }
  return null
}

/** The downloadable verification slip. Everything on it comes from the stored, unchangeable record. */
export async function buildSlipPdf(slip: Slip, institute: PublicInstitute, slipUrl: string) {
  const doc = await PDFDocument.create()
  doc.setTitle(`Verification slip ${slip.code}`)
  doc.setAuthor(institute.name)
  doc.setSubject("Certificate verification")
  doc.setCreationDate(new Date(slip.created_at))

  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.Courier)
  let page: PDFPage = doc.addPage([A4.width, A4.height])
  let y = A4.height - MARGIN
  const contentWidth = A4.width - MARGIN * 2

  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = INK) => page.drawText(safe(s), { x, y, size, font: f, color })
  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 40) {
      page = doc.addPage([A4.width, A4.height])
      y = A4.height - MARGIN
    }
  }
  const rule = () => {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 0.75, color: RULE })
  }

  // Letterhead
  const logo = await loadLogo(doc, institute.logoUrl)
  let textX = MARGIN
  if (logo) {
    const h = 44
    const w = Math.min((logo.width / logo.height) * h, 120)
    page.drawImage(logo, { x: MARGIN, y: y - h + 6, width: w, height: (w / logo.width) * logo.height })
    textX = MARGIN + w + 12
  }
  text(institute.name, textX, 15, bold)
  y -= 16
  for (const line of wrap(institute.address ?? "", font, 9, contentWidth - (textX - MARGIN)).slice(0, 3)) {
    text(line, textX, 9, font, MUTED)
    y -= 11
  }
  y = Math.min(y, A4.height - MARGIN - 50)
  rule()
  y -= 26

  text("Certificate Verification Slip", MARGIN, 16, bold, ACCENT)
  y -= 20
  text(`Verification ID: ${slip.code}`, MARGIN, 10, bold)
  text(`Verified on ${formatDateTime(slip.created_at)} (IST)`, MARGIN + 230, 10, font, MUTED)
  y -= 22

  const section = (title: string) => {
    ensure(40)
    text(title.toUpperCase(), MARGIN, 8.5, bold, MUTED)
    y -= 6
    rule()
    y -= 14
  }
  // Label/value pairs, two per row.
  const pairs = (rows: [string, string | null | undefined][]) => {
    const shown = rows.filter((r): r is [string, string] => Boolean(r[1]))
    const col = contentWidth / 2
    for (let i = 0; i < shown.length; i += 2) {
      ensure(28)
      shown.slice(i, i + 2).forEach(([label, value], j) => {
        const x = MARGIN + j * col
        page.drawText(safe(label), { x, y, size: 8, font, color: MUTED })
        page.drawText(wrap(value, bold, 10, col - 12)[0] ?? "", { x, y: y - 11, size: 10, font: bold, color: INK })
      })
      y -= 28
    }
    y -= 4
  }

  section("Requested by")
  pairs([
    ["Name", slip.requester_name],
    ["Organisation", slip.requester_org],
    ["Email", slip.requester_email],
    ["Purpose", slip.purpose],
  ])

  const s = slip.snapshot.student
  section("Student — matches our records")
  pairs([
    ["Name", s.full_name],
    ["Regd No.", s.regd_no],
    ["Course", s.course],
    ["Batch", s.batch],
    ["Department", s.department],
    ["Status", STUDENT_STATUS_LABELS[s.status]],
    ["Completed on", s.completion_date ? formatDate(s.completion_date) : null],
  ])

  section("Certificates issued")
  const cols = [
    { label: "Certificate", w: 150 },
    { label: "Number", w: 96 },
    { label: "Issued", w: 62 },
    { label: "Period", w: 56 },
    { label: "Result", w: 56 },
    { label: "Status", w: contentWidth - 420 },
  ]
  const header = () => {
    let x = MARGIN
    for (const c of cols) {
      page.drawText(c.label, { x, y, size: 8, font: bold, color: MUTED })
      x += c.w
    }
    y -= 14
  }
  header()
  if (slip.snapshot.certificates.length === 0) {
    text("No certificates are on record.", MARGIN, 10, font, MUTED)
    y -= 14
  }
  for (const c of slip.snapshot.certificates) {
    const typeLines = wrap(c.type, font, 9, cols[0]!.w - 6)
    // Status on the first line; when it changed, the date and replacement underneath.
    const statusLines = [
      CERTIFICATE_STATUS_LABELS[c.status],
      ...(c.status !== "issued" && c.status_changed_at ? [formatDate(c.status_changed_at)] : []),
      ...(c.replaced_by ? wrap(`by ${c.replaced_by}`, font, 8, cols[5]!.w - 4) : []),
    ]
    const height = Math.max(typeLines.length, statusLines.length, 1) * 11 + 6
    if (y - height < MARGIN + 120) {
      page = doc.addPage([A4.width, A4.height])
      y = A4.height - MARGIN
      header()
    }
    if (c.highlight) {
      page.drawRectangle({ x: MARGIN - 4, y: y - height + 9, width: contentWidth + 8, height, color: rgb(0.93, 0.98, 0.95) })
    }
    const cells = [
      c.certificate_no,
      formatDate(c.issue_date),
      [c.academic_year, c.semester ? `S${c.semester}` : null].filter(Boolean).join(" ") || "-",
      c.result ?? "-",
    ]
    typeLines.forEach((line, i) => page.drawText(line, { x: MARGIN, y: y - i * 11, size: 9, font, color: INK }))
    let x = MARGIN + cols[0]!.w
    cells.forEach((value, i) => {
      const width = cols[i + 1]!.w - 4
      const f = i === 0 ? mono : font
      const size = i === 0 ? 8 : 9
      page.drawText(wrapChars(value, f, size, width)[0] ?? "", { x, y, size, font: f, color: INK })
      x += cols[i + 1]!.w
    })
    const statusColor = c.status === "issued" ? ACCENT : rgb(0.7, 0.1, 0.15)
    statusLines.forEach((line, i) =>
      page.drawText(safe(line), { x, y: y - i * 11, size: i === 0 ? 9 : 8, font: i === 0 ? bold : font, color: i === 0 ? statusColor : MUTED })
    )
    y -= height
    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: A4.width - MARGIN, y: y + 6 }, thickness: 0.4, color: RULE })
  }

  if (slip.snapshot.certificate_query) {
    y -= 6
    ensure(20)
    const found = slip.snapshot.certificates.find((c) => c.highlight)
    text(
      found
        ? `Certificate ${found.certificate_no} was specifically checked: ${CERTIFICATE_STATUS_LABELS[found.status]}.`
        : `Certificate ${slip.snapshot.certificate_query} is not on record for this student.`,
      MARGIN,
      9.5,
      bold,
      found?.status === "issued" ? ACCENT : rgb(0.7, 0.1, 0.15)
    )
    y -= 16
  }

  // QR + statement, at the bottom of the last page.
  const qrPng = await QRCode.toBuffer(slipUrl, { errorCorrectionLevel: "M", margin: 1, width: 300 })
  const qr = await doc.embedPng(qrPng)
  const qrSize = 92
  if (y < MARGIN + qrSize + 30) {
    page = doc.addPage([A4.width, A4.height])
    y = A4.height - MARGIN
  }
  const baseY = MARGIN + 10
  page.drawImage(qr, { x: A4.width - MARGIN - qrSize, y: baseY, width: qrSize, height: qrSize })
  const note = [
    "This slip is system-generated and needs no signature.",
    "Scan the QR code or open the link below to confirm it is genuine:",
  ]
  let ny = baseY + qrSize - 10
  for (const line of note) {
    page.drawText(line, { x: MARGIN, y: ny, size: 9, font, color: INK })
    ny -= 13
  }
  for (const line of wrapChars(slipUrl, mono, 7.5, contentWidth - qrSize - 16)) {
    page.drawText(line, { x: MARGIN, y: ny, size: 7.5, font: mono, color: MUTED })
    ny -= 10
  }
  if (institute.contactEmail) {
    ny -= 6
    page.drawText(safe(`Questions: ${institute.contactEmail}`), { x: MARGIN, y: ny, size: 9, font, color: MUTED })
  }

  return doc.save()
}
