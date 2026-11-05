import { FileText, Folder, FolderTree } from "lucide-react"
import { buildTree, exampleName, type TemplateNode, type TemplateTreeNode } from "@/lib/templates"

type Props = {
  instanceLabel: string
  tree: TemplateTreeNode[]
  /** Nodes of templates used by slots, for nesting their preview. */
  slotNodes: Record<string, TemplateNode[]>
  templates: Record<string, { name: string; instanceLabel: string }>
}

const STORAGE_PATH = {
  here: "",
  academic_year: " → 2026–27/",
  academic_year_semester: " → 2026–27/Semester 1/",
} as const

/** What an instance will look like, with example names. Slots show two example entries. */
export function TemplatePreview({ instanceLabel, tree, slotNodes, templates }: Props) {
  const renderList = (list: TemplateTreeNode[], depth: number): React.ReactNode => (
    <ul className="ml-4 border-l pl-3">
      {list.map((n) => {
        if (n.kind === "folder") {
          return (
            <li key={n.id} className="py-0.5">
              <span className="flex items-center gap-1.5">
                <Folder className="size-3.5 text-primary" /> {n.name}
              </span>
              {n.children.length > 0 && renderList(n.children, depth)}
            </li>
          )
        }
        if (n.kind === "document") {
          return (
            <li key={n.id} className="flex items-center gap-1.5 py-0.5 text-muted-foreground">
              <FileText className="size-3.5 shrink-0" />
              <span className="truncate">
                {exampleName(n.name, n.recurrence)}
                <span className="text-xs">{STORAGE_PATH[n.storage]}</span>
              </span>
            </li>
          )
        }
        const child = n.slotTemplateId ? templates[n.slotTemplateId] : undefined
        const childTree = n.slotTemplateId ? buildTree(slotNodes[n.slotTemplateId] ?? []) : []
        return (
          <li key={n.id} className="py-0.5">
            <span className="text-xs text-muted-foreground">
              ↻ one per entry of “{n.name}”{child ? ` (${child.name} template)` : ""}
            </span>
            {depth < 3 &&
              [1, 2].map((i) => (
                <div key={i} className="py-0.5">
                  <span className="flex items-center gap-1.5">
                    <FolderTree className="size-3.5 text-primary" />
                    <span className="italic">
                      {child?.instanceLabel ?? "Entry"} {i}
                    </span>
                  </span>
                  {childTree.length > 0 && renderList(childTree, depth + 1)}
                </div>
              ))}
          </li>
        )
      })}
    </ul>
  )

  return (
    <section className="space-y-3">
      <h2 className="section-heading">Preview</h2>
      <div className="rounded-xl border bg-muted/20 p-4 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <FolderTree className="size-4 text-primary" />
          <span className="italic">‹{instanceLabel}›</span>
        </span>
        {tree.length ? renderList(tree, 0) : <p className="mt-2 text-muted-foreground">Nothing yet.</p>}
      </div>
      <p className="text-xs text-muted-foreground">
        Recurring items are created by the scheduler each period. Example names use the current academic year.
      </p>
    </section>
  )
}
