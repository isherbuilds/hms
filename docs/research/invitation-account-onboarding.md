# Invitation account onboarding

Date: 2026-09-07. Deferred on 2026-09-08: no email provider is available for
the MVP, so D006 now uses the invitation id as the proof and native password
sign-up gated by it. The OTP implementation described below was built, verified,
and then removed from the tree; it returns when a provider exists.
The evidence below records the pre-implementation review.
Reviewed HMS on `main` at `1656ee6`, including the staged invitation-claim changes.
Installed Better Auth: 1.7.2. Online documentation currently describes 1.7.3;
implementation claims below were checked against installed 1.7.2 source.

## Question

How should an invited person create an account when HMS has no public sign-up,
while an existing account signs in and sees invitations on `/join`?

## Answer

Use one join page, invitation-gated email OTP for initial identity verification,
and password login for daily work. Let Better Auth create the verified account
and session after code verification. Then collect the name and initial password
and accept the selected invitation through the existing organization plugin.

This is a recommendation for this app, not a measured claim about onboarding
speed or a claim that all businesses use this flow. It assumes each staff member
can access an individual email inbox during setup and recovery.

The administrator enters email and role. The recipient opens the invitation,
verifies a code sent to the invited address, and completes account setup. Existing
users see password sign-in in the join page; matching signed-in users see Join.
An existing passwordless account can request a code to resume setup. A different
signed-in account gets an explicit switch-account action.

## Evidence

- HMS currently returns the invitation ID and URL to its inviter:
  [member router](../../packages/api/src/routers/member.ts), `invite`. The staged
  [claim plugin](../../packages/auth/src/invitation-claim.ts) treats this ID as
  sufficient to create a verified global user with a caller-selected password.
  This gives an organization administrator the ability to claim an unused email
  without owning its inbox. Invitation possession must grant eligibility only.
- Email delivery is not implemented: [auth configuration](../../packages/auth/src/index.ts),
  `sendInvitationEmail`, logs the link; [operations](../operations.md) documents
  this limitation. Both automated invitations and verification need a delivery
  provider. A copied invitation URL can remain useful but is not proof of email
  ownership.
- Better Auth's [Email OTP plugin](https://better-auth.com/docs/plugins/email-otp)
  supports sign-in, registration after code verification, expiry, attempt limits,
  and password recovery. Installed `dist/plugins/email-otp/routes.mjs`,
  `signInEmailOTP`, verifies the code before creating a verified user and session.
  Its `disableSignUp` option is independent of email/password sign-up.
- Installed `dist/api/routes/update-user.mjs`, `setPassword`, is a server-only
  API. It requires a sensitive session, enforces password limits, uses the native
  credential issuer and hash, and refuses to replace an existing password.
  HMS needs a small authenticated server endpoint to call it; this is not a
  browser API that can simply be added to a form.
- Better Auth [database hooks](https://better-auth.com/docs/concepts/database#database-hooks)
  can guard user creation. Installed `dist/db/with-hooks.mjs`, `createWithHooks`,
  calls `user.create.before` before inserting a user. This is the place to deny
  self-service creation without a current pending invitation for that email.
- The [organization plugin](https://better-auth.com/docs/plugins/organization)
  already owns invitation creation, resend, cancellation, and acceptance.
  Installed `dist/plugins/organization/routes/crud-invites.mjs` validates status,
  expiry, recipient email, and membership limits during acceptance. Set
  `requireEmailVerificationOnInvitation: true` explicitly.

## Alternatives

| Approach                                         | Assessment for HMS                                                                                                                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current invitation ID plus password              | Fewest steps, but admin-visible IDs cannot establish global email identity. Reject.                                                                                                                                                           |
| Guard native password sign-up, then verify email | Reuses native code, but creates credentials before mailbox proof and adds unverified-account recovery. Prefer verification first.                                                                                                             |
| Native magic link followed by account setup      | Credible alternative. An emailed link can save code entry. Copyable admin links must still request a separate private authentication link. Prefer OTP to keep setup in the original browser and avoid authenticating through link navigation. |
| OTP for every login                              | Smallest credential model; removes password setup and reset UI. It makes every fresh login depend on inbox access. Do not make this the only daily path without staff workflow evidence.                                                      |
| OTP for setup, then password login               | Recommended balance: mailbox proof once, existing login retained, native auth lifecycle.                                                                                                                                                      |
| SSO or passkeys first                            | Potential later additions. Neither is required to solve invitation onboarding.                                                                                                                                                                |

Magic link capabilities are documented by
[Better Auth](https://better-auth.com/docs/plugins/magic-link). Workflow tradeoffs
in this table are design judgments, not observed customer outcomes.

## What this means for HMS

1. Keep ordinary email/password sign-up disabled. Enable OTP account creation
   only with a server-side invitation eligibility guard. Check eligibility before
   sending codes and again at user creation; guarding the UI or send endpoint
   alone is insufficient. Existing accounts can authenticate without a pending
   invitation. Uninvited new emails cannot create accounts through direct calls.
2. Keep the invitation lookup for join-page context. Its email and organization
   are server-derived. It can choose registration versus login, but that status
   is advisory: account existence can change before submission.
3. Replace public use of `createUserWithPassword` with native OTP authentication.
   Keep that helper for operator scripts. Use the native OTP client for session
   updates instead of a bespoke session cookie response and client plugin.
4. Add one authenticated initial-password endpoint that calls `auth.api.setPassword`
   for the current verified user. Use native user update for the name. Never
   accept a target user ID or silently overwrite an existing password.
5. Give `/join` one acceptance owner. Both existing and newly created accounts
   use it. The final setup submit can continue into acceptance; users need not
   click Join again after explicitly submitting "Create account and join".
6. Keep account setup and membership as separately recoverable operations. If
   setup succeeds but joining fails, keep the session and show Retry joining.
   Read actual credential/membership state on resume; do not invent a persisted
   onboarding step or delete a global account because an invitation was revoked.
7. Reuse native resend/cancel and password recovery. Show pending/expired/accepted
   states to admins; keep delivery failure distinct from a sent invitation.
   Codes and authentication links go only to the inbox, never admin responses
   or production logs. Use native attempt limits plus request rate limits.

No new invitation table, token store, custom password hashing, or replacement
membership implementation is needed. The public claim mutation and its inferred
client plugin can go; the lookup and shared password field still have a purpose.

## What this proves / does not prove

The required native building blocks exist in installed Better Auth 1.7.2. Source
inspection does not prove browser behavior, email deliverability, total code size,
or a latency improvement. This proposal adds a mailbox verification step to the
staged flow. Its purpose is a complete identity and recovery model.

## Next falsification

Implement one representative invitation flow before broad UI refactoring. Verify
uninvited direct OTP registration is denied; revocation between sending and using
a code prevents new account creation when no valid invitation remains; an inviter
cannot claim the email from the invitation ID; and the same invitation can be
resumed after setup or acceptance errors without replacing credentials. Exercise
existing-user login, wrong-account switching, expired/resend, reload after OTP,
and desktop/mobile setup in the real app. Measure completion time with delivered
email before claiming this is faster. If staff lack individual inbox access,
revisit identity provisioning rather than adding a bypass to email verification.

## Sources

Repository owners and native source symbols are linked or named above. External
references: [Email OTP](https://better-auth.com/docs/plugins/email-otp),
[Magic link](https://better-auth.com/docs/plugins/magic-link),
[Organization](https://better-auth.com/docs/plugins/organization),
[Database hooks](https://better-auth.com/docs/concepts/database#database-hooks).

## Implementation verification — 2026-09-07

The current implementation uses native email OTP, initial password setup, and
organization acceptance. Public password signup remains disabled. The auth review
found two issues that were fixed: swallowed email callback failures and resend
rejecting comma-joined roles. Resend now uses the shared role parser.

- Repository type checks and the production web build passed.
- The full test gate passed: 256 tests plus 2 isolated resilience tests.
- Focused lint and whitespace checks passed.
- Chrome exercised OTP verification, reload into unfinished setup, name/password
  save, invitation acceptance, existing-user password login, wrong-account
  switching, password recovery, and administrator invite/resend.
- Visual inspection covered desktop and mobile join screens in light and dark
  themes. Browser email used the local outbox, not a real provider.

The browser run initially used an incorrect cookie domain. The test API was
restarted with an empty cookie-domain override for localhost; session persistence
then passed. No product cookie policy changed.

Expired multi-role invitation resend also passed in Chrome. A forced local
outbox failure showed the admin error and the saved replacement row. Restoring
the outbox and resending that row delivered the replacement link.

The initial-password retry branch passed against real server state: save the
password through the native endpoint while the setup form remains open, then
submit a different password from that form. The form continued into joining;
the original password still authenticated and the replacement was rejected.
This reproduces the persisted-server/stale-client state after a lost response.
An earlier fetch replacement did not intercept the auth client's saved fetch
reference and was not used as evidence.

Remaining verification: real Resend delivery with a verified sender and inbox.
Configure the production sender/key and exercise invite, OTP, and reset delivery
before rollout. Local outbox checks do not prove external deliverability.

## Simplification follow-up — 2026-09-07

The selected-invitation screen now owns the one acceptance handler. The picker
links to it and no longer stores the accepting invitation ID, sorts a highlighted
invitation, or derives a missing-invitation state from list results. This adds a
review step when entering from the picker. Direct invitation links keep their
existing flow. Account setup validates only name and password; the session owns
email identity.

The account-status query uses TanStack Query's `enabled` option. Organization
and invitation lists load only when the picker is shown. The existing public
invitation lookup returns the organization slug, which removes the full-organization
request after acceptance. Failed list requests produce an error before the empty
state is considered. The two changed UI files are 14 lines shorter in total;
the main reduction is in state and request orchestration.

Context7 documentation and installed Better Auth source were checked before this
change. Native `getInvitation` requires a session and rejects invitations whose
inviter is no longer a member. Replacing the public lookup with it would need a
second lookup path and change eligibility. Native `listAccounts` does not report
whether a password exists, so the precise setup-status endpoint remains. Native
OTP, password setup, and invitation acceptance remain in use. No dependency was
added or upgraded. References: [Better Auth organization documentation](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/organization.mdx)
and [TanStack dependent queries](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/dependent-queries.md).

The revised code passed 43 auth-integrity and tenancy tests (599 assertions),
repository type checks, and the production web build. Chrome verified new-user
OTP login, reload into setup, saving name/password, acceptance and navigation,
wrong-account switching, existing-user password login, and picker links back to
the selected invitation. The reloaded selected-invitation page made three auth
requests: session, setup status, and invitation context. Setup screens were
visually checked at 1440 × 1000 and 390 × 844 in light and dark themes.

The real-email delivery check above remains open.

## Lean-code verification — 2026-09-08

The invitation lookup now returns account existence in its existing query. It
no longer loads a full user row through a second lookup. On the same local test
fixture, 20 warm endpoint calls used one query instead of two. Median latency
was 3.75 ms versus 4.06 ms; p95 was 4.99 ms versus 6.34 ms. These small local
samples prove the query reduction, not a production latency improvement.

One auth-field component replaces four copies of label/input/error markup.
One form footer replaces the error and submit pair at all four call sites.
Email delivery propagates fetch errors without a catch-and-rethrow wrapper.
Production code is 61 lines shorter. No test was deleted; the existing onboarding
test now checks both account-existence states and pins the one-query lookup.

All 258 tests, repository type checks, lint, formatting, and the production web
build passed. Browser checks covered validation, password visibility, recovery
fields, local OTP delivery, setup after reload, and account setup into invitation
acceptance. Desktop and mobile auth layouts were inspected, including light and
dark mobile states. The temporary localhost API needed a restart without hot
reload to retain its empty cookie-domain override. Product cookie policy did not
change. Real Resend delivery remains the open rollout check.
