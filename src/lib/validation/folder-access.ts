import { z } from "zod"

export const FOLDER_ACCESS_LABELS = { read: "View", write: "Upload" } as const
export type FolderAccess = keyof typeof FOLDER_ACCESS_LABELS

export const GRANTEE_KINDS = ["user", "department", "group"] as const
export type GranteeKind = (typeof GRANTEE_KINDS)[number]

export const folderGrantSchema = z.object({
  kind: z.enum(GRANTEE_KINDS),
  granteeId: z.uuid("Choose who gets access"),
  access: z.enum(["read", "write"]),
})
export type FolderGrantInput = z.input<typeof folderGrantSchema>

export const groupSchema = z.object({
  name: z.string().trim().min(1, "Enter a group name").max(120, "At most 120 characters"),
  description: z.string().trim().max(500, "At most 500 characters"),
})
export type GroupInput = z.input<typeof groupSchema>
