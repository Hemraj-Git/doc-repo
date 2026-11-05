import { z } from "zod"
import { KPI_SCORER_PERSON } from "@/lib/kpis"

export const kpiDetailsSchema = z
  .object({
    name: z.string().trim().min(2, "At least 2 characters").max(120, "At most 120 characters"),
    designation: z.string().trim().max(80, "At most 80 characters"),
    description: z.string().trim().max(1000, "At most 1000 characters"),
    yearStartMonth: z.number().int().min(1).max(12),
    reviewerRule: z.enum(["uploader_manager", "department_head", "fixed"]),
    reviewerUserId: z.string().nullable(),
    /** A department id (its head scores), or KPI_SCORER_PERSON. */
    scorer: z.string().nullable(),
    scorerUserId: z.string().nullable(),
    dueDays: z.number({ error: "Enter the number of days" }).int("Whole days only").min(0, "0 or more").max(90, "At most 90"),
  })
  .refine((v) => v.reviewerRule !== "fixed" || v.reviewerUserId, { path: ["reviewerUserId"], message: "Choose the reviewer" })
  .refine((v) => v.scorer, { path: ["scorer"], message: "Choose the scorer" })
  .refine((v) => v.scorer !== KPI_SCORER_PERSON || v.scorerUserId, { path: ["scorerUserId"], message: "Choose the scorer" })
export type KpiDetailsInput = z.input<typeof kpiDetailsSchema>

export const kpiAreaSchema = z.object({
  name: z.string().trim().min(1, "Enter the area name").max(120, "At most 120 characters"),
  weightage: z.number({ error: "Enter the weightage" }).gt(0, "More than 0").max(100, "At most 100"),
  description: z.string().trim().min(1, "Say what is measured").max(1000, "At most 1000 characters"),
  recurrence: z.enum(["once", "monthly", "quarterly", "half_yearly", "academic_year"]),
})
export type KpiAreaInput = z.input<typeof kpiAreaSchema>

export const assignSchema = z
  .object({
    kpiId: z.uuid("Choose a KPI"),
    userIds: z.array(z.uuid()).min(1, "Choose at least one person").max(500, "At most 500 people at a time"),
    startDate: z.iso.date("Enter the start date"),
    endDate: z.iso.date("Enter the end date"),
    reviewerId: z.uuid().nullable(),
    scorerId: z.uuid().nullable(),
    backfill: z.boolean(),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "Must be after the start date" })
export type AssignInput = z.input<typeof assignSchema>

export const entrySubmitSchema = z
  .array(z.object({ id: z.uuid(), details: z.string().max(10000, "The details can be at most 10000 characters") }))
  .min(1, "Choose at least one period")
  .max(100)
export type EntrySubmitInput = z.input<typeof entrySubmitSchema>

export const scoreSchema = z.object({
  score: z.number({ error: "Choose a score" }).int().min(1, "The score must be from 1 to 10").max(10, "The score must be from 1 to 10"),
  comment: z.string().trim().max(2000, "At most 2000 characters"),
})
