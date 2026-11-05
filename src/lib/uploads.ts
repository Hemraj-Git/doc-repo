import "server-only"
import { createHash } from "node:crypto"
import { fail, ok, type ActionResult } from "@/lib/actions"
import { contentMatchesExtension, describeFile, MAX_UPLOAD_BYTES } from "@/lib/files"
import { createAdminClient } from "@/lib/supabase/admin"

export const DOCUMENTS_BUCKET = "documents"

type DescribedFile = NonNullable<ReturnType<typeof describeFile>>

/** Checks a file name and size before a signed upload URL is issued. */
export function checkUploadRequest(fileName: string, sizeBytes: number): ActionResult<DescribedFile> {
  const file = describeFile(fileName)
  if (!file) return fail("This file type is not accepted.")
  if (sizeBytes <= 0) return fail("The file is empty.")
  if (sizeBytes > MAX_UPLOAD_BYTES) return fail("Files can be at most 50 MB.")
  return ok(file)
}

/**
 * Verifies a file the browser uploaded straight to storage: its type, its real content,
 * its size. Anything that fails is removed from storage.
 */
export async function verifyStoredUpload(
  path: string,
  originalFilename: string
): Promise<ActionResult<{ file: DescribedFile; sizeBytes: number; sha256: string }>> {
  const file = describeFile(originalFilename)
  if (!file || !path.endsWith(`.${file.ext}`)) return fail("This file type is not accepted.")

  const storage = createAdminClient().storage.from(DOCUMENTS_BUCKET)
  const discard = async (message: string) => {
    await storage.remove([path])
    return fail(message)
  }

  const { data: blob, error } = await storage.download(path)
  if (error || !blob) return fail("The upload could not be found. Please try again.")

  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.byteLength === 0) return discard("The file is empty.")
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return discard("Files can be at most 50 MB.")
  if (!contentMatchesExtension(file.ext, bytes)) {
    return discard(`The file's content does not match its .${file.ext} extension. Re-save it in the right format and try again.`)
  }
  return ok({ file, sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") })
}
