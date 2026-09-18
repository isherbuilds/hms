import { db } from "@hms/db";
import { account, user } from "@hms/db/schema/auth";
import { hashPassword } from "better-auth/crypto";

// Mirrors what Better Auth's sign-up endpoint does internally — one `user` row and
// one credential `account` row — so `signIn.email` accepts the account unchanged.
// `emailVerified` is set so a future Google sign-in links instead of being rejected.
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
      password,
    });

    return row;
  });

  return created;
}
