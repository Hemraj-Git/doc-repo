import { z } from "zod"

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((v) => (v === "" ? null : v))

const optionalDate = z.union([z.literal(""), z.iso.date("Enter a valid date")]).transform((v) => (v === "" ? null : v))

const optionalInt = z.union([z.literal(""), z.coerce.number().int().min(1).max(20)]).transform((v) => (v === "" ? null : v))

export const studentSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the full name as on certificates").max(160, "At most 160 characters"),
    regdNo: z.string().trim().min(1, "Enter the Regd No.").max(60, "At most 60 characters"),
    enrollmentNo: optionalText(60),
    dateOfBirth: optionalDate,
    gender: z.union([z.literal(""), z.enum(["male", "female", "other"])]).transform((v) => (v === "" ? null : v)),
    nationality: optionalText(60),
    departmentId: z.uuid("Select the department"),
    courseName: z.string().trim().min(1, "Enter the course / program").max(160, "At most 160 characters"),
    courseCode: optionalText(40),
    batch: z.string().trim().min(1, "Enter the batch, e.g. 2026–29").max(40, "At most 40 characters"),
    admissionDate: optionalDate,
    currentSemester: optionalInt,
    status: z.enum(["enrolled", "completed", "discontinued", "transferred"]),
    completionDate: optionalDate,
    finalResult: optionalText(80),
    indosNo: optionalText(40),
    cdcNo: optionalText(40),
    passportNo: optionalText(40),
    passportExpiry: optionalDate,
    sponsor: optionalText(160),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address")
      .transform((v) => (v === "" ? null : v)),
    mobile: optionalText(30),
    address: optionalText(400),
    programFolderId: z.union([z.literal(""), z.uuid()]).transform((v) => (v === "" ? null : v)),
  })
  .refine((v) => !v.completionDate || !v.admissionDate || v.completionDate >= v.admissionDate, {
    path: ["completionDate"],
    message: "Must be after the admission date",
  })
export type StudentInput = z.input<typeof studentSchema>
export type StudentValues = z.output<typeof studentSchema>

/** Database row for an insert/update from validated values. */
export function studentRow(v: StudentValues) {
  return {
    full_name: v.fullName,
    regd_no: v.regdNo,
    enrollment_no: v.enrollmentNo,
    date_of_birth: v.dateOfBirth,
    gender: v.gender,
    nationality: v.nationality,
    department_id: v.departmentId,
    course_name: v.courseName,
    course_code: v.courseCode,
    batch: v.batch,
    admission_date: v.admissionDate,
    current_semester: v.currentSemester,
    status: v.status,
    completion_date: v.completionDate,
    final_result: v.finalResult,
    indos_no: v.indosNo,
    cdc_no: v.cdcNo,
    passport_no: v.passportNo,
    passport_expiry: v.passportExpiry,
    sponsor: v.sponsor,
    email: v.email,
    mobile: v.mobile,
    address: v.address,
    program_folder_id: v.programFolderId,
  }
}

export const certificateSchema = z.object({
  typeId: z.uuid("Select the certificate type"),
  certificateNo: z.string().trim().min(1, "Enter the certificate number").max(80, "At most 80 characters"),
  issueDate: z.iso.date("Enter the issue date"),
  academicYear: optionalText(20),
  semester: optionalInt,
  result: optionalText(80),
  remarks: optionalText(500),
})
export type CertificateInput = z.input<typeof certificateSchema>

export const certificateTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, "2–20 letters, digits, - or _"),
  name: z.string().trim().min(2, "At least 2 characters").max(120, "At most 120 characters"),
  needsPeriod: z.boolean(),
  showResult: z.boolean(),
  isActive: z.boolean(),
})
export type CertificateTypeInput = z.input<typeof certificateTypeSchema>

export type ImportField = Exclude<keyof StudentInput, "departmentId" | "programFolderId"> | "departmentCode"

/** Spreadsheet columns the import understands, matched on lower-cased, punctuation-free headers. */
export const IMPORT_COLUMNS: { field: ImportField; label: string; aliases: string[]; required?: boolean }[] = [
  { field: "regdNo", label: "Regd No.", aliases: ["regd no", "regdno", "registration no", "registration number", "reg no"], required: true },
  { field: "fullName", label: "Full name", aliases: ["full name", "name", "student name"], required: true },
  { field: "courseName", label: "Course", aliases: ["course", "program", "programme", "course name"], required: true },
  { field: "batch", label: "Batch", aliases: ["batch", "intake"], required: true },
  { field: "departmentCode", label: "Department code", aliases: ["department", "department code", "dept"] },
  { field: "enrollmentNo", label: "Enrollment / Roll No.", aliases: ["enrollment no", "roll no", "enrolment no", "roll number"] },
  { field: "dateOfBirth", label: "Date of birth", aliases: ["date of birth", "dob", "birth date"] },
  { field: "gender", label: "Gender", aliases: ["gender", "sex"] },
  { field: "nationality", label: "Nationality", aliases: ["nationality"] },
  { field: "courseCode", label: "Course code", aliases: ["course code"] },
  { field: "admissionDate", label: "Admission date", aliases: ["admission date", "date of admission"] },
  { field: "currentSemester", label: "Current semester", aliases: ["current semester", "semester"] },
  { field: "status", label: "Status", aliases: ["status"] },
  { field: "completionDate", label: "Completion date", aliases: ["completion date"] },
  { field: "finalResult", label: "Final result / CGPA", aliases: ["final result", "result", "cgpa"] },
  { field: "indosNo", label: "INDoS No.", aliases: ["indos no", "indos"] },
  { field: "cdcNo", label: "CDC No.", aliases: ["cdc no", "cdc"] },
  { field: "passportNo", label: "Passport No.", aliases: ["passport no", "passport"] },
  { field: "passportExpiry", label: "Passport expiry", aliases: ["passport expiry", "passport expiry date"] },
  { field: "sponsor", label: "Sponsoring company", aliases: ["sponsor", "sponsoring company"] },
  { field: "email", label: "Email", aliases: ["email", "email address"] },
  { field: "mobile", label: "Mobile", aliases: ["mobile", "phone", "mobile no"] },
  { field: "address", label: "Address", aliases: ["address"] },
]

export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
