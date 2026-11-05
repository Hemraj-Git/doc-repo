import { z } from "zod"

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()

export const instituteSettingsSchema = z.object({
  instituteName: z.string().trim().min(2, "At least 2 characters").max(150, "At most 150 characters"),
  address: optionalText(400),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address")
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  academicYearStartMonth: z.number().int().min(1).max(12),
})
export type InstituteSettingsInput = z.input<typeof instituteSettingsSchema>

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

/** e.g. start month 7 → "Jul – Jun"; Semester 1 = first six months, Semester 2 = the rest. */
export function academicYearSummary(startMonth: number) {
  const m = (offset: number) => MONTHS[(startMonth - 1 + offset) % 12]!
  return {
    span: `${m(0)} – ${m(11)}`,
    semester1: `${m(0)} – ${m(5)}`,
    semester2: `${m(6)} – ${m(11)}`,
  }
}
