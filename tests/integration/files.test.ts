import { beforeAll, expect, test } from "bun:test";

import { createOrganization, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

async function putBytes(url: string, body: string, contentType: string): Promise<Response> {
  return fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
}

test("a file is uploaded, finalized, read only via a signature, and deleted", async () => {
  const owner = await createTestUser("owner");
  const org = await createOrganization(owner, "files-alpha");
  const api = clientFor(owner);

  const body = "the quick brown fox";
  const upload = await api.file.createUpload({
    orgSlug: org.slug,
    name: "notes.txt",
    mimeType: "text/plain",
    size: body.length,
  });

  expect(upload.key.startsWith(`${org.id}/`)).toBe(true);

  const put = await putBytes(upload.uploadUrl, body, "text/plain");
  expect(put.status).toBe(200);

  await expectORPCCode(api.file.getReadUrl({ orgSlug: org.slug, key: upload.key }), "NOT_FOUND");
  expect((await api.file.list({ orgSlug: org.slug })).items).toHaveLength(0);

  const finalized = await api.file.finalizeUpload({
    orgSlug: org.slug,
    key: upload.key,
  });
  expect(finalized.status).toBe("ready");

  await expectORPCCode(
    api.file.finalizeUpload({ orgSlug: org.slug, key: upload.key }),
    "NOT_FOUND",
  );

  const listed = await api.file.list({ orgSlug: org.slug });
  expect(listed.items.map((file) => file.id)).toContain(upload.key);

  const read = await api.file.getReadUrl({ orgSlug: org.slug, key: upload.key });
  expect(read.url).toContain("X-Amz-Signature");
  const fetched = await fetch(read.url);
  expect(fetched.status).toBe(200);
  expect(await fetched.text()).toBe(body);

  // Unsigned: what a "public files" feature would have handed out. The gateway
  // must refuse it.
  const signed = new URL(read.url);
  const unsigned = await fetch(`${signed.origin}${signed.pathname}`);
  expect(unsigned.status).toBeGreaterThanOrEqual(400);

  await api.file.delete({ orgSlug: org.slug, key: upload.key });
  expect((await api.file.list({ orgSlug: org.slug })).items).toHaveLength(0);
  await expectORPCCode(api.file.getReadUrl({ orgSlug: org.slug, key: upload.key }), "NOT_FOUND");
});

test("another org's file key is FORBIDDEN, not merely missing", async () => {
  const alice = await createTestUser("alice");
  const alpha = await createOrganization(alice, "files-alpha-2");
  const aliceApi = clientFor(alice);

  const upload = await aliceApi.file.createUpload({
    orgSlug: alpha.slug,
    name: "chart.txt",
    size: 5,
  });
  await putBytes(upload.uploadUrl, "chart", "text/plain");
  await aliceApi.file.finalizeUpload({ orgSlug: alpha.slug, key: upload.key });

  const bob = await createTestUser("bob");
  const beta = await createOrganization(bob, "files-beta-2");
  const bobApi = clientFor(bob);

  expect((await bobApi.file.list({ orgSlug: beta.slug })).items).toHaveLength(0);
  await expectORPCCode(
    bobApi.file.getReadUrl({ orgSlug: beta.slug, key: upload.key }),
    "FORBIDDEN",
  );
  await expectORPCCode(bobApi.file.delete({ orgSlug: beta.slug, key: upload.key }), "FORBIDDEN");
  await expectORPCCode(
    bobApi.file.finalizeUpload({ orgSlug: beta.slug, key: upload.key }),
    "FORBIDDEN",
  );

  expect((await aliceApi.file.list({ orgSlug: alpha.slug })).items.map((f) => f.id)).toContain(
    upload.key,
  );
});

test("a plain member cannot delete a file, an admin in the same org can", async () => {
  const owner = await createTestUser("owner");
  const org = await createOrganization(owner, "files-roles");
  const ownerApi = clientFor(owner);

  const upload = await ownerApi.file.createUpload({
    orgSlug: org.slug,
    name: "policy.txt",
    size: 6,
  });
  await putBytes(upload.uploadUrl, "policy", "text/plain");
  await ownerApi.file.finalizeUpload({ orgSlug: org.slug, key: upload.key });

  const person = await createTestUser("member");
  await joinOrganization(person, org.id);
  await expectORPCCode(
    clientFor(person).file.delete({ orgSlug: org.slug, key: upload.key }),
    "FORBIDDEN",
  );

  const admin = await createTestUser("admin");
  await joinOrganization(admin, org.id, "admin");
  await clientFor(admin).file.delete({ orgSlug: org.slug, key: upload.key });
  expect((await ownerApi.file.list({ orgSlug: org.slug })).items).toHaveLength(0);
});
