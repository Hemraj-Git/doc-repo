import { z } from "zod"

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()

const uuid = z.uuid("Select a value")

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80, "At most 80 characters"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,19}$/, "2–20 characters: letters, digits, - or _"),
  description: optionalText(300),
  headUserId: uuid.nullable(),
})
export type DepartmentInput = z.input<typeof departmentSchema>

export const userSchema = z
  .object({
    fullName: z.string().trim().min(2, "At least 2 characters").max(120, "At most 120 characters"),
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
    employeeCode: optionalText(40),
    designation: optionalText(80),
    phone: optionalText(30),
    departmentId: uuid,
    reportsToId: uuid.nullable(),
    makeHead: z.boolean(),
  })
  .refine((v) => v.makeHead || v.reportsToId, {
    path: ["reportsToId"],
    message: "Select who this user reports to (only the department head has no manager)",
  })
export type UserInput = z.input<typeof userSchema>

export const roleSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(60, "At most 60 characters"),
  description: optionalText(300),
  permissions: z.array(z.string()),
})
export type RoleInput = z.input<typeof roleSchema>
