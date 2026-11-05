import { Badge } from "@/components/ui/badge"

export function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="border-emerald-600/30 bg-emerald-50 text-emerald-700">
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Inactive
    </Badge>
  )
}
