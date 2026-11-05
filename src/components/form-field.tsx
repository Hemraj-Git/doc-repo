import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type FormFieldProps = React.ComponentProps<typeof Input> & {
  name: string
  label: string
  errors?: string[]
  hint?: string
}

/** Label + input + validation message, wired up for screen readers. */
export function FormField({ name, label, errors, hint, id = name, ...inputProps }: FormFieldProps) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const invalid = Boolean(errors?.length)

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={invalid || undefined}
        aria-describedby={[invalid && errorId, hint && hintId].filter(Boolean).join(" ") || undefined}
        {...inputProps}
      />
      {hint && !invalid && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {invalid && (
        <p id={errorId} className="text-xs text-destructive">
          {errors![0]}
        </p>
      )}
    </div>
  )
}
