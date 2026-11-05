"use client"

import { describeFile } from "@/lib/files"
import { CERTIFICATE_ACCEPT, MAX_CERTIFICATE_BYTES } from "@/lib/students"
import { createClient } from "@/lib/supabase/client"
import { requestCertificateUpload } from "./actions"

const ALLOWED = CERTIFICATE_ACCEPT.split(",").map((e) => e.slice(1))

/** Problem with a picked file, or null when it can be uploaded. */
export function certificateFileProblem(file: File) {
  const ext = describeFile(file.name)?.ext
  if (!ext || !ALLOWED.includes(ext)) return `“${file.name}” is not a PDF or image.`
  if (file.size === 0) return "The file is empty."
  if (file.size > MAX_CERTIFICATE_BYTES) return "Certificate files can be at most 20 MB."
  return null
}

/** Uploads straight to Storage with a one-time signed URL; the server checks it when the certificate is saved. */
export async function uploadCertificateFile(studentId: string, file: File) {
  const ticket = await requestCertificateUpload(studentId, file.name, file.size)
  if (!ticket.ok) throw new Error(ticket.error)
  const { error } = await createClient()
    .storage.from("certificates")
    .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: ticket.data.contentType })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  return { path: ticket.data.path, originalFilename: file.name }
}
