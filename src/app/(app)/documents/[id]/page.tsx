import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Ban, CalendarClock, FileText, Fingerprint } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DocumentStatusBadge } from "@/components/documents/document-status-badge"
import { canCreateDocuments, hasPerm } from "@/lib/auth/permissions"
import { requireAppContext } from "@/lib/auth/session"
import { getDocument, getDocumentActivity, type ReviewStepRow } from "@/lib/data/documents"
import { listPeoplePicker } from "@/lib/data/org"
import { listDocumentTypes, listRepositoryDepartments } from "@/lib/data/repository"
import { REVIEW_STATE_LABELS } from "@/lib/documents"
import { FORMAT_LABELS, formatBytes } from "@/lib/files"
import { formatDate, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Breadcrumbs, type Crumb } from "../../repository/breadcrumbs"
import { CopyReference } from "../../repository/copy-reference"
import { ActivityList } from "./activity-list"
import { EditDocumentButton } from "./edit-document-button"
import { FileButtons } from "./file-buttons"
import { NotApplicableControls } from "./not-applicable-controls"
import { ReviewPanel } from "./review-panel"
import { UploadPanel } from "./upload-panel"

export async function generateMetadata({ params }: PageProps<"/documents/[id]">): Promise<Metadata> {
  const { id } = await params
  const doc = await getDocument(id)
  return { title: doc?.name ?? "Document" }
}

const STATE_STYLES: Record<ReviewStepRow["state"], string> = {
  waiting: "text-muted-foreground",
  active: "border-info-line bg-info-soft text-info-text",
  approved: "border-success-line bg-success-soft text-success-text",
  rejected: "border-danger-line bg-danger-soft text-danger-text",
  skipped: "text-muted-foreground",
}

export default async function DocumentPage({ params }: PageProps<"/documents/[id]">) {
  const { id } = await params
  const [ctx, doc] = await Promise.all([requireAppContext(), getDocument(id)])
  if (!doc) notFound()

  const me = ctx.user.id
  const canManage = doc.createdBy === me || canCreateDocuments(ctx, doc.department.id)
  const canDownload = hasPerm(ctx, "document.download")
  const latest = doc.versions[0] ?? null
  const latestRound = doc.steps.length ? Math.max(...doc.steps.map((s) => s.round)) : 0
  const roundSteps = doc.steps.filter((s) => s.round === latestRound)
  const myStep = roundSteps.find((s) => s.state === "active" && s.reviewer.id === me)
  const rejection = doc.status === "changes_requested" ? roundSteps.find((s) => s.state === "rejected") : undefined
  const isUploader = doc.uploader.id === me
  const isOpen = doc.status === "pending_upload" || doc.status === "changes_requested"
  // A direct upload that is live can also be withdrawn, in case it was a mistake.
  const canMark = (isOpen || (doc.isDirect && doc.status === "approved")) && (isUploader || canManage)
  const canReopen = doc.status === "not_applicable" && canManage

  const [activity, visibleDepartments, documentTypes, people] = await Promise.all([
    getDocumentActivity(doc.id),
    listRepositoryDepartments(),
    canManage ? listDocumentTypes() : Promise.resolve([]),
    canManage ? listPeoplePicker() : Promise.resolve([]),
  ])
  const canBrowseDept = visibleDepartments.some((d) => d.id === doc.department.id)

  const crumbs: Crumb[] = doc.kpi
    ? [
        { label: "KPIs", href: doc.uploader.id === me ? "/my-kpis" : "/kpis/assignments" },
        { label: doc.kpi.name, href: `/kpis/assignments/${doc.kpi.assignmentId}` },
        { label: doc.folder.name },
        { label: doc.name },
      ]
    : canBrowseDept
    ? [
        { label: doc.department.name, href: `/repository/${doc.department.code}` },
        ...(doc.folderParent
          ? [{ label: doc.folderParent.name, href: `/repository/${doc.department.code}/${doc.folderParent.id}` }]
          : []),
        ...(doc.folder.level !== "root"
          ? [{ label: doc.folder.name, href: `/repository/${doc.department.code}/${doc.folder.id}` }]
          : []),
        { label: doc.name },
      ]
    : [{ label: doc.department.name }, { label: doc.name }]

  const rounds = [...new Set(doc.steps.map((s) => s.round))]

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={crumbs} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-5" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{doc.name}</h1>
                <DocumentStatusBadge status={doc.status} unreviewed={doc.unreviewed} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {doc.referenceId && <CopyReference value={doc.referenceId} />}
                <Badge variant="outline" className="font-mono" title={doc.type.name}>
                  {doc.type.code}
                </Badge>
                <span>{doc.folder.level === "root" ? "Standalone document" : `in ${doc.folder.name}`}</span>
                {doc.currentVersion && <span>Version {doc.currentVersion.versionNo}</span>}
                {doc.dueDate && (
                  <span className="flex items-center gap-1">
                    <CalendarClock className="size-3.5" /> Due {formatDate(doc.dueDate)}
                  </span>
                )}
              </div>
              {doc.description && <p className="max-w-3xl text-sm whitespace-pre-wrap">{doc.description}</p>}
            </div>
          </div>
          {(canManage || canMark) && (
            <div className="flex flex-wrap gap-2">
              <NotApplicableControls documentId={doc.id} canMark={canMark} canReopen={canReopen} />
              {canManage && (
            <EditDocumentButton
              documentTypes={documentTypes}
              people={people}
              mode={{
                kind: "edit",
                documentId: doc.id,
                standalone: doc.folder.level === "root",
                locked: doc.status === "in_review",
                originalReferenceId: doc.referenceId,
                values: {
                  name: doc.name,
                  documentTypeId: doc.documentTypeId,
                  referenceId: doc.referenceId ?? "",
                  description: doc.description ?? "",
                  uploaderId: doc.uploader.id,
                  requiresReview: doc.requiresReview,
                  reviewerIds: doc.reviewers.map((r) => r.id),
                  dueDate: doc.dueDate ?? "",
                },
              }}
            />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          {myStep && latest && (
            <ReviewPanel
              documentId={doc.id}
              stepId={myStep.id}
              stepOrder={myStep.stepOrder}
              totalSteps={roundSteps.length}
              version={{ id: latest.id, versionNo: latest.versionNo, fileName: latest.originalFilename, fileFormat: latest.fileFormat }}
              canDownload={canDownload}
            />
          )}
          {doc.notApplicable && (
            <div className="flex gap-3 rounded-xl border bg-muted/40 p-4 text-sm">
              <Ban className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium">Not applicable</p>
                <p className="whitespace-pre-wrap">{doc.notApplicable.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {doc.notApplicable.by ?? "Someone"} · {formatDateTime(doc.notApplicable.at)}
                </p>
              </div>
            </div>
          )}
          {isUploader && doc.status !== "in_review" && doc.status !== "not_applicable" && (
            <UploadPanel
              documentId={doc.id}
              status={doc.status}
              nextVersion={(latest?.versionNo ?? 0) + 1}
              requiresReview={doc.requiresReview}
              changeRequest={rejection ? { reviewer: rejection.reviewer.fullName, comment: rejection.comment } : null}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Current file</CardTitle>
            </CardHeader>
            <CardContent>
              {latest ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5 text-sm">
                    <div className="truncate font-medium">{latest.originalFilename}</div>
                    <div className="text-xs text-muted-foreground">
                      Version {latest.versionNo} · {FORMAT_LABELS[latest.fileFormat]} · {formatBytes(latest.sizeBytes)} · uploaded{" "}
                      {formatDateTime(latest.uploadedAt)} by {latest.uploadedBy.fullName}
                    </div>
                    <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground" title={`SHA-256 ${latest.sha256}`}>
                      <Fingerprint className="size-3" /> {latest.sha256.slice(0, 16)}…
                    </div>
                  </div>
                  <FileButtons
                    documentId={doc.id}
                    versionId={latest.id}
                    fileName={latest.originalFilename}
                    canDownload={canDownload}
                    size="default"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing uploaded yet. Waiting for {isUploader ? "you" : doc.uploader.fullName} to upload the file.
                </p>
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="versions">
            <TabsList>
              <TabsTrigger value="versions">Versions ({doc.versions.length})</TabsTrigger>
              <TabsTrigger value="reviews">Review history</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="versions" className="pt-3">
              {doc.versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No versions yet.</p>
              ) : (
                <div className="rounded-xl border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Version</TableHead>
                        <TableHead>File</TableHead>
                        <TableHead>Uploaded</TableHead>
                        <TableHead className="w-0">
                          <span className="sr-only">Open</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {doc.versions.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell className="font-medium tabular-nums">
                            v{v.versionNo}
                            {v.versionNo === doc.currentVersion?.versionNo && (
                              <div className="text-[10px] font-normal text-muted-foreground">current</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="max-w-xs truncate">{v.originalFilename}</div>
                            <div className="text-xs text-muted-foreground">
                              {FORMAT_LABELS[v.fileFormat]} · {formatBytes(v.sizeBytes)}
                            </div>
                            {v.note && <div className="mt-1 text-xs whitespace-pre-wrap">“{v.note}”</div>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDateTime(v.uploadedAt)}
                            <div>{v.uploadedBy.fullName}</div>
                          </TableCell>
                          <TableCell>
                            <FileButtons documentId={doc.id} versionId={v.id} fileName={v.originalFilename} canDownload={canDownload} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="reviews" className="pt-3">
              {!doc.requiresReview && rounds.length === 0 ? (
                <p className="text-sm text-muted-foreground">This document does not need review.</p>
              ) : rounds.length === 0 ? (
                <p className="text-sm text-muted-foreground">The review starts when the first version is uploaded.</p>
              ) : (
                <div className="grid gap-4">
                  {rounds.map((round) => {
                    const steps = doc.steps.filter((s) => s.round === round)
                    return (
                      <div key={round} className="rounded-xl border bg-card p-3">
                        <div className="mb-2 text-sm font-medium">
                          Round {round} <span className="font-normal text-muted-foreground">· version {steps[0]?.versionNo}</span>
                        </div>
                        <ol className="grid gap-2">
                          {steps.map((s) => (
                            <li key={s.id} className="flex flex-wrap items-start gap-2 text-sm">
                              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                                {s.stepOrder}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="font-medium">{s.reviewer.fullName}</span>
                                {s.comment && <span className="block text-xs whitespace-pre-wrap">“{s.comment}”</span>}
                                {s.decidedAt && (
                                  <span className="block text-xs text-muted-foreground">{formatDateTime(s.decidedAt)}</span>
                                )}
                              </span>
                              <Badge variant="outline" className={cn(STATE_STYLES[s.state])}>
                                {REVIEW_STATE_LABELS[s.state]}
                              </Badge>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="activity" className="pt-3">
              <ActivityList rows={activity.rows} lookups={activity.lookups} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>People</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <PersonLine label="Owner (department head)" name={doc.owner?.fullName ?? "No head assigned"} />
              <PersonLine label="Uploader" name={doc.uploader.fullName} you={isUploader} />
              <PersonLine label="Created by" name={doc.creator?.fullName ?? "—"} detail={formatDate(doc.createdAt)} />
              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">Reviewers {doc.requiresReview ? "(in order)" : ""}</span>
                {doc.requiresReview && doc.reviewers.length ? (
                  <ol className="grid gap-1.5">
                    {doc.reviewers.map((r) => {
                      const state = roundSteps.find((s) => s.reviewer.id === r.id)?.state
                      return (
                        <li key={r.id} className="flex items-center gap-2">
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                            {r.stepOrder}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {r.fullName}
                            {r.id === me && <span className="text-muted-foreground"> (you)</span>}
                            <span className="block truncate text-xs text-muted-foreground">
                              {[r.designation, r.departmentCode].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          {state && (
                            <Badge variant="outline" className={cn("text-[10px]", STATE_STYLES[state])}>
                              {REVIEW_STATE_LABELS[state]}
                            </Badge>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <span>No review needed</span>
                )}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function PersonLine({ label, name, detail, you }: { label: string; name: string; detail?: string; you?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span>
        {name}
        {you && <span className="text-muted-foreground"> (you)</span>}
        {detail && <span className="text-xs text-muted-foreground"> · {detail}</span>}
      </span>
    </div>
  )
}
