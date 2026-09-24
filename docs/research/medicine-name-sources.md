# Medicine-name suggestion sources

Observed 2026-09-24. Temporary memo: the decision below is recorded here and
in D046. Delete this file once a second pilot shelf confirms or overturns it.

## Question

Which browser-callable Indian medicine catalogs can suggest a medicine name
and fill strength, manufacturer and pack for both the pilot pharmacy's shelf
and mainstream brands (`apps/web/src/components/medicine-name-field.tsx`)?

## Answer

No large catalog covers the whole shelf. **Decision (2026-09-24, taken
autonomously at the owner's request): merge Medbuzz stocked products and
Truemeds suggestions**, fetched in parallel directly from the browser.
Medbuzz fills the pilot's LXIR ophthalmic line; Truemeds fills mainstream
brands. Commercial reuse permission has not been established for either.

- **Coverage of the shelf:** I Smith's catalog lists the pilot's niche
  brands (Zalmox, Hylox, Bepotine, Cataset, Olpax, Lxtear, Nephex-Plus,
  Reti-Kid, Lidfresh 369). Medbuzz labels the Zalmox, Hylox, Bepotine and
  Lxtear stock as LXIR Medilabs. This is a third-party supply chain, so the
  plant behind each pack is unverified.
  - **I Smith (101 products):** covers 11 of 13 shelf rows, but only when
    searched with the correct spelling.
  - **Apollo 247 (rejected for field fill):** its product records exactly
    match five pilot shelf names: Bepotine, Lxtear (searched as "lxtear"),
    Olpax (as "olpax"), Change M and Hifenac-SP. Dolo-650 also matches
    among mainstream brands; Zalmox-D is a near match. Hylox appears only
    as a query suggestion, not a product. Search products carry no strength
    and often no manufacturer.
  - **Medbuzz (B2B):** six fully filled shelf hits, all within the Zalmox,
    Hylox, Bepotine and Lxtear LXIR line. Its other hits include bare index
    names with no product data; only `Type: 1` stocked rows are usable.
  - **Truemeds:** Hifenac-SP is its sole pilot shelf match, but it fills six
    mainstream brands. As a generic-substitution pharmacy it genuinely
    lacks some major brands, including Augmentin 625 and Moxicip.
  - **Other sources find at most 1–3 shelf names:** Medkart, Frank Ross,
    Netmeds, 1mg, PharmEasy, NPPA, the Kaggle/GitHub dumps, CDSCO and
    Jan Aushadhi.
- **Spelling:** four shelf names are misspellings of the real brand. OLPEX is
  Olpax, LXTER is Lxtear, CATSET is Cataset and NEPHA PLUS is probably
  Nephex-Plus. BEPOTINE is correct; Bepotime is a different product. No source
  finds a misspelled name, so suggestions help new entries more than they
  explain the existing master.
- **Rights:** no candidate grants reuse for a commercial product.
  - [Apollo's terms](https://www.apollopharmacy.in/landing-page/terms-noBg.htm)
    prohibit commercial use: "You may not make any commercial use of any of the
    information".
  - [Truemeds' terms](https://www.truemeds.in/legal/ispl/terms-and-conditions)
    ban automated access: "You shall not use any automated means ... to access
    the Website, the information, or Services for any purpose".
  - Medbuzz and I Smith state no licence.
  - The only openly licensed bulk data (the Kaggle A–Z set) is CC BY-SA and
    has none of the niche brands.

## Evidence

The probe list is the pilot org's own product master (screenshot of
`/pharmacy/items` supplied by the owner). All probes ran from a residential
Indian IP on 2026-09-24. The CORS checks sent
`Origin: https://care.edernal.com`; the coverage probes were plain requests.

| Shelf row          | Apollo 247                        | I Smith (correct spelling)     | Medbuzz                       | Truemeds   | 1mg          | PharmEasy  |
| ------------------ | --------------------------------- | ------------------------------ | ----------------------------- | ---------- | ------------ | ---------- |
| E/D ZALMOX         | Zalmox-D Eye Drops (near)         | Zalmox, -D, -P, -TM Eye Drops  | ZALMOX EYE DROPS              | —          | —            | —          |
| E/D ZALMOX LP      | —                                 | Zalmox-LP Eye Drops            | ZALMOX LP EYE DROPS           | —          | —            | —          |
| OINT. ZALMOX       | —                                 | Zalmox Eye Ointment            | ZALMOX / MOXIRUT EYE OINTMENT | —          | —            | —          |
| E/D HYLOX          | — (suggestion text only)          | Hylox Eye Drops 5ml            | HYLOX EYE DROPS               | —          | —            | —          |
| E/D BEPOTINE       | Bepotine Eye Drops 5 ml           | Bepotine Eye Drops             | BEPOTINE EYE DROPS            | —          | Bepotime (≠) | Bepotime   |
| E/D LXTER          | Lxtear 0.5% (as "lxtear")         | Lxtear Eye Drops (as "lxtear") | LXTEAR NG (as "lxtear")       | —          | —            | —          |
| E/D CATSET         | —                                 | Cataset Eye Drops              | —                             | —          | —            | —          |
| E/D OLPEX          | Olpax Eye Drops 5 ml (as "olpax") | Olpax Eye Drops (as "olpax")   | —                             | —          | —            | —          |
| E/D NEPHA PLUS     | —                                 | Nephex-Plus (as "nephex")      | —                             | —          | —            | —          |
| GUMMIES RETI KID   | —                                 | Reti-Kid Eye Gummy             | —                             | —          | —            | —          |
| CAP. LID FRESH 369 | —                                 | Lidfresh 369 Softgel Capsules  | —                             | —          | —            | —          |
| SYP. CHANGE M      | Change M Oral Suspension          | —                              | —                             | —          | —            | —          |
| TAB.HIFINAC SP     | Hifenac-SP Tablet 10's            | —                              | — (look-alikes)               | Hifenac Sp | Hifenac SP   | Hifenac Sp |

Access checks:

| Source                | Endpoint                                                                                                                              | Browser (CORS)                                                      | Size                                                                                                                                | Terms                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apollo 247            | `GET https://apigateway.apollo247.in/search-service/v5/search?query=&pincode=` with `x-app-os: web`, `x-source-service: PHARMA_AP_IN` | Yes: `ACAO: *`; preflight allows both headers                       | National retail catalog                                                                                                             | [Terms](https://www.apollopharmacy.in/landing-page/terms-noBg.htm): "You may not make any commercial use of any of the information"                                               |
| I Smith               | `GET https://www.ismith.in/wp-json/wp/v2/search?search=&subtype=product` (WordPress REST)                                             | Yes: reflects any Origin                                            | 101 products (`X-WP-Total`)                                                                                                         | None found                                                                                                                                                                        |
| Medbuzz               | `POST https://searchapi.medbuzz.in/admin/Filter_All_Medbuzz_Search_Keys` (JSON, empty ApiKey)                                         | Yes: `ACAO: *`, Cloudflare-fronted; 403 to a non-browser User-Agent | B2B stock plus a brand/molecule index; only `Type: 1` rows carry pack/manufacturer                                                  | None found; the `/admin/` path suggests an internal API                                                                                                                           |
| Truemeds              | `GET https://nal.tmmumbai.in/CustomerService/getSearchSuggestion?...`                                                                 | Yes: `ACAO: *`                                                      | National retail catalog                                                                                                             | [Terms](https://www.truemeds.in/legal/ispl/terms-and-conditions): "You shall not use any automated means ... to access the Website, the information, or Services for any purpose" |
| 1mg (removed)         | `GET https://www.1mg.com/api/v1/search/autocomplete`                                                                                  | No ACAO; prod server got 403                                        | National                                                                                                                            | Terms restrict automated access                                                                                                                                                   |
| PharmEasy             | `GET https://pharmeasy.in/api/search/search/`                                                                                         | No ACAO                                                             | National                                                                                                                            | —                                                                                                                                                                                 |
| NPPA Pharma Sahi Daam | `GET https://nppaipdms.gov.in/NPPA/rest/brandComboNew`                                                                                | No: 403 `Invalid CORS request`                                      | 60,958 brand names (measured)                                                                                                       | No licence located                                                                                                                                                                |
| NRCeS CDCI            | TSV download behind CAPTCHA                                                                                                           | Bulk only                                                           | 93,911 branded records ([release notes](https://www.nrces.in/download/files/pdf/CommonDrugCodesForIndia_ReleaseNotes_20260831.pdf)) | `License.txt` inside the package, unread                                                                                                                                          |
| Kaggle A–Z            | [dataset](https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india)                                               | Bulk only                                                           | 253,973 rows                                                                                                                        | CC BY-SA 4.0                                                                                                                                                                      |

Bulk datasets downloaded and grepped:

- **Kaggle A–Z and its GitHub/Kaggle derivatives:** 253,973 rows each; only
  Bepotime and Hifenac SP match.
- **2025 1mg scrape:** 348,211 rows, licensed CC BY-NC-SA (non-commercial);
  same two matches.
- **Netmeds and Hugging Face sets:** no matches.

The other government sources don't list private brands:

- **CDSCO approvals:** new-drug approvals only, not a brand catalog.
- **Jan Aushadhi:** generics only.
- **IPC National Formulary:** monographs only.

Licensed B2B masters (not probed; access needs a partner agreement):

- **[Marg ERP](https://margcompusoft.com/):** claims 5 lakh+ medicines, but
  its export covers only a customer's own products.
- **[MIMS Integrated](https://cds.mims.com/mims-integrated/):** licensed
  institutional API.
- **Retailio, PharmaRack, Saveo:** 50k–200k SKUs claimed; partnership only.

Other catalogs dropped:

- **Medicine India, Medguide and TradeIndia:** no usable search, or no
  matches.
- **CIMS, Drugs.com and PharmaCompass:** 403 errors and no CORS.

Other consumer pharmacy endpoints probed:

- **[Medkart](https://www.medkart.in/terms-and-conditions)**
  (`app.medkart.in/api/v2/products/search`): CORS `*`, behind Cloudflare.
  Only Hifenac SP matches exactly, and its terms forbid commercial use.
- **Frank Ross:** Algolia with a public key embedded in its front-end code.
  CORS `*`, about 53.7k records, and only Hifenac SP matches exactly.
- **Netmeds and Zeelab:** no CORS; one or zero matches.
- **MedPlus, Dawaa Dost, Wellness Forever, Flipkart Health+ and Tata Neu:**
  blocked (403, 429 or a Cloudflare challenge) or no endpoint found.

Medbuzz record quality: one stocked record, `ZALMOX BR EYE DROPS`, has a
stale `metaTitle` of `MOXITIK BR EYE DROPS` and lists substitute brands in
`Tag_Names`. The other LXIR records checked are consistent. This one stale
metadata field is not a ground for rejecting its stocked rows; the
suggestion maps the product name, composition, manufacturer and packing
from `Product_Data`, not `metaTitle`.

## What this proves / does not prove

- **Proves:** which endpoints a browser at `care.edernal.com` can read, and
  which shelf names each returns today from an Indian residential IP.
- **Does not prove:**
  - Behaviour from staff browsers on other networks. A residential 200 is
    not a guarantee.
  - Endpoint stability.
  - Legal permission to use any of these for a commercial product.
  - Coverage beyond this 13-row sample. The pilot's wider shelf may skew
    differently.

## Decision and what it means for us

Merge Medbuzz stocked product rows (`Type: 1` with `Product_Data`) and
Truemeds suggestions, fetched in parallel from the browser. Put Medbuzz
first, de-duplicate by name ignoring case and punctuation, and cap the list at six.
Requests carry only search text plus fixed request constants, never tenant
or user identity. Web CSP `connect-src` allows
`https://searchapi.medbuzz.in` and `https://nal.tmmumbai.in`. If one
endpoint fails, the other can still suggest; if both fail, staff enter the
product manually. Suggestions remain optional and staff confirm every
pick (D046).

### Fields filled on pick

Measured 2026-09-24 on 21 names: the pilot's 13 shelf items plus eight
mainstream brands. "Fully filled" means strength, manufacturer and pack.

| Source     | Found | Fully filled | Where the complete hits landed |
| ---------- | ----: | -----------: | ------------------------------ |
| Apollo 247 |    15 |            0 | No strength field              |
| Truemeds   |     6 |            6 | Mainstream brands              |
| Medbuzz    |    11 |            6 | Pilot's LXIR ophthalmic line   |

Medbuzz's other five hits were `Type: 3` bare brand names without product
data. Truemeds is a generic-substitution pharmacy and genuinely lacks
Augmentin 625 and Moxicip. Its six complete hits and Medbuzz's six complete
hits are disjoint. The owner accepted this risk class for 1mg but has not
confirmed it for these sources. Written permission from both is required
before commercial launch.

Rejected:

- **Apollo 247:** search products carry no strength and often no
  manufacturer. Product details exist only in server-rendered HTML, not
  browser-callable JSON; [its terms](https://www.apollopharmacy.in/landing-page/terms-noBg.htm)
  forbid commercial use.
- **I Smith:** one maker's 101-product catalog, names only (no strength,
  pack or manufacturer); it cannot fill the required fields.
- **Bulk datasets and government sources:** no niche coverage, restrictive
  or unread licences, or no public access.

What the pilot shelf still needs:

- **Existing names:** the org's own products (`pharmacy.listProducts`) hold
  the shelf's spellings. The field already checks them for duplicates.
- **Correct spellings:** four entries are transcription errors (OLPEX, LXTER,
  CATSET, NEPHA PLUS). Correcting them in the product master is a data task
  for the pharmacy, not a source problem. Until then, a suggestion like
  "Olpax Eye Drops" won't trip the exact-name duplicate warning against
  "E/D OLPEX".
- **Import rules:** suggestions stay suggestion-only under D046. Staff
  confirm before copying, and MRP, tax and schedule are never imported.

## Next falsification

- Re-run the 21-name fill measurement. If Medbuzz or Truemeds drops below
  its current six fully-filled hits, or either loses `ACAO`, reopen D046.
- Check access from a production staff browser; residential access is not
  a guarantee.
- Obtain the NRCeS CDCI package, read its `License.txt`, and grep it for
  the probes. It is the only official, importable, broad brand master.
- Obtain written permission from whichever sources ship before commercial
  launch.

## Sources

- [Apollo Pharmacy terms](https://www.apollopharmacy.in/landing-page/terms-noBg.htm)
- [Truemeds terms](https://www.truemeds.in/legal/ispl/terms-and-conditions)
- [I Smith products](https://www.ismith.in/)
- [NRCeS drug codes](https://nrces.in/services/national-releases#drug_codes)
- [NPPA Pharma Sahi Daam](https://nppa.gov.in/en/pharma_sahi_daam)
- [CDSCO DCC minutes on SUGAM brand data](https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2018/UploadCommitteeFiles/63rd%20DCC%20Minutes.pdf)
- [Kaggle A–Z Medicine Dataset of India](https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india)
- [Kaggle 2025 India medicines (1mg scrape)](https://www.kaggle.com/datasets/apkaayush/india-medicines-and-drug-info-dataset)
