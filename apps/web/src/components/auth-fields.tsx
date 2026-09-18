import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { cn } from "@hms/ui/lib/utils";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { useFormContext, useFormState } from "react-hook-form";

import { ErrorNote } from "@/components/page";

// A box outline around an underline field looks wrong, so these opt out of the
// global focus floor (`data-focus-floor="off"`) and the bottom border carries
// the indicator instead: same 2px rule throughout, foreground colour on focus so
// nothing shifts. `rounded-none` beats the base `:focus-visible` radius, which
// would otherwise curl the ends of the rule up while the field is focused.
// `text-base` below `md` keeps iOS from zooming on focus.
const underline =
  "h-10 w-full rounded-none border-0 border-b-2 border-input bg-transparent px-0 text-base transition-colors duration-150 ease-out outline-none placeholder:text-muted-foreground/70 focus:border-foreground disabled:opacity-60 aria-invalid:border-destructive md:text-sm";

export function AuthField({
  name,
  label,
  children,
  className,
  ...props
}: ComponentProps<"input"> & { name: string; label: string }) {
  return (
    <RegisteredFormField
      name={name}
      render={({ field }) => (
        <FormItem className="gap-1">
          <FormLabel className="text-xs font-medium tracking-wide text-muted-foreground">
            {label}
          </FormLabel>
          <div className="relative">
            <FormControl>
              <input
                {...props}
                {...field}
                required
                data-focus-floor="off"
                className={cn(underline, className)}
              />
            </FormControl>
            {children}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function EmailField({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <AuthField
      name="email"
      label="Email"
      type="email"
      readOnly={readOnly}
      autoComplete="username"
      placeholder="you@hospital.in"
    />
  );
}

export function AuthFormFooter({ children }: { children: ReactNode }) {
  const { control } = useFormContext();
  const { errors, isSubmitting } = useFormState({ control });
  const message = errors.root?.server?.message;

  return (
    <>
      {message && <ErrorNote title={message} />}
      <SubmitButton isSubmitting={isSubmitting} shape="pill" className="h-11 w-full text-sm">
        {children}
      </SubmitButton>
    </>
  );
}

export function PasswordField({
  autoComplete,
}: {
  autoComplete: "current-password" | "new-password";
}) {
  const [reveal, setReveal] = useState(false);

  return (
    <AuthField
      name="password"
      label="Password"
      type={reveal ? "text" : "password"}
      autoComplete={autoComplete}
      placeholder="••••••••"
      className="pr-9"
    >
      <button
        type="button"
        onClick={() => setReveal((value) => !value)}
        aria-label={reveal ? "Hide password" : "Show password"}
        className="absolute top-1/2 right-0 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground"
      >
        {reveal ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </AuthField>
  );
}
