# Public site: search and AI visibility, performance, the missing pages, and contact wiring

Observed 2026-09-05. Primary sources only unless labelled; anything not read
directly is marked **[INFERENCE]**. Legal content is not legal advice.

## Question

After the four public routes shipped (`/`, `/opd`, `/patients`, `/billing`, with
`sitemap.xml`, `robots.txt`, `X-Robots-Tag` and static OG cards), what still
stands between the site and (a) maximum findability in Google, Bing and AI answer
engines, (b) fast field performance, and (c) a complete public surface — about,
legal, contact — and how should "Contact sales" and "Book a walkthrough" actually
be wired?

## Answer

1. **"AI SEO" is ordinary SEO plus one robots decision.** Google states in
   writing that Search — including its generative features — does not use
   `llms.txt` or any special markup, and no AI vendor promises to read a
   publisher's `llms.txt`. What is proven to matter is what already matters for
   Search: server-rendered, fact-dense text with real internal links. The only new
   lever is `robots.txt`: allow the **search/retrieval** bots
   (`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`, `Applebot`) and decide
   the **training** tokens (`GPTBot`, `ClaudeBot`, `Google-Extended`,
   `Applebot-Extended`, `CCBot`) separately. Add `Organization` + `WebSite`
   JSON-LD on `/`; do **not** add `FAQPage` for a rich result — Google removed it
   for non-government sites in 2023 and retired it entirely on 2026-05-07.
2. **The biggest indexing and LCP defect is self-inflicted: every screenshot is a
   CSS `background-image`.** Google does not index CSS images, and a CSS
   background LCP cannot be discovered by the preload scanner. The hero and the
   full capture on each feature page should be `<img>` with `src`, `alt`,
   intrinsic dimensions and one `fetchpriority="high"` preload; the zoomed crops
   can stay as backgrounds. Nothing else in the build is wrong: canonical, titles,
   descriptions, OG, `noindex` header and Brotli precompression already match
   Google's and Nitro's guidance. Missing: an immutable `Cache-Control` rule for
   hashed `/assets/`, GSC and Bing verification, and a field (CrUX) measurement.
3. **Company identity on the home page is a present statutory mandate; the
   privacy pages are current SPDI duty plus 2027 DPDP future-proofing.** Companies
   Act s12(3)(c) itself covers letters and bills, but **Rule 26 of the Companies
   (Incorporation) Rules 2014** (as substituted 2016-07-27) requires every company
   with a website to publish on its landing/home page its name, registered office
   address, CIN, telephone, fax if any, email, and the name of a person to contact
   for queries or grievances (₹1,000/day default penalty under s12(8)). DPDP Act
   duties that require a published processing contact, an itemized notice and a
   ≤90-day grievance route commence **13 May 2027** (Rules 3, 9, 14), with a
   one-year phase on 13 Nov 2026. The SPDI Rules 2011 privacy-policy duty (Rule 4)
   applies now if the company handles covered sensitive data — it does (patient
   records on behalf of hospitals) — and is repealed in the same 2027 phase. So:
   the footer of `/` carries the Rule 26 block today; ship Privacy, Terms and a
   Data Processing page now, written to the 2027 shape.
4. **Contact: WhatsApp click-to-chat first, `mailto:` beside it, a server-side
   form third, a scheduler link for the walkthrough.** WhatsApp is the channel
   Indian businesses are actually reached on (Meta: 91% of Indian online adults
   message a business weekly), costs nothing, and needs one `wa.me` URL. A form
   earns its place only when leads must land in a system rather than a phone; when
   it does, it is a server route sending through Resend (free 3,000/month) with
   Turnstile, never client-side email. "Book a walkthrough" is a direct link to a
   Cal.com or Google Calendar booking page, not an embed, until third-party data
   flow is reviewed. Every contact surface says "do not send patient information
   here".

## Evidence

### AI visibility

- `llms.txt` is a proposal (spec v2, modified 2026-08-10) — [llmstxt.org](https://llmstxt.org/).
  Google's AI-features guide (updated 2026-07-10) says Search does not use it or
  other special markup —
  [Google](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide).
  OpenAI, Anthropic and Perplexity publish `llms.txt` for their **own** docs only;
  their crawler references make no promise to read others' —
  [OpenAI bots](https://developers.openai.com/api/docs/bots),
  [Anthropic crawler policy](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler),
  [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers).
- Bot purposes, from each vendor's current page: OpenAI `OAI-SearchBot` =
  ChatGPT search, `GPTBot` = training, `ChatGPT-User` = user fetch (robots may not
  apply). Anthropic `Claude-SearchBot` = search, `ClaudeBot` = training,
  `Claude-User` = user fetch; all honour robots. `PerplexityBot` = search, not
  training, honours robots; `Perplexity-User` generally ignores robots. Google:
  `Google-Extended` is a robots token (no UA) controlling Gemini training and
  grounding, not Search —
  [Google crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers).
  Apple (2026-09-04): `Applebot` = Siri/Spotlight search, `Applebot-Extended` =
  training opt-out — [Apple](https://support.apple.com/en-us/119829). `CCBot` =
  Common Crawl dataset, downstream use unspecified —
  [Common Crawl FAQ](https://commoncrawl.org/faq/).
- Structured data: JSON-LD in head or body, must match visible content;
  `Organization` on home/about, `WebSite` on home (`name`, `url`);
  `SoftwareApplication` rich result needs truthful `offers.price` and ratings —
  [intro](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data),
  [Organization](https://developers.google.com/search/docs/appearance/structured-data/organization),
  [site name](https://developers.google.com/search/docs/appearance/site-names),
  [SoftwareApplication](https://developers.google.com/search/docs/appearance/structured-data/software-app).
  FAQ rich results restricted 2023-08 and removed 2026-05-07 —
  [2023](https://developers.google.com/search/blog/2023/08/howto-faq-changes),
  [updates](https://developers.google.com/search/updates).
- What AI engines cite: KDD'24 controlled benchmark — adding citations,
  quotations and statistics lifted visibility up to 40%, domain-dependent —
  [GEO, KDD'24](https://doi.org/10.1145/3637528.3671900). 2026 preprint over
  21,143 citations: cited pages are longer, modular, definition/number/comparison
  rich; Q&A formatting alone did not help (descriptive, not causal) —
  [arXiv 2604.25707](https://arxiv.org/html/2604.25707v2).
- Discovery: IndexNow key file + GET/POST, 200 = received not indexed —
  [IndexNow](https://www.indexnow.org/documentation). GSC verification methods —
  [GSC](https://support.google.com/webmasters/answer/9008080?hl=en); Bing setup
  (2025) — [Bing](https://blogs.bing.com/webmaster/June-2025/Start-Using-Bing-Webmaster-Tools-to-Improve-Your-Site-Visibility).

### Technical SEO and performance (against the shipped code)

- Google does not index CSS images; use `<img>` with `alt` and context —
  [Google Images](https://developers.google.com/search/docs/appearance/google-images).
  Every product visual is a background: `apps/web/src/components/landing/hero.tsx:74`
  (`bg-[url('/hero/dashboard-830-light.webp')]`) and
  `apps/web/src/components/landing/product-window.tsx:20-33` (`SHOTS`). `role="img"`
  gives accessibility, not indexability.
- A CSS-background LCP needs an explicit preload; one `as="image"` +
  `fetchpriority="high"`, never lazy —
  [Optimize LCP](https://web.dev/articles/optimize-lcp),
  [fetch priority](https://web.dev/articles/fetch-priority). No preload,
  `fetchpriority` or `<img>` exists in `apps/web/src` (grep 2026-09-05).
- CWV thresholds LCP ≤ 2.5 s, INP < 200 ms, CLS < 0.1 at p75; lab ≠ field —
  [CWV](https://developers.google.com/search/docs/appearance/core-web-vitals),
  [PSI](https://developers.google.com/speed/docs/insights/v5/about).
- Already correct: absolute self-canonical + unique title/description per route
  (`apps/web/src/lib/seo.ts`), `X-Robots-Tag` outside `PUBLIC_ROUTES`
  (`apps/web/src/routes/__root.tsx`), `robots.txt` not used as noindex —
  [block indexing](https://developers.google.com/search/docs/crawling-indexing/block-indexing);
  Brotli/gzip precompression (`apps/web/vite.config.ts:34`) —
  [Nitro assets](https://nitro.build/docs/assets).
- Missing: `nitro.config.ts` `routeRules` set security headers only; no
  `Cache-Control: immutable` on hashed `/assets/**` —
  [Nitro routing](https://nitro.build/docs/routing). Build output measured
  2026-09-05: one 118 KB CSS bundle, 12 Inter/JetBrains `woff2` subsets with
  `font-display: swap` and `unicode-range` (do not blanket-preload — preload
  bypasses `unicode-range` — [font best practices](https://web.dev/articles/font-best-practices));
  `public/og/` is 376 KB across four PNGs.
- TanStack Start 1.168.49 supports route `head()` `scripts` for JSON-LD and
  `prerender`/`sitemap` options (installed `@tanstack/start-plugin-core` 1.171.39
  schema); the site uses an explicit dynamic sitemap instead —
  [SEO guide](https://tanstack.com/start/latest/docs/framework/react/guide/seo.md).
  Lighthouse SEO 100 checks only crawlability/title/description/canonical/alt;
  structured data is manual, weight 0 —
  [lighthouse default-config](https://raw.githubusercontent.com/GoogleChrome/lighthouse/main/core/config/default-config.js).

### Pages: what is required versus expected

- **DPDP Act 2023** (MeitY PDF) — s5–6 notice/consent, s8 fiduciary duties incl.
  published contact and grievance —
  [Act](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf).
  Commencement G.S.R. 843(E), 2025-11-13: ss18–26 etc. immediate; s6(9), s27(1)(d)
  on 2026-11-13; ss3–17, 27–37, 44(2) on **2027-05-13** —
  [843(E)](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf).
  Rules G.S.R. 846(E): r3 itemized notice with withdrawal/rights/Board links; r9
  prominently published business contact; r14 grievance ≤ 90 days; r7 breach
  notices; r3, 5–16 commence 2027-05-13 —
  [846(E)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).
- **SPDI Rules 2011 r4** — body corporate handling sensitive personal data
  (health records qualify) must publish a privacy policy; s43A is dropped by DPDP
  s44(2) in the 2027 phase —
  [IT Act](https://www.indiacode.nic.in/bitstream/123456789/13116/1/it_act_2000_updated.pdf),
  [SPDI Rules](https://www.indiacode.nic.in/ViewFileUploaded?path=AC_CEN_45_76_00001_200021_1517807324077%2Frulesindividualfile%2F&file=GSR313E_10511%281%29_0.pdf).
- **Intermediary Rules 2021 r3(2)(a)** grievance-officer publication applies only
  if the vendor is an intermediary — fact-specific —
  [GAC FAQ](https://gac.gov.in/CMSData/FAQs?qs=+WcLOPiE4QBLh0NRiMqmqQ%3D%3D).
- **Companies Act s12(3)(c)** — name, registered office, CIN, phone, email,
  website on letters, billheads, notices —
  [MCA](https://www.mca.gov.in/content/dam/mca/pdf/CompaniesAct2013.pdf).
  **Companies (Incorporation) Rules 2014, Rule 26(1)** (substituted by the Third
  Amendment Rules 2016, 2016-07-27): "Every company which has a website for
  conducting online business or otherwise, shall disclose/publish its name,
  address of its registered office, the Corporate Identity Number, Telephone
  number, fax number if any, email and the name of the person who may be
  contacted in case of any queries or grievances on the landing/home page of the
  said website." Read via professional compendia
  ([CAIRR](https://ca2013.com/rule-26-companies-incorporation-rules-2014/),
  [ibclaw](https://ibclaw.in/the-companies-incorporation-rules-2014/)); the MCA
  primary PDF could not be fetched 2026-09-05 — confirm the current text there.
- **Consumer Protection (E-Commerce) Rules 2020** — CPA excludes commercial
  purpose; **[INFERENCE]** B2B-only sale is outside —
  [DCA](https://consumeraffairs.nic.in/theconsumerprotection/consumer-protection-e-commerce-rules-2020),
  [CPA 2019](https://www.indiacode.nic.in/bitstream/123456789/16939/1/a2019-35.pdf).
- **ABDM** — HFR is a registry, "not mandated to regulate"; no vendor
  public-site duty found —
  [HFR SOP](https://abdm.gov.in/strapicms/uploads/HFR_SOP_for_verifiers_2697480f8a_2_fc7c967615_4_51f1289d5c.pdf),
  [HIP/HIU guidelines](https://abdm.gov.in/strapicms/uploads/HIP_HIU_Guidelines_f85df336ec.pdf).
- Product doc: the footer already carries the honest ABDM badge
  (`apps/web/src/components/landing/closing.tsx` `BADGES`); the spec explicitly
  left legal, about, pricing, contact pages out of scope
  (`docs/specs/public-site-seo-and-feature-routes.md` §Out of Scope).

### Contact wiring

- Site today: header "Contact sales" and the mobile menu link to `#contact`,
  which is the closing CTA section, not a channel (`nav.tsx:193,256`); "Book a
  walkthrough" is a `<Button>` with no handler (`hero.tsx:22-28`,
  `closing.tsx:65-71`); footer Company/Resources/Legal columns point at anchors
  that do not exist (`closing.tsx:19-23`). The spec's shipped notes now record a
  decision to remove the inert controls and dead links — pending in code.
- WhatsApp click-to-chat: `https://wa.me/<digits>?text=<urlencoded>` —
  [WhatsApp](https://faq.whatsapp.com/5913398998672934). Cloud API only for
  templates/automation/opt-in —
  [Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform).
  Reach: Meta (2025-09-18, Kantar) — 91% of Indian online adults message a
  business weekly; general adults, not hospital administrators —
  [Meta newsroom](https://about.fb.com/news/2025/09/bringing-new-tools-to-help-businesses-boost-engagement-customer-support-and-discoverability/).
- `mailto:` opens the visitor's client; **[INFERENCE]** no server receipt, so no
  lead record — [RFC 6068](https://www.rfc-editor.org/rfc/rfc6068).
- Server-side form providers (pricing pages read 2026-09-05; re-check at launch):
  Resend free 3,000/month, 100/day — [pricing](https://resend.com/pricing),
  [API](https://resend.com/docs/api-reference/emails/send-email); Postmark
  100/month test then $15/10k — [pricing](https://postmarkapp.com/pricing); AWS SES
  $0.10/1k — [pricing](https://aws.amazon.com/ses/pricing/). Spam: Cloudflare
  Turnstile, free, does not read form entries —
  [Turnstile](https://developers.cloudflare.com/turnstile/).
- Scheduling: Google Calendar appointment schedules (link or embed, email
  verification option) —
  [Google](https://support.google.com/calendar/answer/11608416?hl=en); Cal.com
  inline/popup/button/email embeds — [Cal.com](https://cal.com/embed).

## What this proves / does not prove

- Proves: Google's position on `llms.txt`, each crawler's declared purpose and
  robots behaviour, the CSS-image indexing gap, the FAQ rich-result retirement,
  the DPDP commencement dates, that s12(3)(c) alone does not reach websites, and
  (via consistent secondary quotation of Rule 26, primary unfetched) that the
  Incorporation Rules do.
- Does not prove: that any AI engine will cite this site (the citation studies
  are one benchmark and one descriptive survey); that hospital administrators
  specifically prefer WhatsApp (the Meta figure is general); whether this company
  is an "intermediary" or will be a Significant Data Fiduciary; field
  performance — no CrUX data exists because nothing is deployed.

## What this means for us

Ordered by expected effect per unit of work. Items 1–3 are code; 4–6 need facts
only the owner has.

1. **`<img>` for the hero and the four full captures**, `alt` = the current
   `aria-label`, `width/height`, `decoding="async"`, and in `head()` `links` one
   `rel="preload" as="image" fetchpriority="high"` for the LCP image of that
   route. Crops stay as `ProductWindow` backgrounds. Requires a `<picture>` or
   `prefers-color-scheme` source pair because the light/dark WebPs differ.
2. **`robots.txt` bot policy** in `renderRobots`: explicit `Allow` for the search
   bots; choose one of — allow training bots (max reach), or `Disallow` for
   `GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `CCBot` (no
   Search or ChatGPT-search cost per the vendors' own docs). Recommendation:
   **allow all** for a marketing site with no proprietary text — the pages exist
   to be quoted. Add `/llms.txt` as a fifth `PUBLIC_ROUTES`-driven server route
   only because it costs one file; expect nothing from it.
3. **JSON-LD** via `head().scripts` on `/`: `Organization` (name, url, logo,
   `contactPoint` once a channel exists) and `WebSite`. `BreadcrumbList` on the
   three feature pages (Home › Outpatient queue). No `FAQPage`, no
   `SoftwareApplication` until a price is public. **Nitro `routeRules`**:
   `"/assets/**": { headers: { "cache-control": "public, max-age=31536000, immutable" } }`.
   Then GSC + Bing verification (DNS TXT), submit `sitemap.xml`, read CrUX after
   28 days.
4. **Pages**: `/about` (what HMS is, who runs it, legal name, CIN, registered
   office, support email — also the `Organization` anchor), `/privacy` (SPDI r4
   now; DPDP r3 shape: itemized data, purposes, withdrawal, rights, grievance
   contact and ≤90-day window, Board complaint link), `/terms`, `/dpa` (the
   processor terms a hospital's DPO will ask for — sub-processors, breach
   notification, deletion on exit). All four join `PUBLIC_ROUTES`; the footer
   Legal/Company columns come back only with these pages. Authoring format:
   **[INFERENCE]** TSX pages with prose in one `legal/` content module beat MDX
   here — no MDX pipeline exists in `apps/web` and `apps/fumadocs` already owns
   long-form docs.
5. **Contact**: a `/contact` route and the header's "Contact sales" pointing at
   it, containing (a) `wa.me/<number>?text=` prefilled with "Hi, I'd like to see
   HMS for <hospital>" — the primary button; (b) `mailto:sales@…` — secondary;
   (c) a note: "Do not send patient information here." Add a server-side form
   only if the owner wants leads in a mailbox they do not already read — then a
   TanStack server route → Resend with the key in `@hms/env/server`, Turnstile
   verified server-side, rate limited, fields: name, hospital, city, phone,
   message. "Book a walkthrough" becomes a real link to a Cal.com/Google booking
   page (or is deleted until one exists, which the spec notes already chose).
6. **Content depth for AI citation** (largest lever, slowest): each feature page
   gains a fact-dense section — definitions (what an MRN is, what a GST outward
   register is), concrete numbers from the product (token issue in one click,
   seven-day overdue threshold), and comparisons (register vs filing export).
   The FAQ answers already have this register; the page bodies do not yet.

## Next falsification

- Deploy behind `VITE_WEB_URL`, verify GSC/Bing, wait 28 days: does `/` have a
  CrUX LCP ≤ 2.5 s at p75 on mobile, and are the hero/capture images present in
  Google Images? If the `<img>` change does not move both, revisit.
- Put a distinct UTM on the WhatsApp, `mailto:` and booking links; after the
  first 30 days of pilot outreach, count which channel administrators actually
  used. The channel ranking above is inference until then.
- Ask Indian counsel two yes/no questions before 2026-11-13: is the company an
  intermediary under the 2021 Rules, and does it expect SDF designation? Either
  "yes" adds a named Grievance/Data Protection Officer to `/privacy`.

## Open decisions (owner input required)

- Legal entity name, CIN, registered office, support and sales email addresses.
- The WhatsApp Business number, and who answers it.
- Whether a lead form is wanted at all, or WhatsApp + email suffices for the pilot.
- Whether to allow training crawlers (recommended: yes).
- Whether to book walkthroughs through Cal.com, Google Calendar, or not yet.

## Sources

All URLs above; read 2026-09-05 unless a page carried its own date. Scout
transcripts: `history://AiSeoScout`, `history://PerfSeoScout`,
`history://PagesContactScout`.
