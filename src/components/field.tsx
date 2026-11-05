import { Label } from "@/components/ui/label"

type Props = {
  id: string
  label: string
  error?: string
  hint?: React.ReactNode
  optional?: boolean
  /** Receives the aria-describedby id(s) to put on the control. */
  children: (describedBy: string | undefined) => React.ReactNode
}

/** Label, control, hint and error for any form control (select, combobox, input…). */
export function Field({ id, label, error, hint, optional, children }: Props) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children(describedBy)}
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
