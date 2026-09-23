import { Form, FormFieldset } from "@hms/ui/components/form";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { AuthFormFooter, EmailField, PasswordField } from "@/components/auth-fields";
import { useZodForm } from "@/hooks/use-zod-form";
import { authClient, authErrorMessage } from "@/lib/auth-client";

const signInSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export function SignInForm({ email, onSuccess }: { email?: string; onSuccess?: () => void }) {
  const queryClient = useQueryClient();
  const form = useZodForm(signInSchema, { defaultValues: { email: email ?? "", password: "" } });

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root.server");
    const { error } = await authClient.signIn.email(values);

    if (error) {
      form.setError("root.server", {
        message: authErrorMessage(error, "Could not sign in. Try again."),
      });

      return;
    }

    // A previous account's responses must not survive into this session.
    queryClient.clear();
    onSuccess?.();
  });

  return (
    <Form {...form}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-6">
        <FormFieldset className="flex flex-col gap-6">
          <EmailField readOnly={email !== undefined} />
          <PasswordField autoComplete="current-password" autoFocus={email !== undefined} />
          <AuthFormFooter>Sign in</AuthFormFooter>
        </FormFieldset>
        <p className="text-center text-xs text-muted-foreground">
          Locked out? Ask your administrator to reset your password.
        </p>
      </form>
    </Form>
  );
}
