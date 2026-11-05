import { z } from "zod"

/** Same rule as folders_prepare() in the database. */
export const REFERENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/
export const REFERENCE_ID_HINT = 'Letters, digits, ".", "_", "/" and "-" (max 60), e.g. SOMSQP-ADC-1-FL4'

export const referenceIdSchema = z
  .string()
  .trim()
  .min(1, "A Reference ID is required")
  .regex(REFERENCE_ID_PATTERN, REFERENCE_ID_HINT)

/**
 * How a folder's Ref ID is set, by depth (mirrors folders_prepare()):
 *  1 = child folder in a department: required · 2 = e.g. the program: automatic · 3+ = optional
 */
export function refIdRule(depth: number): "required" | "auto" | "optional" {
  return depth <= 1 ? "required" : depth === 2 ? "auto" : "optional"
}

export const MAX_FOLDER_DEPTH = 8

export const folderSchema = z.object({
  name: z.string().trim().min(1, "Enter a folder name").max(120, "At most 120 characters"),
  /** Checked against refIdRule(depth) by the action. */
  referenceId: z.string().trim(),
  description: z
    .string()
    .trim()
    .max(300, "At most 300 characters")
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  allowSubfolders: z.boolean(),
})
export type FolderInput = z.input<typeof folderSchema>

export const documentTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,15}$/, "1–16 characters: letters, digits, - or _"),
  name: z.string().trim().min(1, "Enter a name").max(60, "At most 60 characters"),
  description: z
    .string()
    .trim()
    .max(300, "At most 300 characters")
    .transform((v) => (v === "" ? null : v))
    .nullable(),
})
export type DocumentTypeInput = z.input<typeof documentTypeSchema>
