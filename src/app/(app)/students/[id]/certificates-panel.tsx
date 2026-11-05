"use client"

import { useState, useTransition } from "react"
import { Ban, Download, Eye, FilePlus2, FileUp, Loader2, MoreHorizontal, QrCode } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/field"
import { OptionSelect } from "@/components/option-select"
import type { CertificateRow, CertificateType } from "@/lib/data/students"
import { formatBytes } from "@/lib/files"
import { formatDate, formatDateTime, todayIso } from "@/lib/format"
import { CERTIFICATE_ACCEPT, CERTIFICATE_STATUS_LABELS, CERTIFICATE_STATUS_STYLES } from "@/lib/students"
import { certificateQr, getCertificateFileUrl, issueCertificate, replaceCertificateFile, revokeCertificate } from "../actions"
import { certificateFileProblem, uploadCertificateFile } from "../upload-file"

type Props = {
  studentId: string
  studentName: string
  certificates: CertificateRow[]
  types: CertificateType[]
  canManage: boolean
  canDownload: boolean
}

type Dialogs =
  | { kind: "issue" }
  | { kind: "replace"; cert: CertificateRow }
  | { kind: "revoke"; cert: CertificateRow }
  | { kind: "qr"; cert: CertificateRow; url: string; dataUrl: string }
  | null

export function CertificatesPanel({ studentId, studentName, certificates, types, canManage, canDownload }: Props) {
  const [dialog, setDialog] = useState<Dialogs>(null)
  const [, startTransition] = useTransition()

  // These run from a menu that closes on click, so a toast shows that something is happening.
  const open = (fileId: string | null, mode: "view" | "download") =>
    startTransition(async () => {
      if (!fileId) return
      const busy = toast.loading(mode === "view" ? "Opening the certificate…" : "Preparing the download…")
      const result = await getCertificateFileUrl(fileId, mode)
      toast.dismiss(busy)
      if (!result.ok) return void toast.error(result.error)
      if (mode === "view") window.open(result.data.url, "_blank", "noopener")
      else window.location.href = result.data.url
    })

  const showQr = (cert: CertificateRow) =>
    startTransition(async () => {
      const busy = toast.loading("Preparing the QR code…")
      const result = await certificateQr(cert.id)
      toast.dismiss(busy)
      if (!result.ok) return void toast.error(result.error)
      setDialog({ kind: "qr", cert, ...result.data })
    })

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          A certificate is issued — and publicly verifiable — as soon as it is uploaded. Revoked or replaced certificates show as such on the portal.
        </p>
        {canManage && (
          <Button onClick={() => setDialog({ kind: "issue" })}>
            <FilePlus2 /> Upload certificate
          </Button>
        )}
      </div>

      {certificates.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">No certificates yet.</div>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Certificate</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {certificates.map((c) => {
                const current = c.files.find((f) => f.id === c.currentFileId) ?? c.files[0]
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{c.type.name}</div>
                      {current && (
                        <div className="text-xs text-muted-foreground">
                          {current.originalFilename} · {formatBytes(current.sizeBytes)}
                          {c.files.length > 1 ? ` · v${current.versionNo}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.certificateNo}</TableCell>
                    <TableCell className="text-sm">{formatDate(c.issueDate)}</TableCell>
                    <TableCell className="text-sm">
                      {[c.academicYear, c.semester ? `Sem ${c.semester}` : null].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.result ?? "—"}
                      {c.result && !c.type.showResult && <div className="text-[11px] text-muted-foreground">not shown publicly</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={CERTIFICATE_STATUS_STYLES[c.status]}>
                        {CERTIFICATE_STATUS_LABELS[c.status]}
                      </Badge>
                      {c.status !== "issued" && (
                        <div className="mt-1 max-w-48 text-[11px] text-muted-foreground">
                          {c.statusChangedAt && formatDate(c.statusChangedAt)}
                          {c.replacedByNo ? ` · by ${c.replacedByNo}` : ""}
                          {c.statusReason ? ` · ${c.statusReason}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.certificateNo}`} />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => open(c.currentFileId, "view")}>
                            <Eye /> View
                          </DropdownMenuItem>
                          {canDownload && (
                            <DropdownMenuItem onClick={() => open(c.currentFileId, "download")}>
                              <Download /> Download
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => showQr(c)}>
                            <QrCode /> QR code &amp; link
                          </DropdownMenuItem>
                          {canManage && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setDialog({ kind: "replace", cert: c })}>
                                <FileUp /> Replace file
                              </DropdownMenuItem>
                              {c.status === "issued" && (
                                <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "revoke", cert: c })}>
                                  <Ban /> Revoke or mark replaced
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {certificates.some((c) => c.files.length > 1) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Earlier files</summary>
          <ul className="mt-2 space-y-1">
            {certificates.flatMap((c) =>
              c.files
                .filter((f) => f.id !== c.currentFileId)
                .map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{c.certificateNo}</span> v{f.versionNo} · {f.originalFilename} · {formatDateTime(f.uploadedAt)} by{" "}
                    {f.uploadedBy}
                    <button type="button" className="text-primary hover:underline" onClick={() => open(f.id, "view")}>
                      View
                    </button>
                  </li>
                ))
            )}
          </ul>
        </details>
      )}

      <IssueDialog open={dialog?.kind === "issue"} onClose={() => setDialog(null)} studentId={studentId} types={types} />
      {dialog?.kind === "replace" && <ReplaceDialog cert={dialog.cert} studentId={studentId} onClose={() => setDialog(null)} />}
      {dialog?.kind === "revoke" && <RevokeDialog cert={dialog.cert} onClose={() => setDialog(null)} />}
      <Dialog open={dialog?.kind === "qr"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          {dialog?.kind === "qr" && (
            <>
              <DialogHeader>
                <DialogTitle>Verification QR · {dialog.cert.certificateNo}</DialogTitle>
                <DialogDescription>Print this on the certificate. Scanning it shows the certificate’s current status.</DialogDescription>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL */}
              <img src={dialog.dataUrl} alt={`QR code for ${dialog.cert.certificateNo}`} className="mx-auto size-56 rounded border" />
              <Input readOnly value={dialog.url} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
              <DialogFooter>
                <Button variant="outline" onClick={() => navigator.clipboard.writeText(dialog.url).then(() => toast.success("Link copied"))}>
                  Copy link
                </Button>
                <a
                  href={dialog.dataUrl}
                  download={`QR-${studentName.replace(/\W+/g, "_")}-${dialog.cert.certificateNo.replace(/\W+/g, "_")}.png`}
                  className={buttonVariants()}
                >
                  <Download /> Download PNG
                </a>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function FilePicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  return (
    <div className="grid gap-1.5">
      <Input
        type="file"
        accept={CERTIFICATE_ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          const problem = f && certificateFileProblem(f)
          if (problem) {
            toast.error(problem)
            e.target.value = ""
            return onChange(null)
          }
          onChange(f)
        }}
      />
      <p className="text-xs text-muted-foreground">{file ? `${file.name} · ${formatBytes(file.size)}` : "PDF or image (JPG, PNG, WebP), up to 20 MB."}</p>
    </div>
  )
}

function IssueDialog({ open, onClose, studentId, types }: { open: boolean; onClose: () => void; studentId: string; types: CertificateType[] }) {
  const [pending, startTransition] = useTransition()
  const [values, setValues] = useState({ typeId: "", certificateNo: "", issueDate: todayIso(), academicYear: "", semester: "", result: "", remarks: "" })
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const type = types.find((t) => t.id === values.typeId)
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues({ ...values, [k]: e.target.value })

  const save = () =>
    startTransition(async () => {
      if (!file) return void setErrors({ file: "Choose the certificate file" })
      try {
        const upload = await uploadCertificateFile(studentId, file)
        const result = await issueCertificate(studentId, values, upload)
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {})
          return void toast.error(result.error)
        }
        toast.success(`${type?.name ?? "Certificate"} ${values.certificateNo} issued`)
        setValues({ ...values, certificateNo: "", result: "", remarks: "" })
        setFile(null)
        onClose()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed")
      }
    })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload certificate</DialogTitle>
          <DialogDescription>It is issued immediately and can be verified on the public portal.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="ci-type" label="Certificate type" error={errors.typeId}>
              {(d) => (
                <OptionSelect
                  id="ci-type"
                  options={types.map((t) => ({ value: t.id, label: t.name }))}
                  value={values.typeId || null}
                  onChange={(v) => setValues({ ...values, typeId: v ?? "" })}
                  aria-describedby={d}
                />
              )}
            </Field>
          </div>
          <Field id="ci-no" label="Certificate No." error={errors.certificateNo}>
            {(d) => <Input id="ci-no" value={values.certificateNo} onChange={set("certificateNo")} aria-describedby={d} />}
          </Field>
          <Field id="ci-date" label="Issue date" error={errors.issueDate}>
            {(d) => <Input id="ci-date" type="date" value={values.issueDate} onChange={set("issueDate")} aria-describedby={d} />}
          </Field>
          <Field id="ci-ay" label="Academic year" optional={!type?.needsPeriod} error={errors.academicYear}>
            {(d) => <Input id="ci-ay" placeholder="e.g. 2026–27" value={values.academicYear} onChange={set("academicYear")} aria-describedby={d} />}
          </Field>
          <Field id="ci-sem" label="Semester" optional error={errors.semester}>
            {(d) => <Input id="ci-sem" type="number" min={1} max={20} value={values.semester} onChange={set("semester")} aria-describedby={d} />}
          </Field>
          <Field
            id="ci-result"
            label="Result / grade"
            optional
            error={errors.result}
            hint={type ? (type.showResult ? "Shown on the public portal." : "Not shown on the public portal for this type.") : undefined}
          >
            {(d) => <Input id="ci-result" value={values.result} onChange={set("result")} aria-describedby={d} />}
          </Field>
          <Field id="ci-remarks" label="Remarks" optional error={errors.remarks}>
            {(d) => <Textarea id="ci-remarks" rows={1} value={values.remarks} onChange={set("remarks")} aria-describedby={d} />}
          </Field>
          <div className="sm:col-span-2">
            <Field id="ci-file" label="File" error={errors.file}>
              {() => <FilePicker file={file} onChange={setFile} />}
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Upload &amp; issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReplaceDialog({ cert, studentId, onClose }: { cert: CertificateRow; studentId: string; onClose: () => void }) {
  const [pending, startTransition] = useTransition()
  const [reason, setReason] = useState("")
  const [file, setFile] = useState<File | null>(null)

  const save = () =>
    startTransition(async () => {
      if (!file) return void toast.error("Choose the new file")
      if (!reason.trim()) return void toast.error("Give a reason")
      try {
        const upload = await uploadCertificateFile(studentId, file)
        const result = await replaceCertificateFile(cert.id, reason, upload)
        if (!result.ok) return void toast.error(result.error)
        toast.success("File replaced; the earlier file is kept")
        onClose()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed")
      }
    })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Replace file · {cert.certificateNo}</DialogTitle>
          <DialogDescription>For a corrected scan of the same certificate. The number and status stay the same.</DialogDescription>
        </DialogHeader>
        <Field id="cr-reason" label="Reason">
          {(d) => <Textarea id="cr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={d} />}
        </Field>
        <FilePicker file={file} onChange={setFile} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevokeDialog({ cert, onClose }: { cert: CertificateRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition()
  const [reason, setReason] = useState("")
  const [replacement, setReplacement] = useState("")

  const save = () =>
    startTransition(async () => {
      const result = await revokeCertificate(cert.id, reason, replacement)
      if (!result.ok) return void toast.error(result.error)
      toast.success(replacement.trim() ? "Marked as replaced" : "Certificate revoked")
      onClose()
    })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revoke {cert.certificateNo}?</DialogTitle>
          <DialogDescription>
            The public portal will show it as revoked from today. This cannot be undone. If a corrected certificate was issued with a new number, enter it to
            mark this one as replaced instead.
          </DialogDescription>
        </DialogHeader>
        <Field id="rv-reason" label="Reason">
          {(d) => <Textarea id="rv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={d} />}
        </Field>
        <Field id="rv-new" label="Replaced by certificate No." optional hint="Upload the new certificate first.">
          {(d) => <Input id="rv-new" value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-describedby={d} />}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={save} disabled={pending || !reason.trim()}>
            {pending && <Loader2 className="animate-spin" />}
            {replacement.trim() ? "Mark replaced" : "Revoke"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
