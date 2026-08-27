# Billing PDF rendering foundation

## Question

Is the unstaged Takumi-based billing PDF implementation a simple, safe, and
performant foundation for future printed documents?

## Answer

The review found that `takumi-pdf` is a reasonable renderer, but the first local
implementation was not a sound foundation. The accepted remediation now uses
Takumi's native HTML/CSS model, keeps the renderer behind a real server-only
dynamic boundary, bundles Devanagari coverage, and removes mutable theme state.
The product still needs accountant and physical-printer validation before it
assigns statutory labels.

## Evidence

- TanStack Start code is isomorphic by default, so heavy or server-only imports
  need an explicit environment boundary. Document enums and URLs now live in
  `apps/web/src/lib/billing-document.ts`; only the server endpoint dynamically
  imports `billing-pdf.tsx`. [TanStack Start execution model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model)
- Takumi's migration guidance says an `@react-pdf/renderer` implementation should
  replace `Document`, `View`, `Text`, and `StyleSheet` with HTML and CSS. The
  accepted implementation now uses semantic elements directly in
  `apps/web/src/components/pdf/billing-documents.tsx`.
  [Takumi README](https://github.com/kane50613/takumi#coming-from-something-else)
- Takumi ships only a last-resort Latin font; other scripts must be registered.
  The renderer now pairs Takumi's shipped Latin sans with bundled Noto Sans
  Devanagari subsets, and the regression fixture renders stored Devanagari.
  [Takumi font guidance](https://github.com/kane50613/takumi#fonts)
- The product distinguishes an internal Invoice from its printed classification
  and requires accountant approval for printed fields (`docs/product.md:90-106`).
  The implemented form therefore uses the neutral label `Invoice`. Real-printer
  and accountant validation remain open in the research ledger.
- Financial rows snapshot the organization-local Business Date at issuance.
  Templates render that immutable date rather than deriving a calendar date from
  `createdAt`, which would be wrong at timezone and fiscal-year boundaries.

## What this proves / does not prove

This proves why the original boundary, abstraction, and font choices needed to
change. Automated rendering and visual inspection can establish software layout
quality; they do not prove physical-printer behavior or which legal
classification and fields the pilot must use.

## What this means for us

Retain the renderer and the narrow billing templates. Preserve the dependency-
free request module, semantic table pagination, application-owned fonts, strict
request parsing, and immutable-source rule. Require product/accounting decisions
before encoding statutory labels.

## Next falsification

Repeat the long A4 and 80 mm fixtures when the renderer or templates change.
Before pilot launch, inspect output on the physical printer and have the pilot
accountant approve the classification and printed-field matrix.

## Sources

- [TanStack Start execution model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model)
- [TanStack Start server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)
- [Takumi README and renderer migration guidance](https://github.com/kane50613/takumi)
- `docs/product.md:86-104`
- `docs/research/README.md:65-70`
- `apps/web/src/routes/api.$orgSlug.billing.invoices.$invoiceId.pdf.ts`
- `apps/web/src/lib/billing-pdf.tsx`
- `apps/web/src/components/pdf/billing-documents.tsx`
