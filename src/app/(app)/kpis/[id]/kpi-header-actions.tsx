"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Copy, Loader2, Power, PowerOff, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { deleteKpi, duplicateKpi, setKpiActive } from "../actions"

type Props = { kpiId: string; name: string; isActive: boolean; canManage: boolean; canAssign: boolean; ready: boolean }

export function KpiHeaderActions({ kpiId, name, isActive, canManage, canAssign, ready }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [deleting, setDeleting] = useState(false)

  const toggle = () =>
    startTransition(async () => {
      const result = await setKpiActive(kpiId, !isActive)
      if (!result.ok) return void toast.error(result.error)
      toast.success(isActive ? "Deactivated — it can no longer be assigned" : "Activated — it can now be assigned")
    })
  const duplicate = () =>
    startTransition(async () => {
      const result = await duplicateKpi(kpiId)
      if (!result.ok) return void toast.error(result.error)
      toast.success("Copy created")
      router.push(`/kpis/${result.data.id}`)
    })

  return (
    <>
      {canAssign && isActive && (
        <Link href={`/kpis/assign?kpi=${kpiId}`} className={buttonVariants()}>
          <Send /> Assign
        </Link>
      )}
      {canManage && (
        <>
          <Button variant="outline" onClick={toggle} disabled={pending || (!isActive && !ready)} title={!isActive && !ready ? "Weightages must total 100% and every area must say what is measured" : undefined}>
            {pending ? <Loader2 className="animate-spin" /> : isActive ? <PowerOff /> : <Power />}
            {isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button variant="outline" onClick={duplicate} disabled={pending}>
            <Copy /> Duplicate
          </Button>
          <Button variant="ghost" size="icon" aria-label="Delete KPI" onClick={() => setDeleting(true)} disabled={pending}>
            <Trash2 />
          </Button>
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title={`Delete ${name}?`}
            description="People it was assigned to keep their KPI record, evidence and scores; it just can't be assigned again."
            confirmLabel="Delete"
            destructive
            onConfirm={async () => {
              const result = await deleteKpi(kpiId)
              if (!result.ok) {
                toast.error(result.error)
                return false
              }
              toast.success("KPI deleted")
              router.push("/kpis")
            }}
          />
        </>
      )}
    </>
  )
}
