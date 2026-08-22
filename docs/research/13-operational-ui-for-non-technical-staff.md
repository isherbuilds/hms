# Separate destinations vs one filtered list — UI evidence for non-technical, high-frequency staff

Date: 2026-08-21. Branch: external (UX literature), applied to a live decision.
Settles the navigation question left open by the contradiction between
[10-emr-navigation-ia.md](10-emr-navigation-ia.md) and
[12-patient-flow-end-to-end.md](12-patient-flow-end-to-end.md) §Δ1.

## Question

Our users are hospital reception and ward staff: not technical, not choosing to use the
software, repeating the same handful of tasks hundreds of times a day. For them, is it faster,
cleaner, safer and more scalable to give OPD, IPD and Emergency **three permanent destinations**
(the "Split" prototype), or **one Visits list with a class filter** (the "Spine" prototype, built
to doc 10's prescription)?

## Answer (lead)

**Split, on three of the four dimensions asked. Spine wins "cleaner" only at the navigation
layer, and loses it at the row.**

1. **Faster: Split.** For people who use an interface repeatedly, speed comes from _spatial
   memory_ — a permanent screen location becomes an automatic motion. NN/g is explicit that its
   spatial-memory guidance is "tailored for users who work with an interface repeatedly". Fewer
   navigation items does **not** buy speed for this population: Hick's law describes _novel_
   choices among equally probable alternatives, and well-practised responses approach constant
   time regardless of set size. Split gives each job a fixed address; Spine makes one address
   mean three things depending on invisible state.
2. **Cleaner: split decision.** Spine's sidebar is unambiguously tidier — one "Visits" entry
   forever. But the complexity does not vanish, it moves into the row: a class pill, an empty
   token cell for the two classes that have no token, and a single age column that reads
   "9m" on one line and "Day 6" on the next. Cleaner navigation, dirtier data.
3. **Safer: Split, but do not overclaim this.** A class filter is a **mode** in the strict sense
   — "same input, different results" depending on active state — and NN/g names _mode slips_
   (forgetting which mode is on) as the primary failure. However, the nearest healthcare
   experiment tested a similar intuition and **did not** find the effect: Adelman et al.'s
   randomised trial of 3,356 clinicians found no significant difference in wrong-patient order
   errors between EHRs restricted to one open record and those allowing four. Treat mode risk as
   a real design principle, not as a proven safety claim for this specific choice.
4. **Scalable: Split, decisively, and for a reason that is not about the sidebar.** Spine's
   navigation does not grow, but its _row_ does — every new class adds a column, an exception, or
   an empty cell, and the shared columns must keep meaning something for all classes. Split's
   growth is one sidebar entry per domain, after which each board stays simple. Split also gates
   per role for free, because each destination is already permission-checked
   (`apps/web/src/lib/navigation.ts`).

## Evidence

### E1 — Spatial memory is the speed mechanism for repeat users, and it needs stable locations

Nielsen Norman Group, _Spatial Memory: Why It Matters for UX Design_:

- "spatial memory allows users to develop a level of **automaticity** when accessing frequently
  used features or data"
- "**Stable UIs where things don't move around (much)**" are necessary for spatial memory
- "objects should be as positionally stable relative to the outside borders as possible"
- Scope, verbatim: "these guidelines … are **tailored for users who work with an interface
  repeatedly**. In such scenarios, relocating key features and content quickly is important. The
  calculus might change for consumer-facing websites that users may visit only occasionally."

Our reception staff are the first population, not the second. This is the single most applicable
finding in the whole pass.

[INFERENCE] Split's sidebar grows by two entries when IPD and ER ship, which does shift the items
below them once. That is a one-time positional change, not a per-use one. Spine's _position_
never changes but the _meaning_ of what sits there changes on every filter toggle — which is the
kind of instability spatial memory cannot absorb, because it is not spatial.

### E2 — A class filter is a mode, and modes have a named failure

NN/g, _Modes in User Interfaces: When They Help and When They Hurt Users_:

- Definition: modes are "different interpretations of the user input by the system, depending on
  the state which is active. **Same input, different results.**"
- Failure mode: "**mode slips** — when users forget which mode is active" — plus low
  discoverability of mode-specific features.
- Modes are acceptable when input controls are physically limited, when the active mode has
  "**strong visual differentiation** with redundant indicators", and when "mode errors cannot
  produce disastrous consequences".
- NN/g video page, same topic: "Poorly signaled modes can easily trigger user errors with
  disastrous consequences."

Spine's class filter meets NN/g's own test for an _acceptable_ mode only if the indicator is
strongly differentiated and redundant. Our prototype's segmented control is one indicator in one
place. Split has no mode at all: the destination is the state.

The underlying literature is aviation human factors — Sarter & Woods, _"How in the world did we
ever get into that mode?" Mode error and awareness in supervisory control_ (1995), ~860
citations — where mode confusion is defined as a mismatch between the operator's mental model and
the machine's actual state.

### E3 — Hick's law does not argue for fewer destinations here

Hick–Hyman (1952): reaction time rises logarithmically with the number of _equally probable,
undifferentiated_ alternatives. Two limits matter for us, both widely documented in UX practice
(labelled **secondary evidence** — practitioner sources, not a primary study):

- **Chunking defeats it.** Twenty items in four labelled groups of five costs
  `log₂(4) + log₂(5)`, less than `log₂(20)`. Our sidebar is already grouped Care / Finance /
  Workspace, so three entries inside "Care" are not three added to a flat list.
- **Practice defeats it.** "Well-practised stimulus–response associations bypass logarithmic
  scaling, approaching constant reaction times regardless of set size" — the standard example
  being a touch typist among 26 keys.

So "Split has more menu items, therefore it is slower" does not hold for daily users.

### E4 — The counter-evidence, stated at full strength

Two findings cut against Split, and neither should be buried.

**Low-literate/novice interface research recommends fewer choices.** The literature-review strand
(Medhi Thies and successors) recommends "supporting recognition rather than recall … **providing
fewer choices to the user in order to reduce errors**". Read literally, that favours Spine.

[INFERENCE] The resolution is that "fewer choices" in that literature means fewer choices _per
decision point_, and it sits directly beside "recognition rather than recall". Split presents
three permanently visible, plainly labelled choices at one decision point. Spine presents one
choice followed by a hidden mode the user must remember. On the recognition/recall axis Split is
the better fit; on the raw-count axis Spine is. The two guidelines in that same sentence point
opposite ways here, so neither settles it alone.

**The healthcare error effect did not replicate.** Adelman et al., _Effect of Restriction of the
Number of Concurrently Open Records in an Electronic Health Record on Wrong-Patient Order Errors_
(JAMA, 2019): a randomised trial of **3,356 clinicians** across emergency, inpatient and
outpatient settings found **no significant difference** in wrong-patient order errors between
clinicians restricted to one open record and those allowed up to four. The same group's
retract-and-reorder surveillance measured a baseline of **58 wrong-patient orders per 100,000
orders**.

This is the nearest thing to a controlled test of "hidden or ambiguous patient context causes
errors" in a hospital setting, and it came back null. It does not test filters, and a filter is
not the same as a second open chart — but it is a direct warning against asserting that Spine
would cause wrong-patient events.

### E5 — Vocabulary, which is where "non-technical" actually bites

Not a literature finding, an application of the recognition-over-recall principle to our domain:
**OPD, IPD and Emergency are words the staff already say out loud every day.** "Visits, filtered
by class" is a system concept — correct, and not in their vocabulary. Split puts their words
permanently on screen; Spine puts one of our words on screen and hides theirs behind a control.

[INFERENCE] This is the argument I would put most weight on for _this_ user population, and it is
the one with the weakest formal citation. It is a design judgement supported by a principle, not
a measured result.

## What this proves / does not prove

**Proves.** The NN/g positions on spatial memory and on modes are quoted directly from NN/g and
are first-party for UX guidance. The Adelman trial result and its sample size are as reported by
JAMA/PubMed and Columbia DBMI.

**Does not prove.** That Split measurably outperforms Spine for our staff. No study compares
"separate destinations" against "one filtered list" for hospital reception work; the argument here
is assembled from adjacent principles, not from a matching experiment. NN/g guidance is
practitioner synthesis, not controlled trial data. The Hick's-law limits are cited from secondary
practitioner sources.

**Not determined.** Whether our pilot's staff already use a system with a class filter and are
fluent in it — prior habit would outweigh every argument above. Not asked; it is the cheapest
falsification available.

## What this means for us

> **Accepted 2026-08-21** as
> [ADR 0022](../contributing/decisions/0022-care-settings-are-separate-destinations.md).
> Condition 1 below is deferred to the increment that ships those domains. Condition 2 is
> applied through explicit practitioner and department columns rather than a derived token
> prefix; condition 3 is applied.

**Recommendation: Split**, with three conditions that come straight out of the evidence.

1. **Give IPD and Emergency their own permission subjects** (`packages/auth/src/access.ts`
   currently has one `visit` subject). Without this, Split's destinations are visible to everyone
   and its main cost — role blindness — is permanent. With it, the sidebar shapes itself per role
   and E1's stability argument applies to _each role's own_ stable sidebar.
2. **Keep the OPD board's queue scope control** (research 12, and Danphe's `QueueLevel`
   parameter). Note honestly that this control is itself a mode by E2's definition, so its scope
   must remain visible in the list. The production table does that with explicit practitioner
   and department columns. A derived token such as `RAO-03` was rejected because it creates a
   second identity not stored by the domain and changes when a practitioner is renamed; the
   canonical token number remains unchanged everywhere.
3. **Do not claim a safety benefit.** E4 is explicit. Split is justified on speed, vocabulary and
   scale; the mode-error argument is a design principle we are choosing to respect, not an
   outcome we have evidence for.

**Accepted documentation consequence:** the canonical vocabulary now lives in
`docs/product-blueprint.md`; doc 10's four navigation prescriptions are marked superseded with its
own Bahmni/Danphe counter-evidence noted; and ADR 0022 records the decision so the removed
improvement-plan drafts and former context glossary are not treated as current sources.

## Next falsification

- **Ask the pilot's reception staff what they use today**, and whether they reach OPD/IPD/ER by
  separate menu items or by filtering one list. Prior fluency beats every argument in this
  document, and it is one question.
- Watch the first live role list (doc 10's own falsification): if nurses live in one board and
  never open the others, Split's per-role sidebar is confirmed; if everyone uses everything,
  Spine's single entry costs less than argued here.
- If a class filter ever does ship anywhere in the product, instrument mode slips directly —
  count actions taken while a non-default filter is active and then immediately undone. That is
  the retract-and-reorder measure applied to filters, and it would settle E2 vs E4 with our own
  data.

## Sources

- Nielsen Norman Group, _Spatial Memory: Why It Matters for UX Design_ —
  https://www.nngroup.com/articles/spatial-memory/ (read 2026-08-21).
- Nielsen Norman Group, _Modes in User Interfaces: When They Help and When They Hurt Users_ —
  https://www.nngroup.com/articles/modes/ (read 2026-08-21).
- Nielsen Norman Group, _UI Modes and Modals_ (video page) —
  https://www.nngroup.com/videos/ui-modes-modals/ (read 2026-08-21).
- Sarter, N. B. & Woods, D. D., _"How in the world did we ever get into that mode?" Mode error and
  awareness in supervisory control_ (1995) — https://scispace.com/papers/how-in-the-world-did-we-ever-get-into-that-mode-mode-error-1ptd2qtqkr
  (citation count and abstract only; full text not read).
- Adelman, J. S. et al., _Effect of Restriction of the Number of Concurrently Open Records in an
  Electronic Health Record on Wrong-Patient Order Errors: A Randomized Clinical Trial_, JAMA 2019 —
  https://pubmed.ncbi.nlm.nih.gov/31087021/ and
  https://www.dbmi.columbia.edu/adelman-study-evaluates-safety-of-restricting-vs-allowing-multiple-records-open-in-an-electronic-health-record/
  (abstract and institutional summary read; full text not read).
- Medhi Thies, I., _User Interface Design for Low-literate and Novice Users: Past, Present and
  Future_ — https://www.researchgate.net/publication/277620615 and the ACM literature review
  https://dl.acm.org/doi/fullHtml/10.1145/3578837.3578842 (**403 on fetch**; guidance quoted from
  search-result summaries only — weakest citation in this document).
- Baymard Institute, _Filtering UX: Display "Applied Filters" in an Overview_ —
  https://baymard.com/blog/how-to-design-applied-filters (e-commerce context; used only for the
  general "forgotten applied filter" failure).
- Hick's-law limits (chunking, practised responses): practitioner sources incl.
  https://ixdf.org/literature/article/hick-s-law-making-the-choice-easier-for-users and
  https://atticusli.com/blog/posts/hicks-law-navigation-design/ — **secondary evidence**.
- Local: `apps/web/src/lib/navigation.ts`, `packages/auth/src/access.ts`,
  `apps/web/src/prototypes/patient-flow/` (Split and Spine variants).
