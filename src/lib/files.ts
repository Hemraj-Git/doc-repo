// Accepted upload formats. Used by the browser (accept=, early checks) and by the
// server, which also verifies the file's real type from its first bytes.

export type FileFormat = "image" | "pdf" | "word" | "excel" | "ppt"

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // matches the storage bucket limit

const EXTENSIONS: Record<string, { format: FileFormat; mime: string }> = {
  jpg: { format: "image", mime: "image/jpeg" },
  jpeg: { format: "image", mime: "image/jpeg" },
  png: { format: "image", mime: "image/png" },
  webp: { format: "image", mime: "image/webp" },
  pdf: { format: "pdf", mime: "application/pdf" },
  doc: { format: "word", mime: "application/msword" },
  docx: { format: "word", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xls: { format: "excel", mime: "application/vnd.ms-excel" },
  xlsx: { format: "excel", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  csv: { format: "excel", mime: "text/csv" },
  ppt: { format: "ppt", mime: "application/vnd.ms-powerpoint" },
  pptx: { format: "ppt", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
}

export const FORMAT_LABELS: Record<FileFormat, string> = {
  image: "Image",
  pdf: "PDF",
  word: "Word",
  excel: "Excel",
  ppt: "PowerPoint",
}

/** For <input accept>. */
export const ACCEPT_ATTRIBUTE = Object.keys(EXTENSIONS)
  .map((e) => `.${e}`)
  .join(",")

export const ACCEPTED_SUMMARY = "Images (JPG, PNG, WebP), PDF, Word, Excel (incl. CSV), PowerPoint — up to 50 MB"

export function describeFile(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? ""
  const entry = EXTENSIONS[ext]
  return entry ? { ext, ...entry } : null
}

/**
 * How a file is previewed in the browser:
 *  pdf / image — the browser's own viewer
 *  docx / sheet / pptx — rendered in the sandboxed preview frame
 *  null — legacy binary Office formats (.doc, .ppt), download only
 */
export type PreviewKind = "pdf" | "image" | "docx" | "sheet" | "pptx"

const PREVIEW_BY_EXT: Record<string, PreviewKind> = {
  pdf: "pdf",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  docx: "docx",
  xlsx: "sheet",
  xls: "sheet",
  csv: "sheet",
  pptx: "pptx",
}

export function previewKind(fileName: string): PreviewKind | null {
  return PREVIEW_BY_EXT[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? null
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b)
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

const ZIP = [0x50, 0x4b, 0x03, 0x04] // docx, xlsx, pptx
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] // doc, xls, ppt

/** Checks that the file content really is the type its extension claims. */
export function contentMatchesExtension(ext: string, bytes: Uint8Array) {
  switch (ext) {
    case "pdf":
      return startsWith(bytes, ascii("%PDF-"))
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case "jpg":
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case "webp":
      return startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)
    case "docx":
    case "xlsx":
    case "pptx":
      return startsWith(bytes, ZIP)
    case "doc":
    case "xls":
    case "ppt":
      return startsWith(bytes, OLE)
    case "csv":
      // Plain text: no NUL bytes in the first 4 KB.
      return !bytes.subarray(0, 4096).includes(0)
    default:
      return false
  }
}
