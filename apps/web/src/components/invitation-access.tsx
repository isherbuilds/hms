import { Button } from "@hms/ui/components/button";
import { Form, FormFieldset } from "@hms/ui/components/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { AuthField, AuthFormFooter, PasswordField } from "@/components/auth-fields";
import { ErrorNote } from "@/components/page";
import { SignInForm } from "@/components/sign-in-form";
import { useZodForm } from "@/hooks/use-zod-form";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function InvitationAccess({
  invitationId,
  accountEmail,
}: {
  invitationId: string;
  accountEmail?: string;
}) {
  const navigate = useNavigate();

  const invitation = useQuery({
    queryKey: ["auth", "invitation", invitationId],
    queryFn: async () => {
      const { data, error } = await authClient.invitation.claimStatus({ query: { invitationId } });

      if (error)
        throw new Error(authErrorMessage(error, "Could not load the invitation. Try again."));

      return data;
    },
    retry: false,
  });

  const joining = useMutation({
    mutationFn: async (organizationSlug: string) => {
      const { error } = await authClient.organization.acceptInvitation({ invitationId });

      if (error)
        throw new Error(authErrorMessage(error, "Could not join the organization. Try again."));
      await navigate({ to: "/$orgSlug/onboarding", params: { orgSlug: organizationSlug } });
    },
  });

  if (invitation.isPending)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Loading invitation…
      </p>
    );

  return (
    <div className="flex flex-col gap-6">
      {invitation.error ? (
        <ErrorNote title="Could not open this invitation" error={invitation.error} />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">Join {invitation.data.organizationName}</h2>
            <p className="break-all text-xs text-muted-foreground">
              Invited as {invitation.data.email}.
            </p>
          </div>
          {accountEmail === undefined ? (
            invitation.data.accountExists ? (
              <SignInForm email={invitation.data.email} />
            ) : (
              <SignUpForm invitationId={invitationId} email={invitation.data.email} />
            )
          ) : accountEmail !== invitation.data.email ? (
            <ErrorNote
              title="This invitation is for another account"
              detail="Switch accounts to sign in with the invited email."
            />
          ) : (
            <Button
              className="h-11 w-full text-sm"
              shape="pill"
              disabled={joining.isPending}
              onClick={() => joining.mutate(invitation.data.organizationSlug)}
            >
              {joining.isPending ? "Joining…" : "Join"}
            </Button>
          )}
        </>
      )}
      <Link to="/join" search={{}} className="text-xs underline underline-offset-4">
        View all invitations and organizations
      </Link>
    </div>
  );
}

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128),
});

// The invitation id rides along in the sign-up body (the client type has no slot
// for it) so the server can bind the new account to this invitation and email.
function SignUpForm({ invitationId, email }: { invitationId: string; email: string }) {
  const queryClient = useQueryClient();
  const form = useZodForm(signUpSchema, { defaultValues: { name: "", password: "" } });

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root.server");

    const { error } = await authClient.signUp.email({
      email,
      ...values,
      fetchOptions: { body: { invitationId } },
    });

    if (error) {
      form.setError("root.server", {
        message: authErrorMessage(error, "Could not create your account. Try again."),
      });

      return;
    }

    queryClient.clear();
  });

  return (
    <Form {...form}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-6">
        <FormFieldset className="flex flex-col gap-6">
          <AuthField name="name" label="Name" autoComplete="name" />
          <PasswordField autoComplete="new-password" />
          <AuthFormFooter>Create account</AuthFormFooter>
        </FormFieldset>
      </form>
    </Form>
  );
}
