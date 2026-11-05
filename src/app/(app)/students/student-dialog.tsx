"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm, type FieldPath } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Pencil, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import { OptionSelect, type Option } from "@/components/option-select"
import type { Student } from "@/lib/data/students"
import { GENDER_LABELS, STUDENT_STATUS_LABELS } from "@/lib/students"
import { studentSchema, type StudentInput, type StudentValues } from "@/lib/validation/students"
import { createStudent, updateStudent } from "./actions"

const NONE = "__none__"

function initialValues(student: Student | undefined, departmentId: string): StudentInput {
  const s = student
  return {
    fullName: s?.fullName ?? "",
    regdNo: s?.regdNo ?? "",
    enrollmentNo: s?.enrollmentNo ?? "",
    dateOfBirth: s?.dateOfBirth ?? "",
    gender: s?.gender ?? "",
    nationality: s?.nationality ?? (s ? "" : "Indian"),
    departmentId: s?.department.id ?? departmentId,
    courseName: s?.courseName ?? "",
    courseCode: s?.courseCode ?? "",
    batch: s?.batch ?? "",
    admissionDate: s?.admissionDate ?? "",
    currentSemester: s?.currentSemester ? String(s.currentSemester) : "",
    status: s?.status ?? "enrolled",
    completionDate: s?.completionDate ?? "",
    finalResult: s?.finalResult ?? "",
    indosNo: s?.indosNo ?? "",
    cdcNo: s?.cdcNo ?? "",
    passportNo: s?.passportNo ?? "",
    passportExpiry: s?.passportExpiry ?? "",
    sponsor: s?.sponsor ?? "",
    email: s?.email ?? "",
    mobile: s?.mobile ?? "",
    address: s?.address ?? "",
    programFolderId: s?.programFolder?.id ?? "",
  }
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  student?: Student
  departments: Option[]
  /** Program folders the student can be linked to (edit only). */
  folders?: Option[]
}

export function StudentDialog({ open, onOpenChange, student, departments, folders = [] }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const form = useForm<StudentInput, unknown, StudentValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: initialValues(student, departments[0]?.value ?? ""),
  })
  const { errors } = form.formState

  useEffect(() => {
    if (open) form.reset(initialValues(student, departments[0]?.value ?? ""))
  }, [open, student, departments, form])

  // The server re-validates the raw form input.
  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const input = form.getValues()
      const result = student ? await updateStudent(student.id, input) : await createStudent(input)
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([field, message]) => form.setError(field as FieldPath<StudentInput>, { message }))
        toast.error(result.error)
        return
      }
      toast.success(student ? "Student updated" : `${values.fullName} added`)
      onOpenChange(false)
      if (!student && result.data) router.push(`/students/${(result.data as { id: string }).id}`)
    })
  )

  const text = (name: FieldPath<StudentInput>, label: string, opts: { optional?: boolean; type?: string; placeholder?: string; hint?: string } = {}) => (
    <Field id={`st-${name}`} label={label} optional={opts.optional} error={errors[name as keyof typeof errors]?.message as string | undefined} hint={opts.hint}>
      {(d) => (
        <Input
          id={`st-${name}`}
          type={opts.type ?? "text"}
          placeholder={opts.placeholder}
          aria-invalid={Boolean(errors[name as keyof typeof errors]) || undefined}
          aria-describedby={d}
          {...form.register(name)}
        />
      )}
    </Field>
  )

  const select = (name: "gender" | "status" | "departmentId" | "programFolderId", label: string, options: Option[], optional?: boolean) => (
    <Field id={`st-${name}`} label={label} optional={optional} error={errors[name]?.message as string | undefined}>
      {(d) => (
        <Controller
          control={form.control}
          name={name}
          render={({ field }) => (
            <OptionSelect
              id={`st-${name}`}
              options={optional ? [{ value: NONE, label: "—" }, ...options] : options}
              value={(field.value as string) || (optional ? NONE : null)}
              onChange={(v) => field.onChange(v === NONE ? "" : (v ?? ""))}
              aria-describedby={d}
            />
          )}
        />
      )}
    </Field>
  )

  const section = (title: string, children: React.ReactNode) => (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 section-label">{title}</legend>
      {children}
    </fieldset>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{student ? `Edit ${student.fullName}` : "Add student"}</DialogTitle>
            <DialogDescription>
              The full name and Regd No. are what verifiers enter on the public portal — use them exactly as printed on certificates.
            </DialogDescription>
          </DialogHeader>

          {section(
            "Identity",
            <>
              <div className="sm:col-span-2">{text("fullName", "Full name (as on certificates)")}</div>
              {text("regdNo", "Regd No.", { placeholder: "e.g. SOM/2026/001" })}
              {text("enrollmentNo", "Enrollment / Roll No.", { optional: true })}
              {text("dateOfBirth", "Date of birth", { optional: true, type: "date" })}
              {select("gender", "Gender", Object.entries(GENDER_LABELS).map(([value, label]) => ({ value, label })), true)}
              {text("nationality", "Nationality", { optional: true })}
            </>
          )}

          {section(
            "Course",
            <>
              {select("departmentId", "Department", departments)}
              {text("courseName", "Course / Program", { placeholder: "e.g. Diploma In Nautical Science" })}
              {text("courseCode", "Course code", { optional: true })}
              {text("batch", "Batch / intake", { placeholder: "e.g. 2026–29" })}
              {text("admissionDate", "Admission date", { optional: true, type: "date" })}
              {text("currentSemester", "Current semester", { optional: true, type: "number" })}
              {select("status", "Status", Object.entries(STUDENT_STATUS_LABELS).map(([value, label]) => ({ value, label })))}
              {text("completionDate", "Completion date", { optional: true, type: "date" })}
              {text("finalResult", "Final result / CGPA", { optional: true })}
              {student && folders.length > 0 && select("programFolderId", "Program folder", folders, true)}
            </>
          )}

          {section(
            "Maritime IDs",
            <>
              {text("indosNo", "INDoS No.", { optional: true })}
              {text("cdcNo", "CDC No.", { optional: true })}
              {text("passportNo", "Passport No.", { optional: true })}
              {text("passportExpiry", "Passport expiry", { optional: true, type: "date" })}
              <div className="sm:col-span-2">{text("sponsor", "Sponsoring company", { optional: true, hint: "For sponsored cadets." })}</div>
            </>
          )}

          {section(
            "Contact",
            <>
              {text("email", "Email", { optional: true, type: "email" })}
              {text("mobile", "Mobile", { optional: true, type: "tel" })}
              <div className="sm:col-span-2">
                <Field id="st-address" label="Address" optional error={errors.address?.message}>
                  {(d) => <Textarea id="st-address" rows={2} aria-describedby={d} {...form.register("address")} />}
                </Field>
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {student ? "Save changes" : "Add student"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function NewStudentButton({ departments }: { departments: Option[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus /> Add student
      </Button>
      <StudentDialog open={open} onOpenChange={setOpen} departments={departments} />
    </>
  )
}

export function EditStudentButton({ student, departments, folders }: { student: Student; departments: Option[]; folders: Option[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil /> Edit
      </Button>
      <StudentDialog open={open} onOpenChange={setOpen} student={student} departments={departments} folders={folders} />
    </>
  )
}
