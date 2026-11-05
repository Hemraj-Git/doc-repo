"use client"

import { useEffect, useState, useTransition } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Pencil, Plus } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Field } from "@/components/field"
import { StatusBadge } from "@/components/status-badge"
import type { CertificateType } from "@/lib/data/students"
import { certificateTypeSchema, type CertificateTypeInput } from "@/lib/validation/students"
import { createCertificateType, updateCertificateType } from "../../students/actions"

export function CertificateTypesTable({ types }: { types: CertificateType[] }) {
  // undefined = closed, null = new, row = editing
  const [editing, setEditing] = useState<CertificateType | null | undefined>(undefined)

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing(null)}>
          <Plus /> New certificate type
        </Button>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Needs academic year</TableHead>
              <TableHead>Result on portal</TableHead>
              <TableHead className="text-right">Issued</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((t) => (
              <TableRow key={t.id} className={t.isActive ? undefined : "text-muted-foreground"}>
                <TableCell className="font-mono text-xs">{t.code}</TableCell>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{t.needsPeriod ? <Badge variant="secondary">Yes</Badge> : "—"}</TableCell>
                <TableCell>{t.showResult ? <Badge variant="secondary">Shown</Badge> : "Hidden"}</TableCell>
                <TableCell className="text-right tabular-nums">{t.certificateCount}</TableCell>
                <TableCell>
                  <StatusBadge active={t.isActive} />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.code}`} onClick={() => setEditing(t)}>
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TypeDialog type={editing} onClose={() => setEditing(undefined)} />
    </>
  )
}

function TypeDialog({ type, onClose }: { type: CertificateType | null | undefined; onClose: () => void }) {
  const [pending, startTransition] = useTransition()
  const form = useForm<CertificateTypeInput>({
    resolver: zodResolver(certificateTypeSchema),
    defaultValues: { code: "", name: "", needsPeriod: false, showResult: false, isActive: true },
  })
  const { errors } = form.formState

  useEffect(() => {
    if (type === undefined) return
    form.reset({
      code: type?.code ?? "",
      name: type?.name ?? "",
      needsPeriod: type?.needsPeriod ?? false,
      showResult: type?.showResult ?? false,
      isActive: type?.isActive ?? true,
    })
  }, [type, form])

  const submit = form.handleSubmit(() =>
    startTransition(async () => {
      const values = form.getValues()
      const result = type ? await updateCertificateType(type.id, values) : await createCertificateType(values)
      if (!result.ok) {
        Object.entries(result.fieldErrors ?? {}).forEach(([f, message]) => form.setError(f as keyof CertificateTypeInput, { message }))
        return void toast.error(result.error)
      }
      toast.success(type ? "Certificate type updated" : "Certificate type created")
      onClose()
    })
  )

  const toggle = (name: "needsPeriod" | "showResult" | "isActive", label: string, hint: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <span>
            <span className="block text-sm font-medium">{label}</span>
            <span className="block text-xs text-muted-foreground">{hint}</span>
          </span>
          <Switch checked={field.value} onCheckedChange={field.onChange} />
        </label>
      )}
    />
  )

  return (
    <Dialog open={type !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{type ? `Edit ${type.code}` : "New certificate type"}</DialogTitle>
            <DialogDescription>Changes apply to the portal immediately, including for certificates already issued.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
            <Field id="ct-code" label="Code" error={errors.code?.message}>
              {(d) => <Input id="ct-code" className="uppercase" aria-describedby={d} {...form.register("code")} />}
            </Field>
            <Field id="ct-name" label="Name" error={errors.name?.message}>
              {(d) => <Input id="ct-name" aria-describedby={d} {...form.register("name")} />}
            </Field>
          </div>
          {toggle("needsPeriod", "Needs academic year", "e.g. semester marksheets.")}
          {toggle("showResult", "Show result on the public portal", "The grade / CGPA appears to verifiers.")}
          {toggle("isActive", "Active", "Inactive types cannot be chosen for new certificates.")}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
