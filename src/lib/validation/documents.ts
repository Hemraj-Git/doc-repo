import { z } from "zod"

export const documentSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a document name").max(200, "At most 200 characters"),
    documentTypeId: z.uuid("Select a document type"),
    /** Required for standalone documents (in the department root); ignored inside folders. */
    referenceId: z.string().trim(),
    description: z.string().trim().max(1000, "At most 1000 characters"),
    uploaderId: z.uuid("Select who will upload the file"),
    requiresReview: z.boolean(),
    reviewerIds: z.array(z.uuid()),
    dueDate: z.union([z.literal(""), z.iso.date("Enter a valid date")]),
  })
  .refine((v) => !v.requiresReview || v.reviewerIds.length > 0, {
    path: ["reviewerIds"],
    message: "Add at least one reviewer, or turn review off",
  })
  .refine((v) => !v.reviewerIds.includes(v.uploaderId), {
    path: ["reviewerIds"],
    message: "The uploader cannot also be a reviewer",
  })
export type DocumentInput = z.input<typeof documentSchema>

/** One file uploaded straight into a folder. Reviewers are optional: with none it is live at once. */
export const directUploadSchema = z.object({
  name: z.string().trim().min(1, "Enter a document name").max(200, "At most 200 characters"),
  documentTypeId: z.uuid("Select a document type"),
  /** Required in a department's top-level folder; optional inside folders. */
  referenceId: z.string().trim(),
  description: z.string().trim().max(1000, "At most 1000 characters"),
  reviewerIds: z.array(z.uuid()),
})
export type DirectUploadInput = z.input<typeof directUploadSchema>

export const reviewDecisionSchema = z
  .object({ approve: z.boolean(), comment: z.string().trim().max(2000, "At most 2000 characters") })
  .refine((v) => v.approve || v.comment.length > 0, { path: ["comment"], message: "Explain what needs to change" })
