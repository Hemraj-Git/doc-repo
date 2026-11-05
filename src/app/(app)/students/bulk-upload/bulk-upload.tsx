"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import { CheckCircle2, CircleAlert, Loader2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Field } from "@/components/field"
import { OptionSelect, type Option } from "@/components/option-select"
import { formatBytes } from "@/lib/files"
import { todayIso } from "@/lib/format"
import { CERTIFICATE_ACCEPT } from "@/lib/students"
import { cn } from "@/lib/utils"
import { issueCertificate } from "../actions"
import { certificateFileProblem, uploadCertificateFile } from "../upload-file"

type StudentKey = { id: string; regdNo: string; fullName: string }
type TypeOption = { id: string; code: string; name: string; needsPeriod: boolean }
type Item = {
  key: string
  file: File
  regdNo: string
  certificateNo: string
  typeId: string | null
  state: "ready" | "uploading" | "done" | "failed"
  message?: string
}

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")
const trimSeparators = (s: string) => s.replace(/^[\s._-]+|[\s._-]+$/g, "")

/** "SOM-2026-001_MS-0001.pdf" → Regd No. of the longest matching student + the rest as the certificate No. */
function guess(fileName: string, students: StudentKey[], types: TypeOption[]) {
  const base = fileName.replace(/\.[^.]+$/, "")
  const flat = alnum(base)
  let best: StudentKey | null = null
  for (const s of students) {
    const k = alnum(s.regdNo)
    if (k && flat.startsWith(k) && (!best || k.length > alnum(best.regdNo).length)) best = s
  }
  if (!best) return { regdNo: "", certificateNo: trimSeparators(base), typeId: null as string | null }
  // Skip as many characters of the original name as the Regd No. has letters/digits.
  let need = alnum(best.regdNo).length
  let i = 0
  while (i < base.length && need > 0) {
    if (/[a-z0-9]/i.test(base[i]!)) need--
    i++
  }
  let rest = trimSeparators(base.slice(i))
  let typeId: string | null = null
  const type = types.find((t) => rest.toUpperCase().startsWith(`${t.code}_`) || rest.toUpperCase().startsWith(`${t.code}-`))
  if (type) {
    typeId = type.id
    rest = trimSeparators(rest.slice(type.code.length))
  }
  return { regdNo: best.regdNo, certificateNo: rest, typeId }
}

type Props = { departmentId: string; departments: Option[]; students: StudentKey[]; types: TypeOption[] }

export function BulkUpload({ departmentId, departments, students, types }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [batch, setBatch] = useState({ typeId: types[0]?.id ?? "", issueDate: todayIso(), academicYear: "", semester: "", result: "" })
  const [dragging, setDragging] = useState(false)
  const [running, startTransition] = useTransition()

  const byRegd = useMemo(() => new Map(students.map((s) => [alnum(s.regdNo), s])), [students])
  const studentOf = (regd: string) => byRegd.get(alnum(regd)) ?? null
  const typeOf = (item: Item) => types.find((t) => t.id === (item.typeId ?? batch.typeId))

  const add = (files: FileList | File[]) => {
    const next: Item[] = []
    for (const file of Array.from(files)) {
      const problem = certificateFileProblem(file)
      if (problem) {
        toast.error(problem)
        continue
      }
      next.push({ key: `${file.name}-${file.size}-${file.lastModified}`, file, ...guess(file.name, students, types), state: "ready" })
    }
    setItems((current) => [...current, ...next.filter((n) => !current.some((c) => c.key === n.key))])
  }
  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const problemOf = (item: Item) => {
    if (!studentOf(item.regdNo)) return "No student with this Regd No. in this department"
    if (!item.certificateNo.trim()) return "Enter the certificate No."
    if (typeOf(item)?.needsPeriod && !batch.academicYear.trim()) return "This type needs the academic year (above)"
    return null
  }
  const pending = items.filter((i) => i.state !== "done")
  const ready = pending.filter((i) => !problemOf(i))

  const uploadAll = () =>
    startTransition(async () => {
      let ok = 0
      for (const item of ready) {
        const student = studentOf(item.regdNo)!
        update(item.key, { state: "uploading", message: undefined })
        try {
          const upload = await uploadCertificateFile(student.id, item.file)
          const result = await issueCertificate(
            student.id,
            {
              typeId: item.typeId ?? batch.typeId,
              certificateNo: item.certificateNo,
              issueDate: batch.issueDate,
              academicYear: batch.academicYear,
              semester: batch.semester,
              result: batch.result,
              remarks: "",
            },
            upload,
            false
          )
          if (!result.ok) throw new Error(result.error)
          update(item.key, { state: "done" })
          ok++
        } catch (e) {
          update(item.key, { state: "failed", message: e instanceof Error ? e.message : "Failed" })
        }
      }
      if (ok) toast.success(`${ok} certificate${ok === 1 ? "" : "s"} issued`)
      router.refresh()
    })

  return (
    <div className="grid gap-6">
      <section className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments.length > 1 && (
          <Field id="bu-dept" label="Department">
            {(d) => (
              <OptionSelect
                id="bu-dept"
                options={departments}
                value={departmentId}
                onChange={(v) => v && router.replace(`${pathname}?dept=${v}`)}
                aria-describedby={d}
                disabled={running}
              />
            )}
          </Field>
        )}
        <Field id="bu-type" label="Certificate type" hint="Files named with a type code (e.g. …_MARKSHEET_…) use that type instead.">
          {(d) => (
            <OptionSelect
              id="bu-type"
              options={types.map((t) => ({ value: t.id, label: t.name }))}
              value={batch.typeId || null}
              onChange={(v) => setBatch({ ...batch, typeId: v ?? "" })}
              aria-describedby={d}
            />
          )}
        </Field>
        <Field id="bu-date" label="Issue date">
          {(d) => <Input id="bu-date" type="date" value={batch.issueDate} onChange={(e) => setBatch({ ...batch, issueDate: e.target.value })} aria-describedby={d} />}
        </Field>
        <Field id="bu-ay" label="Academic year" optional>
          {(d) => (
            <Input id="bu-ay" placeholder="e.g. 2026–27" value={batch.academicYear} onChange={(e) => setBatch({ ...batch, academicYear: e.target.value })} aria-describedby={d} />
          )}
        </Field>
        <Field id="bu-sem" label="Semester" optional>
          {(d) => <Input id="bu-sem" type="number" min={1} max={20} value={batch.semester} onChange={(e) => setBatch({ ...batch, semester: e.target.value })} aria-describedby={d} />}
        </Field>
      </section>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          add(e.dataTransfer.files)
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
        )}
      >
        <Upload className="size-7 text-muted-foreground" />
        <p className="text-sm">Drop PDF or image files here</p>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={running}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={CERTIFICATE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) add(e.target.files)
            e.target.value = ""
          }}
        />
        <p className="text-xs text-muted-foreground">{students.length} students in this department can be matched.</p>
      </div>

      {items.length > 0 && (
        <>
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Regd No.</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Certificate No.</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const student = studentOf(item.regdNo)
                  const problem = item.state === "done" ? null : problemOf(item)
                  const locked = running || item.state === "done"
                  return (
                    <TableRow key={item.key}>
                      <TableCell className="max-w-48">
                        <div className="truncate text-sm" title={item.file.name}>
                          {item.file.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{formatBytes(item.file.size)}</div>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={item.regdNo}
                          onChange={(e) => update(item.key, { regdNo: e.target.value })}
                          className="h-8 w-40 font-mono text-xs"
                          disabled={locked}
                          aria-label={`Regd No. for ${item.file.name}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm">{student?.fullName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <Input
                          value={item.certificateNo}
                          onChange={(e) => update(item.key, { certificateNo: e.target.value })}
                          className="h-8 w-40 font-mono text-xs"
                          disabled={locked}
                          aria-label={`Certificate No. for ${item.file.name}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs">{typeOf(item)?.code ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {item.state === "done" ? (
                          <span className="flex items-center gap-1 text-success-text">
                            <CheckCircle2 className="size-3.5" /> Issued
                          </span>
                        ) : item.state === "uploading" ? (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" /> Uploading
                          </span>
                        ) : item.message || problem ? (
                          <span className="flex items-start gap-1 text-destructive">
                            <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {item.message ?? problem}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Ready</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.state !== "done" && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${item.file.name}`}
                            disabled={running}
                            onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}
                          >
                            <X />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-muted-foreground">
              {ready.length} of {pending.length} ready
            </span>
            <Button onClick={uploadAll} disabled={running || ready.length === 0 || !batch.typeId || !batch.issueDate}>
              {running && <Loader2 className="animate-spin" />}
              Upload &amp; issue {ready.length || ""}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
