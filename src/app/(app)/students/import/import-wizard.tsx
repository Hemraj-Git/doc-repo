"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import { IMPORT_COLUMNS, normalizeHeader, studentRow, studentSchema, type ImportField } from "@/lib/validation/students"
import { importStudents } from "../actions"

type Department = { id: string; code: string; name: string }
type Parsed = { rowNo: number; values: Record<string, string>; errors: string[]; record: Record<string, unknown> | null }

const MAX_ROWS = 2000

/** dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd → yyyy-mm-dd; anything else is returned unchanged (and then fails validation). */
function toIsoDate(v: string) {
  const s = v.trim()
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : s
}

const GENDERS: Record<string, string> = { m: "male", male: "male", f: "female", female: "female", o: "other", other: "other" }
const DATE_FIELDS: ImportField[] = ["dateOfBirth", "admissionDate", "completionDate", "passportExpiry"]

function templateCsv() {
  const header = IMPORT_COLUMNS.map((c) => c.label)
  const example = ["SOM/2026/001", "Rahul Kumar", "Diploma In Nautical Science", "2026–27", "", "R-01", "15/04/2007", "Male", "Indian"]
  return `﻿${header.join(",")}\r\n${example.join(",")}\r\n`
}

export function ImportWizard({ departments }: { departments: Department[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<{ raw: string; field: ImportField | null }[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [defaultDept, setDefaultDept] = useState<string | null>(departments.length === 1 ? departments[0]!.id : null)
  const [parsing, setParsing] = useState(false)

  const read = async (file: File) => {
    setParsing(true)
    try {
      const XLSX = await import("xlsx")
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]!]!
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false, dateNF: "yyyy-mm-dd" })
      if (data.length === 0) throw new Error("The first sheet has no rows.")
      if (data.length > MAX_ROWS) throw new Error(`At most ${MAX_ROWS} rows at a time — split the file.`)
      const rawHeaders = Object.keys(data[0]!)
      setHeaders(
        rawHeaders.map((raw) => {
          const n = normalizeHeader(raw)
          return { raw, field: IMPORT_COLUMNS.find((c) => c.aliases.includes(n) || normalizeHeader(c.label) === n)?.field ?? null }
        })
      )
      setRows(data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "").trim()]))))
      setFileName(file.name)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file")
    } finally {
      setParsing(false)
    }
  }

  const mapped = new Set(headers.map((h) => h.field).filter(Boolean))
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !mapped.has(c.field))
  const needsDept = !mapped.has("departmentCode") && !defaultDept

  const parsed: Parsed[] = useMemo(() => {
    const byCode = new Map(departments.map((d) => [d.code.toUpperCase(), d.id]))
    const seen = new Map<string, number>()
    return rows.map((r, i) => {
      const values: Record<string, string> = {}
      for (const h of headers) if (h.field) values[h.field] = r[h.raw] ?? ""
      const errors: string[] = []

      let departmentId = defaultDept ?? ""
      if (values.departmentCode) {
        const id = byCode.get(values.departmentCode.toUpperCase())
        if (id) departmentId = id
        else errors.push(`Unknown department “${values.departmentCode}”`)
      }
      const input = {
        fullName: values.fullName ?? "",
        regdNo: values.regdNo ?? "",
        enrollmentNo: values.enrollmentNo ?? "",
        dateOfBirth: toIsoDate(values.dateOfBirth ?? ""),
        gender: values.gender ? (GENDERS[values.gender.toLowerCase()] ?? values.gender) : "",
        nationality: values.nationality ?? "",
        departmentId,
        courseName: values.courseName ?? "",
        courseCode: values.courseCode ?? "",
        batch: values.batch ?? "",
        admissionDate: toIsoDate(values.admissionDate ?? ""),
        currentSemester: values.currentSemester ?? "",
        status: (values.status || "enrolled").toLowerCase(),
        completionDate: toIsoDate(values.completionDate ?? ""),
        finalResult: values.finalResult ?? "",
        indosNo: values.indosNo ?? "",
        cdcNo: values.cdcNo ?? "",
        passportNo: values.passportNo ?? "",
        passportExpiry: toIsoDate(values.passportExpiry ?? ""),
        sponsor: values.sponsor ?? "",
        email: values.email ?? "",
        mobile: values.mobile ?? "",
        address: values.address ?? "",
        programFolderId: "",
      }
      for (const f of DATE_FIELDS) values[f] = input[f as keyof typeof input] as string

      const result = studentSchema.safeParse(input)
      if (!result.success) {
        for (const issue of result.error.issues) {
          const col = IMPORT_COLUMNS.find((c) => c.field === issue.path[0])?.label ?? String(issue.path[0] ?? "")
          if (issue.path[0] === "departmentId" && errors.length) continue
          errors.push(`${col}: ${issue.message}`)
        }
      }
      const key = (values.regdNo ?? "").replace(/\s+/g, "").toUpperCase()
      if (key) {
        if (seen.has(key)) errors.push(`Same Regd No. as row ${seen.get(key)}`)
        else seen.set(key, i + 2)
      }
      return { rowNo: i + 2, values, errors, record: result.success && errors.length === 0 ? studentRow(result.data) : null }
    })
  }, [rows, headers, defaultDept, departments])

  const invalid = parsed.filter((p) => p.errors.length)
  const ready = rows.length > 0 && missing.length === 0 && !needsDept && invalid.length === 0

  const submit = () =>
    startTransition(async () => {
      const result = await importStudents(parsed.map((p) => p.record as Record<string, string | number | null>))
      if (!result.ok) return void toast.error(result.error)
      toast.success(`${result.data.count} students imported`)
      router.push("/students")
    })

  const preview = invalid.length ? invalid : parsed

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-xl border p-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="imp-file" label="Excel or CSV file" hint="The first sheet is read. Row 1 must hold the column names.">
            {(d) => (
              <Input
                id="imp-file"
                type="file"
                accept=".xlsx,.xls,.csv"
                aria-describedby={d}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void read(f)
                }}
              />
            )}
          </Field>
          <Field id="imp-dept" label="Department" hint="For rows without a “Department code” column.">
            {(d) => (
              <OptionSelect
                id="imp-dept"
                options={departments.map((x) => ({ value: x.id, label: `${x.name} (${x.code})` }))}
                value={defaultDept}
                onChange={setDefaultDept}
                aria-describedby={d}
              />
            )}
          </Field>
        </div>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv())}`}
          download="students-import-template.csv"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Download className="size-4" /> Download a template
        </a>
      </section>

      {parsing && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading the file…
        </p>
      )}

      {fileName && (
        <>
          <section className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <FileSpreadsheet className="size-4 text-primary" /> {fileName} · {rows.length} rows
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {headers.map((h) => (
                <Badge key={h.raw} variant={h.field ? "secondary" : "outline"} className={h.field ? "" : "text-muted-foreground line-through"}>
                  {h.raw}
                  {h.field ? ` → ${IMPORT_COLUMNS.find((c) => c.field === h.field)!.label}` : " (ignored)"}
                </Badge>
              ))}
            </div>
            {missing.length > 0 && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertTriangle className="size-4" /> Missing required columns: {missing.map((c) => c.label).join(", ")}
              </p>
            )}
            {needsDept && <p className="text-sm text-destructive">Choose the department, or add a “Department code” column.</p>}
          </section>

          {missing.length === 0 && (
            <section className="space-y-2">
              <p className={`flex items-center gap-1.5 text-sm ${invalid.length ? "text-destructive" : "text-emerald-700"}`}>
                {invalid.length ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
                {invalid.length
                  ? `${invalid.length} of ${rows.length} rows need fixing. Correct them in the file and choose it again.`
                  : `All ${rows.length} rows are valid.`}
              </p>
              <div className="max-h-[28rem] overflow-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Row</TableHead>
                      <TableHead>Regd No.</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Course</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>{invalid.length ? "Problems" : "Status"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.slice(0, 300).map((p) => (
                      <TableRow key={p.rowNo}>
                        <TableCell className="tabular-nums text-muted-foreground">{p.rowNo}</TableCell>
                        <TableCell className="font-mono text-xs">{p.values.regdNo}</TableCell>
                        <TableCell>{p.values.fullName}</TableCell>
                        <TableCell className="max-w-48 truncate text-sm">{p.values.courseName}</TableCell>
                        <TableCell className="text-sm">{p.values.batch}</TableCell>
                        <TableCell className="text-xs">
                          {p.errors.length ? <span className="text-destructive">{p.errors.join(" · ")}</span> : <span className="text-emerald-700">OK</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {preview.length > 300 && <p className="text-xs text-muted-foreground">Showing the first 300.</p>}
            </section>
          )}

          <div className="flex justify-end">
            <Button onClick={submit} disabled={!ready || pending}>
              {pending && <Loader2 className="animate-spin" />}
              Import {ready ? rows.length : ""} students
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
