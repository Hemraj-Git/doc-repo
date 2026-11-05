import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { WidgetDef } from "@/lib/dashboard/widgets"

const SPAN: Record<WidgetDef["span"], string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "md:col-span-2 lg:col-span-3",
}

export function WidgetCard({ widget, children }: { widget: WidgetDef; children?: React.ReactNode }) {
  return (
    <Card className={cn("min-h-36", SPAN[widget.span])}>
      <CardHeader>
        <CardTitle>{widget.title}</CardTitle>
        <CardDescription>{widget.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {children ?? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed bg-muted/30 py-6 text-xs text-muted-foreground">
            Nothing to show yet
          </div>
        )}
      </CardContent>
    </Card>
  )
}
