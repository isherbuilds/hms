import { db } from "@hms/db";
import { account, user } from "@hms/db/schema/auth";
import { createLocalAccountIssuer } from "better-auth/db";
import { hashPassword } from "better-auth/crypto";
/**
 * Creates a user account the way an operator would: directly in the database,
 * with a password hashed by Better Auth's own algorithm. The public sign-up
 * endpoint is disabled (`emailAndPassword.disableSignUp`), so this is the only
 * way an account comes into existence.
 *
 * Mirrors what Better Auth's sign-up endpoint does internally — one `user`
 * row and one `credential` `account` row — so the account is
 * indistinguishable from one that could have registered while sign-up was
 * open, and `signIn.email` accepts it unchanged.
 *
 * `emailVerified` is set so a future Google sign-in with the same address
 * links to this account instead of being rejected (`account_not_linked`).
 */
export async function createUserWithPassword(input: {
  email: string;
  name: string;
  password: string;
}): Promise<{ id: string }> {
  const id = Bun.randomUUIDv7();
  // Hash before the transaction so a hashing failure leaves no rows behind.
  const password = await hashPassword(input.password);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(user)
      .values({
        id,
        name: input.name,
        email: input.email.toLowerCase(),
        emailVerified: true,
      })
      .returning({ id: user.id });
    if (!row) {
      throw new Error(`Failed to create user ${input.email}`);
    }
    await tx.insert(account).values({
      id: Bun.randomUUIDv7(),
      userId: id,
      accountId: id,
      providerId: "credential",
      // The synthetic issuer Better Auth 1.7's sign-in filters credential
      // accounts by; without it the account cannot authenticate.
      issuer: createLocalAccountIssuer("credential"),
      password,
    });
    return row;
  });

  return created;
}
