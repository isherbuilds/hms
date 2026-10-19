import { parseDecimal } from "@hms/api/core/money";
import { exactToPaise, receiptLineCost } from "@hms/api/core/receipt-math";
import { createRequestContext } from "@hms/api/lib/context";
import { appRouter } from "@hms/api/routers/index";
import { auth } from "@hms/auth";
import { db } from "@hms/db";
import { member, organization, user } from "@hms/db/schema/auth";
import { goodsReceipts } from "@hms/db/schema/goods-receipts";
import { products } from "@hms/db/schema/products";
import { stockBatches } from "@hms/db/schema/stock-batches";
import { createRouterClient } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

/*
 * bun run receive-bill <bill.json> --email <your login> [--org <slug>] [--apply]
 *
 * Records one supplier bill through the same `receiveGoods` procedure as the Receive
 * goods screen, signed in as you. Without --apply it only checks the organization,
 * the products and the bill math, and writes nothing.
 */
function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);

  return at === -1 ? undefined : process.argv[at + 1];
}

const billPath = process.argv[2];

const email = flag("--email")?.toLowerCase();

const APPLY = process.argv.includes("--apply");

if (!billPath || billPath.startsWith("--") || !email) {
  console.error("Usage: bun run receive-bill <bill.json> --email <you> [--org <slug>] [--apply]");
  process.exit(1);
}

const rupees = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/);

const percent = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/);

const bill = z
  .object({
    supplier: z.string().min(1),
    reference: z.string().min(1),
    receivedOn: z.iso.date(),
    billTotal: rupees,
    lines: z
      .array(
        z.object({
          product: z.string().min(1),
          // Pins the match when two products share a name.
          productId: z.string().optional(),
          // From the bill's Pack column: 1x10 is 10.
          unitsPerPack: z.number().int().positive(),
          batch: z.string().min(1),
          expiry: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
          packs: z.number().int().positive(),
          freePacks: z.number().int().min(0),
          mrp: rupees,
          rate: rupees,
          discountPercent: percent,
          gstPercent: percent,
          hsn: z.string().optional(),
        }),
      )
      .min(1),
  })
  .parse(await Bun.file(billPath).json());

const problems: string[] = [];

const warnings: string[] = [];

const [account] = await db
  .select({ id: user.id, name: user.name })
  .from(user)
  .where(eq(user.email, email));

if (!account) {
  console.error(`No account signs in as ${email}.`);
  process.exit(1);
}

const memberships = await db
  .select({ id: organization.id, slug: organization.slug, name: organization.name })
  .from(member)
  .innerJoin(organization, eq(organization.id, member.organizationId))
  .where(eq(member.userId, account.id));

const orgSlug = flag("--org");

const org = orgSlug
  ? memberships.find((candidate) => candidate.slug === orgSlug)
  : memberships.length === 1
    ? memberships[0]
    : undefined;

if (!org) {
  console.error(
    orgSlug
      ? `${email} is not a member of "${orgSlug}".`
      : "Pass --org <slug>; this account belongs to several organizations or none.",
  );
  console.error(`Its organizations: ${memberships.map((m) => m.slug).join(", ") || "none"}`);
  process.exit(1);
}

console.info(`Organization: ${org.name} (${org.slug})`);

console.info(`Receiving as: ${account.name} <${email}>\n`);

// Case, spaces and punctuation differ between a bill and the product list.
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const lines = [];

for (const line of bill.lines) {
  const candidates = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.orgId, org.id),
        line.productId
          ? eq(products.id, line.productId)
          : sql`regexp_replace(lower(${products.name}), '[^a-z0-9]', '', 'g') like ${`%${squash(line.product)}%`}`,
      ),
    );

  console.info(`${line.product}  batch ${line.batch}`);

  if (candidates.length !== 1) {
    problems.push(
      candidates.length === 0
        ? `${line.product}: no product matches. Add it on the Items page first.`
        : `${line.product}: ${candidates.length} products match; add "productId" to the bill line.`,
    );

    for (const candidate of candidates) {
      console.info(`  candidate ${candidate.id}  "${candidate.name}"`);
    }

    continue;
  }

  const product = candidates[0]!;

  console.info(
    `  product "${product.name}": counted in ${product.stockUnit}, ${product.unitsPerPack} per pack, ` +
      `${product.expires ? "has expiry" : "no expiry"}, sale GST ${product.taxRatePercent}%, ` +
      `HSN ${product.taxCode ?? "none"}, ${product.sold ? "sold" : "not sold"}, ${product.active ? "active" : "inactive"}`,
  );

  // Stock is counted in the product's unit; the bill counts packs.
  if (product.unitsPerPack !== line.unitsPerPack && product.unitsPerPack !== 1) {
    problems.push(
      `${line.product}: the product holds ${product.unitsPerPack} per pack but the bill's pack is ${line.unitsPerPack}.`,
    );
  }

  if (product.unitsPerPack === 1 && line.unitsPerPack !== 1) {
    warnings.push(
      `${line.product}: the product counts whole packs (1 per pack), so it sells only by the pack, not by the ${line.unitsPerPack} inside.`,
    );
  }

  if (!product.expires) {
    problems.push(`${line.product}: the product is set to "no expiry" but the bill has one.`);
  }

  if (product.sold && parseDecimal(product.taxRatePercent) !== parseDecimal(line.gstPercent)) {
    warnings.push(
      `${line.product}: sale GST is ${product.taxRatePercent}% but the bill charges ${line.gstPercent}%.`,
    );
  }

  if (line.hsn && product.taxCode !== line.hsn) {
    warnings.push(
      `${line.product}: HSN on the product is ${product.taxCode ?? "empty"}, the bill says ${line.hsn}.`,
    );
  }

  if (!product.sold) warnings.push(`${line.product}: not marked as sold at the counter.`);

  if (!product.active) warnings.push(`${line.product}: the product is inactive.`);

  const [existing] = await db
    .select()
    .from(stockBatches)
    .where(
      and(
        eq(stockBatches.orgId, org.id),
        eq(stockBatches.productId, product.id),
        eq(stockBatches.batchNumber, line.batch),
      ),
    );

  if (existing) {
    console.info(
      `  batch ${line.batch} already exists: expiry ${existing.expiryDate}, MRP ${existing.mrp} paise per ${existing.mrpUnits}`,
    );
  }

  const unitsPerPack = product.unitsPerPack;

  lines.push({
    productId: product.id,
    batchNumber: line.batch,
    expiryDate: line.expiry,
    mrp: parseDecimal(line.mrp),
    pricedPer: "pack" as const,
    qty: line.packs * unitsPerPack,
    cost: {
      freeQty: line.freePacks * unitsPerPack,
      rate: parseDecimal(line.rate),
      discountPercent: line.discountPercent,
      gstPercent: line.gstPercent,
      hsnCode: line.hsn,
    },
    unitsPerPack,
    packs: line.packs,
    stockUnit: product.stockUnit,
  });
}

const billTotal = parseDecimal(bill.billTotal);

let exactNet = 0n;

let exactTaxable = 0n;

for (const line of lines) {
  const cost = receiptLineCost({ qty: line.qty, packSize: line.unitsPerPack, ...line.cost });

  exactNet += cost.net;
  exactTaxable += cost.taxable;
  console.info(
    `  → ${line.packs} packs = ${line.qty} ${line.stockUnit} onto the shelf, ` +
      `line ₹${(Number(exactToPaise(cost.taxable)) / 100).toFixed(2)} before GST`,
  );
}

const linesTotal = exactToPaise(exactNet);

console.info(
  `\nBefore GST ₹${(Number(exactToPaise(exactTaxable)) / 100).toFixed(2)}, ` +
    `with GST ₹${(Number(linesTotal) / 100).toFixed(2)}, bill says ₹${bill.billTotal}`,
);

if (linesTotal - billTotal > 99n || billTotal - linesTotal > 99n) {
  problems.push("The lines do not add up to the bill total.");
}

const [duplicate] = await db
  .select({ id: goodsReceipts.id, receivedOn: goodsReceipts.receivedOn })
  .from(goodsReceipts)
  .where(
    and(
      eq(goodsReceipts.orgId, org.id),
      eq(goodsReceipts.supplierReference, bill.reference),
      sql`lower(${goodsReceipts.supplierName}) = ${bill.supplier.toLowerCase()}`,
    ),
  );

if (duplicate) {
  problems.push(
    `Bill ${bill.reference} from ${bill.supplier} was already received on ${duplicate.receivedOn}.`,
  );
}

for (const warning of warnings) console.warn(`\nCheck: ${warning}`);

for (const problem of problems) console.error(`\nStop: ${problem}`);

if (problems.length > 0) {
  console.error("\nNothing was written.");
  process.exit(1);
}

if (!APPLY) {
  console.info(
    "\nAll checks passed. Nothing was written; re-run with --apply to receive the stock.",
  );
  process.exit(0);
}

const password = prompt(`Password for ${email}:`);

if (!password) {
  console.error("No password entered. Nothing was written.");
  process.exit(1);
}

const { headers } = await auth.api.signInEmail({
  body: { email, password },
  returnHeaders: true,
});

const cookie = headers.get("set-cookie")?.split(";")[0];

if (!cookie) throw new Error(`Sign-in for ${email} returned no session cookie`);

const session = new Headers({ cookie });

const api = createRouterClient(appRouter, { context: () => createRequestContext(session) });

try {
  const received = await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: bill.supplier,
    supplierReference: bill.reference,
    receivedOn: bill.receivedOn,
    billTotal,
    lines: lines.map(({ unitsPerPack: _u, packs: _p, stockUnit: _s, ...line }) => line),
  });

  console.info(`\nReceived. Goods receipt ${received.receiptId}:`);

  for (const batch of received.batches) console.info(`  batch ${batch.batchNumber}`);
} finally {
  await auth.api.signOut({ headers: session });
}

process.exit(0);
