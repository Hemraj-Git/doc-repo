"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { Building2, Loader2, Plus, ShieldCheck, User, UsersRound, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { OptionSelect } from "@/components/option-select"
import { PersonCombobox } from "@/components/person-combobox"
import type { FolderGrant } from "@/lib/data/folder-access"
import { FOLDER_ACCESS_LABELS, type FolderAccess, type GranteeKind } from "@/lib/validation/folder-access"
import { cn } from "@/lib/utils"
import { loadFolderAccess, removeFolderAccess, setFolderAccess, type FolderAccessView } from "./actions"

const ACCESS_OPTIONS = (Object.keys(FOLDER_ACCESS_LABELS) as FolderAccess[]).map((a) => ({ value: a, label: FOLDER_ACCESS_LABELS[a] }))

const KINDS: { kind: GranteeKind; label: string; icon: typeof User; placeholder: string; empty: string }[] = [
  { kind: "user", label: "Person", icon: User, placeholder: "Search people in any department…", empty: "No matching people" },
  { kind: "department", label: "Department", icon: Building2, placeholder: "Search departments…", empty: "No matching departments" },
  { kind: "group", label: "Group", icon: UsersRound, placeholder: "Search groups…", empty: "No groups. Create one under Administration → Groups." },
]

function KindIcon({ kind }: { kind: GranteeKind }) {
  const className = "size-4 shrink-0 text-muted-foreground"
  if (kind === "department") return <Building2 className={className} />
  if (kind === "group") return <UsersRound className={className} />
  return <User className={className} />
}

/** "Manage access" on a folder or department page. Loads what it needs when opened. */
export function FolderAccessButton({ folder }: { folder: { id: string; name: string } }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck /> Manage access
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
          {open && <AccessPanel folder={folder} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

function AccessPanel({ folder }: { folder: { id: string; name: string } }) {
  const [view, setView] = useState<FolderAccessView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await loadFolderAccess(folder.id)
    if (result.ok) setView(result.data)
    else setLoadError(result.error)
  }, [folder.id])

  useEffect(() => {
    let cancelled = false
    void loadFolderAccess(folder.id).then((result) => {
      if (cancelled) return
      if (result.ok) setView(result.data)
      else setLoadError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [folder.id])

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Manage access: {folder.name}</DialogTitle>
        <DialogDescription>
          View lets people see and open the files. Upload also lets them add files. Access includes all sub-folders. Department heads and admins always have access.
        </DialogDescription>
      </DialogHeader>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {!view && !loadError && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      )}

      {view && (
        <>
          <div className="grid gap-1.5">
            <h3 className="text-sm font-medium">People with access</h3>
            {view.grants.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Nobody has been given access to this folder yet.</p>
            ) : (
              <ul className="grid gap-1.5">
                {view.grants.map((g) => (
                  <GrantRow key={g.id} folderId={folder.id} grant={g} onChanged={refresh} />
                ))}
              </ul>
            )}
          </div>

          {view.inherited.length > 0 && (
            <div className="grid gap-1.5">
              <h3 className="text-sm font-medium">From parent folders</h3>
              <ul className="grid gap-1.5">
                {view.inherited.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-2 text-sm">
                    <KindIcon kind={g.kind} />
                    <span className="min-w-0 flex-1 truncate">
                      {g.name} <span className="text-xs text-muted-foreground">· from {g.fromFolder}</span>
                    </span>
                    <Badge variant="outline">{FOLDER_ACCESS_LABELS[g.access]}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <AddGrant folderId={folder.id} view={view} onChanged={refresh} />
        </>
      )}
    </div>
  )
}

function GrantRow({ folderId, grant, onChanged }: { folderId: string; grant: FolderGrant; onChanged: () => Promise<void> }) {
  const [pending, startTransition] = useTransition()

  const change = (access: string | null) => {
    if (!access || access === grant.access) return
    startTransition(async () => {
      const result = await setFolderAccess(folderId, { kind: grant.kind, granteeId: grant.granteeId, access: access as FolderAccess })
      if (!result.ok) return void toast.error(result.error)
      await onChanged()
    })
  }
  const remove = () =>
    startTransition(async () => {
      const result = await removeFolderAccess(grant.id)
      if (!result.ok) return void toast.error(result.error)
      toast.success(`Access removed for ${grant.name}`)
      await onChanged()
    })

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 text-sm">
      <KindIcon kind={grant.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{grant.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[grant.hint, grant.inactive && "Inactive"].filter(Boolean).join(" · ")}
        </span>
      </span>
      <OptionSelect
        className="w-28"
        aria-label={`Access for ${grant.name}`}
        options={ACCESS_OPTIONS}
        value={grant.access}
        onChange={change}
        disabled={pending}
      />
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove access for ${grant.name}`} onClick={remove} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <X />}
      </Button>
    </li>
  )
}

function AddGrant({ folderId, view, onChanged }: { folderId: string; view: FolderAccessView; onChanged: () => Promise<void> }) {
  const [kind, setKind] = useState<GranteeKind>("user")
  const [granteeId, setGranteeId] = useState<string | null>(null)
  const [access, setAccess] = useState<FolderAccess>("read")
  const [pending, startTransition] = useTransition()
  const meta = KINDS.find((k) => k.kind === kind)!

  const taken = new Set(view.grants.filter((g) => g.kind === kind).map((g) => g.granteeId))
  const source = kind === "user" ? view.people : kind === "department" ? view.departments : view.groups
  const options = source.filter((o) => !taken.has(o.value))

  const add = () => {
    if (!granteeId) return
    startTransition(async () => {
      const result = await setFolderAccess(folderId, { kind, granteeId, access })
      if (!result.ok) return void toast.error(result.error)
      toast.success("Access given. They have been notified.")
      setGranteeId(null)
      await onChanged()
    })
  }

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <h3 className="text-sm font-medium">Give access</h3>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Give access to">
        {KINDS.map((k) => (
          <Button
            key={k.kind}
            type="button"
            size="sm"
            variant={k.kind === kind ? "secondary" : "ghost"}
            aria-pressed={k.kind === kind}
            className={cn(k.kind === kind && "font-medium")}
            onClick={() => {
              setKind(k.kind)
              setGranteeId(null)
            }}
          >
            <k.icon /> {k.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
        <PersonCombobox key={kind} people={options} value={granteeId} onChange={setGranteeId} placeholder={meta.placeholder} emptyText={meta.empty} disabled={pending} />
        <OptionSelect aria-label="Access level" options={ACCESS_OPTIONS} value={access} onChange={(v) => v && setAccess(v as FolderAccess)} disabled={pending} />
        <Button type="button" onClick={add} disabled={!granteeId || pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add
        </Button>
      </div>
    </div>
  )
}
