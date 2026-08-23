# Spec: Remove loading placeholders

Status: implementation complete; final verification pending
Authority: Owner request, 2026-08-23 — "remove the skeletons, all of them". The
owner wants to feel the app's real latency rather than a rehearsal of it.
Supersedes: the inline comments in `opd/$appointmentId/index.tsx`,
`opd/$appointmentId/billing.tsx` and `router.tsx` arguing that "a blank page
reads as a broken terminal", and the `docs/design.md` rule "Skeletons match the
height of what they replace".

## Problem

Eight grey-block placeholders exist across the console, plus the router's
`RoutePending`. Two things are wrong with them.

They almost never render. Every route that has one also has a loader that
`await`s the same query, so by the time the component runs, `isPending` is
already false. `opd/index.tsx`, `billing/index.tsx`, `patients/index.tsx` and
both `$appointmentId` routes await their data in full. The markup is therefore
unreviewed, untested, and free to drift out of sync with the layout it claims to
mirror.

When they do render, the owner's judgement is that they make the wait feel
longer, not shorter. A grey block that appears for 80ms is a flash of a second
layout; showing nothing in the same 80ms reads as one page arriving.

The cost of being wrong is low and the change is reversible, which is why this
is a trial rather than a debate.

## Solution

Nothing stands in for data that has not arrived. A page renders its static
chrome — the header band it can build from route params alone — and the region
that will hold the data stays empty until the data lands.

The router loses its pending component entirely, so a slow loader keeps the
current page on screen rather than replacing it with blocks.

Three things are deliberately kept, because none of them is a placeholder:

- `ErrorNote` — a failed read still says so.
- Text status on in-place work: "Loading…" on a pagination button, "Sending…"
  on a submitting mutation, `StaleDataNotice`. These label an action the user
  just took; they do not stand in for a page.
- The existing `isPending ? null` guards. They already render nothing, which is
  the target state. They must not be "simplified" away — dropping the guard
  would show an empty state ("The queue is empty") while the queue is still
  loading, which is worse than blank because it is false.

## User Stories / Scenarios

1. **Fast navigation, the common case.** A user clicks OPD from the sidebar,
   the route was hover-preloaded, data is warm. Before: identical to after. No
   placeholder was ever on screen. This is most navigations.
2. **Cold navigation on a slow link.** A user opens an appointment on a hospital
   LAN with a slow round trip. Before: the page title band appears with two grey
   blocks under it, replaced by content. After: the title band appears and the
   body below it is empty until the content lands in one paint.
3. **Slow route loader.** A loader takes over 800ms. Before: the current page is
   replaced by `RoutePending`'s three grey bars. After: the current page stays
   on screen, unchanged, until the new route is ready.
4. **A read fails.** Unchanged in every case — `ErrorNote` renders.
5. **Paginating a long list.** A user clicks "Load more". Unchanged — the button
   reads "Loading…" and the loaded rows stay on screen.

## Implementation Decisions

**Static chrome stays; only the data region goes blank.** For the three routes
whose pending state is a full-page early return
(`opd/$appointmentId/index.tsx`, `opd/$appointmentId/billing.tsx`,
`opd/new.tsx`), the branch keeps its `PageHeader` and renders an empty
`PageBody`. A page title built from route params is known immediately and is not
standing in for anything. Returning `null` for the whole page instead would make
the header flash in and out on every cold navigation, which is a worse version
of the problem this spec is solving. `opd/new.tsx` additionally drops its
`description="Loading patient"`.

**Inline placeholders become `null`.** For the four routes whose placeholder is
a ternary branch inside `PageBody` (`patients/index.tsx`, `opd/index.tsx` in two
places, `billing/index.tsx`), the pending branch renders `null`, matching the
eleven `isPending ? null` sites already in the codebase.

**The router loses all four pending settings.** `RoutePending`,
`defaultPendingComponent`, `defaultPendingMs` and `defaultPendingMinMs` all go.
The last two only gate a pending component; leaving them behind with nothing to
gate is dead configuration. With no pending component, TanStack Router keeps the
current route rendered until the new loader resolves, which is the desired
behaviour in scenario 3.

**`packages/ui/src/components/skeleton.tsx` is deleted.** `join.tsx` is its only
importer and is being changed by this spec. Per the repo's YAGNI convention,
unused exports are deleted rather than kept.

**Layout collapse is already prevented, and must stay that way.**
`docs/design.md` §9 requires panels to declare a `min-h-*` so they hold their
height at zero rows. That rule is what makes a blank region read as an empty
panel rather than a broken page, and it becomes load-bearing once the
placeholders are gone. Any panel that visibly collapses during the blank window
is a missing `min-h-*` on that panel, not a reason to restore a placeholder.

Modules touched: `apps/web/src/router.tsx`, six route modules under
`apps/web/src/routes/`, `apps/web/src/routes/join.tsx`,
`packages/ui/src/components/skeleton.tsx`, `docs/design.md`. No API, schema,
permission or tenancy surface is involved.

## Test Seams

This codebase has no component-test harness — `tests/` is integration tests
against real Postgres, and none of them render React. Adding one for this change
would be a larger commitment than the change itself. The behaviour is therefore
verified at three seams:

- **Source-level assertion (automated).** A repo-wide grep proves no placeholder
  markup survives: no `bg-muted` block carrying `role="status"`, no
  `aria-label="Loading`, no import of `@hms/ui/components/skeleton`. This is the
  precise, checkable definition of done for slices 1–4.
- **Type and lint (automated).** `bun run check-types` and `bun run check` prove
  no dangling imports, unused symbols or unreachable branches — the most likely
  mechanical failure of this change.
- **Manual walkthrough under throttling (human).** Chrome DevTools "Slow 4G",
  visiting each of the six touched routes cold, confirms no layout collapses and
  no page renders a false empty state while loading. This is the only seam that
  can catch a missing `min-h-*`, so it is required, not optional.

## Task Plan

- [x] **Slice 1: Pattern proof on the appointment page**
  - Remove the placeholder from the pending early return in
    `apps/web/src/routes/$orgSlug/opd/$appointmentId/index.tsx`, keeping
    `PageHeader` and rendering an empty `PageBody`. Delete the superseded
    "a blank screen reads as a broken terminal" comment.
  - Acceptance: the route's pending branch contains no `bg-muted` block and no
    `role="status"`; the page title band still renders during the pending
    window; under Slow 4G the body area below the header does not shift the
    header when content lands.
  - Verify: `bun run check-types`, then `bun run dev:web` and open an
    appointment cold with DevTools throttling on.
  - Depends on: none
  - Owns/Touches: `apps/web/src/routes/$orgSlug/opd/$appointmentId/index.tsx`
  - Interfaces: establishes the pattern slice 2 copies — pending early return
    keeps `PageHeader`, renders `<PageBody>` with no children; pending ternary
    branches render `null`.

- [x] **Slice 2: Remaining route placeholders**
  - Apply the slice 1 pattern to the other five sites: full-page early returns
    in `opd/$appointmentId/billing.tsx` and `opd/new.tsx` (also dropping its
    `description="Loading patient"`), and ternary branches in
    `patients/index.tsx`, `opd/index.tsx` (two: queue and appointments) and
    `billing/index.tsx`. Delete the superseded comments alongside them.
  - Acceptance: `grep -rn 'aria-label="Loading' apps/web/src` returns nothing;
    no `role="status"` remains on a `bg-muted` element anywhere in
    `apps/web/src`; every touched route still renders `ErrorNote` on a failed
    read; no `isPending ? null` guard was removed.
  - Verify: the grep above, `bun run check-types`, `bun run check`, then a
    throttled visit to all five routes.
  - Depends on: Slice 1
  - Owns/Touches: `apps/web/src/routes/$orgSlug/opd/$appointmentId/billing.tsx`,
    `apps/web/src/routes/$orgSlug/opd/new.tsx`,
    `apps/web/src/routes/$orgSlug/opd/index.tsx`,
    `apps/web/src/routes/$orgSlug/patients/index.tsx`,
    `apps/web/src/routes/$orgSlug/billing/index.tsx`
  - Interfaces: consumes the pattern from slice 1. Produces nothing for later
    slices.

- [x] **Slice 3: Router pending state and the `Skeleton` component**
  - Delete `RoutePending` and the `defaultPendingComponent`, `defaultPendingMs`
    and `defaultPendingMinMs` settings from `apps/web/src/router.tsx`, including
    the comment that justifies the 800ms floor. Replace the two `Skeleton`
    blocks in `routes/join.tsx` with `null` and drop the import. Delete
    `packages/ui/src/components/skeleton.tsx`.
  - Acceptance: `grep -rn 'skeleton' apps/web/src packages/ui/src` returns
    nothing; `router.tsx` names no pending component; a route whose loader is
    artificially delayed leaves the previous page on screen instead of replacing
    it.
  - Verify: the grep above, `bun run check-types`, `bun run check`. For the
    behavioural half, add a temporary `await new Promise(r => setTimeout(r,
3000))` to one route loader, navigate to it, confirm the current page stays
    up, then remove the delay.
  - Depends on: none — disjoint write set from slices 1 and 2, so it may run in
    parallel with them.
  - Owns/Touches: `apps/web/src/router.tsx`, `apps/web/src/routes/join.tsx`,
    `packages/ui/src/components/skeleton.tsx` (deleted)
  - Interfaces: removes the `Skeleton` export from `@hms/ui`. No other importer
    exists; confirm with the grep before deleting.

- [x] **Slice 4: Record the rule**
  - In `docs/design.md` §9, replace "Skeletons match the height of what they
    replace" with the rule this spec establishes: nothing stands in for data
    that has not arrived; a page renders the chrome it can build from route
    params and leaves the data region empty; `min-h-*` on panels is what keeps
    that from reading as a collapse. Add a checklist line: "No placeholder
    stands in for loading data."
  - Acceptance: §9 no longer mentions skeletons; the checklist covers the new
    rule; no other section contradicts it.
  - Verify: `grep -rn -i 'skeleton' docs/` returns only this spec.
  - Depends on: Slice 3
  - Owns/Touches: `docs/design.md`
  - Interfaces: none.

## Out of Scope

- Text status on in-place work: "Loading…" pagination buttons, "Sending…"
  mutation labels, the API-reachability line on `routes/index.tsx`,
  `StaleDataNotice`, and the pending text in `invoice-account.tsx` and
  `opd-intake-form.tsx`. These are not placeholders.
- The eleven existing `isPending ? null` guards. They are already the target
  behaviour.
- `ErrorNote` and every error path.
- `placeholderData: keepPreviousData` on search and filter queries. It is a real
  improvement and independent of this change; it belongs in its own spec so this
  trial measures one thing.

## Explicitly Deferred

- **Screen-reader announcement of loading.** Deleting the `role="status"`
  regions removes the only announcement a screen reader gets while a page loads.
  A visually hidden live region would restore it at zero visual cost, but adding
  one in the same change would muddy the trial. If the blank approach is kept,
  this should be the immediate follow-up. A later review must not treat it as a
  blocker on this spec.
- **Reverting.** This is a trial. If the blank window reads as broken in daily
  use, the revert is this spec's diff, and the follow-up is a single shared
  primitive rather than eight hand-rolled blocks.

## Open Questions

None.
