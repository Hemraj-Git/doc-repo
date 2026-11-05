import { z } from "zod"

export const templateDetailsSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80, "At most 80 characters"),
  description: z
    .string()
    .trim()
    .max(500, "At most 500 characters")
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  instanceLabel: z.string().trim().min(2, "At least 2 characters").max(40, "At most 40 characters"),
  /** Empty = every department. */
  departmentIds: z.array(z.uuid()),
  allowExtraFolders: z.boolean(),
  isActive: z.boolean(),
})
export type TemplateDetailsInput = z.input<typeof templateDetailsSchema>

const reviewerStep = z
  .object({
    rule: z.enum(["fixed", "department_head", "uploader_manager", "slot_owner_manager"]),
    userId: z.uuid().nullable(),
  })
  .refine((s) => s.rule !== "fixed" || s.userId, { path: ["userId"], message: "Choose a person" })

export const nodeSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(120, "At most 120 characters"),
    // folder
    allowSubfolders: z.boolean(),
    // document
    documentTypeId: z.string(),
    description: z.string().trim().max(1000, "At most 1000 characters"),
    recurrence: z.enum(["once", "weekly", "monthly", "quarterly", "semester", "half_yearly", "academic_year"]),
    storage: z.enum(["here", "academic_year", "academic_year_semester"]),
    createOffsetDays: z.number().int().min(0, "0 or more").max(60, "At most 60"),
    dueMode: z.enum(["none", "period_end", "after_creation"]),
    dueDays: z.number().int().min(0, "0 or more").max(365, "At most 365"),
    uploaderRule: z.enum(["chosen", "slot_owner", "department_head", "fixed"]),
    fixedUploaderId: z.string().nullable(),
    requiresReview: z.boolean(),
    reviewers: z.array(reviewerStep),
    // slot
    slotTemplateId: z.string().nullable(),
    slotOwnerLabel: z.string().trim().max(40, "At most 40 characters"),
    slotEntryDates: z.boolean(),
  })
  .refine((n) => n.uploaderRule !== "fixed" || n.fixedUploaderId, { path: ["fixedUploaderId"], message: "Choose a person" })
  .refine((n) => !n.requiresReview || n.reviewers.length > 0, { path: ["reviewers"], message: "Add at least one reviewer" })
export type NodeInput = z.input<typeof nodeSchema>
