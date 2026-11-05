import { Crown, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { OrgNode } from "@/lib/data/org"
import { cn } from "@/lib/utils"

function countBelow(node: OrgNode): number {
  return node.reports.reduce((n, r) => n + 1 + countBelow(r), 0)
}

/** viewDepartmentId: department being viewed; people from other departments get a code badge. */
type ViewProps = { viewDepartmentId?: string }

function NodeCard({ node, orphan, viewDepartmentId }: { node: OrgNode; orphan?: boolean } & ViewProps) {
  const below = countBelow(node)
  const showDept = node.department.id !== viewDepartmentId
  return (
    <div
      className={cn(
        "inline-flex min-w-64 flex-col rounded-lg border bg-card px-3 py-2 shadow-xs",
        node.isHead && "border-primary/40 bg-primary/5",
        !node.isActive && "opacity-60"
      )}
    >
      <div className="flex items-center gap-1.5 font-medium">
        {node.isHead && <Crown className="size-3.5 text-primary" aria-label="Department head" />}
        {node.fullName}
        {showDept && (
          <Badge variant="outline" className="font-mono text-[10px]">
            {node.department.code}
          </Badge>
        )}
        {!node.isActive && (
          <Badge variant="outline" className="text-[10px]">
            Inactive
          </Badge>
        )}
      </div>
      <div className="text-xs text-muted-foreground">{node.designation ?? node.email}</div>
      {(below > 0 || orphan) && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
          {below > 0 && (
            <span>
              {node.reports.length} direct · {below} total below
            </span>
          )}
          {orphan && (
            <span className="flex items-center gap-1 text-warning-text">
              <TriangleAlert className="size-3" /> No reporting manager
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Branch({ node, viewDepartmentId }: { node: OrgNode } & ViewProps) {
  return (
    <li className="relative pl-6 before:absolute before:top-0 before:left-2 before:h-full before:border-l before:border-border last:before:h-5 after:absolute after:top-5 after:left-2 after:w-4 after:border-t after:border-border">
      <div className="py-1.5">
        <NodeCard node={node} viewDepartmentId={viewDepartmentId} />
      </div>
      {node.reports.length > 0 && (
        <ul>
          {node.reports.map((r) => (
            <Branch key={r.id} node={r} viewDepartmentId={viewDepartmentId} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Reporting tree, rendered as an indented outline (works at any width and prints cleanly). */
export function OrgTree({ roots, viewDepartmentId }: { roots: OrgNode[] } & ViewProps) {
  return (
    <div className="space-y-4">
      {roots.map((root) => (
        <div key={root.id}>
          <NodeCard node={root} orphan={!root.isHead} viewDepartmentId={viewDepartmentId} />
          {root.reports.length > 0 && (
            <ul className="ml-2">
              {root.reports.map((r) => (
                <Branch key={r.id} node={r} viewDepartmentId={viewDepartmentId} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
