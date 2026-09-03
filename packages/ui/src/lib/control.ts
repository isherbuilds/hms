// The border, focus ring and invalid state shared by every text-entry control.
// Input, Textarea and NativeSelect must not drift apart: a field that highlights
// differently from the one beside it reads as a different kind of field.
export const controlBase =
  "rounded-md border border-input bg-transparent text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";
