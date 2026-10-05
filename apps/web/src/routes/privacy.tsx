import { createFileRoute, Link } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { CONTACT_EMAIL, CONTACT_MAILTO, CONTACT_RESPONSE } from "@/lib/contact";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/privacy")({
  head: () => pageHead({ path: "/privacy" }),
  component: () => (
    <PublicPage
      title="What we collect, and what we do with it."
      lead="Draft reviewed 4 October 2026; publication awaits counsel approval. This website collects limited contact and access data; patient records are processed on the hospital's instructions."
    >
      <div className={PROSE}>
        <h2>Who this covers</h2>
        <p>
          <strong>Visitors</strong> to this website. <strong>Staff</strong> who sign in to Edernal
          Care with an account their hospital created. <strong>Patients</strong> whose records a
          hospital keeps in Edernal Care. Each is handled differently below.
        </p>
        <p>
          Edernal Care determines the purposes of website enquiries and website security logs. The
          hospital determines the purposes of patient records and hospital staff accounts. This
          notice is not the hospital's patient-consent form: the hospital must give its own
          collection notice, identify the collecting and retaining agencies, and obtain the required
          consent or establish another lawful basis before entering records.
        </p>
        <p>
          The DPDP Act's substantive notice, consent, rights and breach duties are scheduled for 13
          May 2027. We describe those future rights below as our policy now, not as duties already
          in force. Current sensitive-data duties under the IT Act and SPDI Rules still apply. A
          hospital must offer its consent notice in English or an Eighth Schedule language chosen by
          the person when the DPDP notice provisions commence.
        </p>

        <h2>This website</h2>
        <p>
          We do not run analytics, advertising or tracking on these pages. The only thing stored in
          your browser is your light/dark theme preference, which never leaves it. Our server keeps
          ordinary access logs (address, page, time) only to keep the site running and to
          investigate abuse.
        </p>
        <p>
          <strong>Enquiries:</strong> your email address, name and message let us answer a demo,
          support or grievance request. If you choose an available WhatsApp or phone link, we also
          receive your number and what you send. You can decline to contact us; please do not send
          patient information through these public channels.
        </p>

        <h2>Staff accounts</h2>
        <p>
          A hospital administrator creates each account; there is no public sign-up. We hold the{" "}
          <strong>name, email address, roles and login sessions</strong> needed to authenticate you
          and to record who did what. Actions on sensitive records — role denials, deletions,
          financial corrections — are written to an audit log that belongs to your hospital and that
          you cannot edit. Passwords are hashed; we cannot read them.
        </p>

        <h2>Patient records</h2>
        <p>
          The hospital decides what to record and why; in the language of the DPDP Act it is the{" "}
          <strong>Data Fiduciary</strong>, and Edernal Care processes data on its instructions as a{" "}
          <strong>Data Processor</strong>. Edernal Care stores, for each hospital, what its staff
          enter: demographics and MRN, phone, allergies, appointments, prescription scans, charges,
          invoices, payments and receipts. Identity and contact details identify the patient and
          support appointments; health details and scans support the hospital's care record; charges
          and payment records support billing, receipts and reconciliation.
        </p>
        <ul>
          <li>
            <strong>One hospital, one dataset.</strong> Every record carries exactly one
            organization and every request proves membership before it reads or writes. No hospital
            can see another's data, and neither can this website.
          </li>
          <li>
            <strong>Uploaded files are private.</strong> Prescription scans live in a private bucket
            that is never publicly readable; the software issues a short-lived link each time an
            authorised member opens one.
          </li>
          <li>
            <strong>No AI on patient data.</strong> Nothing in Edernal Care sends patient records to
            an AI service or trains a model on them.
          </li>
          <li>
            <strong>No sale or advertising use.</strong> We do not sell or rent patient or staff
            data. Contracted hosting, storage and recovery providers process it to operate the
            service; authorised operators access it only for the hospital's support instructions.
            Disclosure may also be required by a lawful order or reporting obligation. Public email
            and optional WhatsApp enquiries also pass through their respective providers, whose
            privacy terms apply.
          </li>
          <li>
            <strong>It is exportable.</strong> Every report exports to Excel or PDF over any date
            range, and every document renders as a PDF. A hospital's records are the hospital's to
            take with it.
          </li>
        </ul>
        <h2>Your choices and rights</h2>
        <p>
          For website enquiries, email <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> from the address
          you used, saying whether you want access, correction, erasure or no further follow-up. You
          may decline optional information or withdraw consent by replying through the same channel
          used to give it. Withdrawal does not undo lawful earlier processing, and may prevent us
          providing the service that needs that information.
        </p>
        <p>
          For patient or hospital staff data, contact the hospital's privacy or grievance contact
          with your hospital name and MRN or staff email; do not send medical records to our public
          inbox. We route requests received directly to the hospital and tell you. Under the DPDP
          policy, you may ask for a summary of your data and processing, who it was shared with,
          correction, completion, updating or erasure, and nominate someone to exercise your rights
          if you die or become incapable. The hospital verifies identity and any representative's
          authority and handles applicable legal exceptions.
        </p>
        <p>
          A Board complaint follows the opportunity to resolve a grievance with the responsible Data
          Fiduciary or Consent Manager. Once the DPDP complaint provisions commence, use the Data
          Protection Board of India's published digital complaint procedure, retaining your request
          and reply. The{" "}
          <a href="https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa">
            official MeitY notifications
          </a>{" "}
          describe the Board and commencement phases; we do not claim a currently available DPDP
          complaint portal.
        </p>
        <p>
          A Consent Manager is a Board-registered service acting on your behalf to give, manage,
          review or withdraw consent. Edernal Care is not a registered Consent Manager and has no
          integrated Consent Manager service. You may use an authorised representative; the hospital
          must handle a registered Consent Manager's request when applicable.
        </p>

        <h2>Retention, deletion and location</h2>
        <p>
          Data is kept only for its stated purpose or an applicable legal retention duty. Our
          enquiry policy is to delete resolved correspondence after one year unless a recorded legal
          hold requires longer. Hospital clinical and financial records follow the hospital's
          category-specific retention duties; withdrawal or exit does not erase records that must
          legally be retained. On a deletion request, we explain the applicable hold and residual
          backup expiry rather than promise immediate deletion of every copy.
        </p>
        <p>
          Production hosting and recovery policy requires Indian storage and ICT logs retained
          securely in India for at least 180 days under CERT-In directions. Future DPDP rules
          require covered processing/security records for at least one year. These are deployment
          requirements, not a claim that this draft verifies a production host. Any transfer must
          meet applicable protection and transfer restrictions. Our{" "}
          <Link to="/security">security page</Link> describes the implemented access controls.
        </p>

        <h2>If something goes wrong</h2>
        <p>
          For hospital data, our incident lead informs the affected hospital immediately and
          supplies known breach facts, likely consequences, mitigation, protective steps and a
          contact. The hospital remains responsible for affected-person and Board intimation. For
          website data for which we determine the purpose, we handle that intimation. Our policy
          adopts DPDP Rule 7 now: initial affected-person and Board notices without delay, followed
          by detailed Board information within 72 hours of awareness unless the Board grants a
          written extension. Those DPDP duties commence in the substantive phase scheduled for 13
          May 2027. Separately, reportable CERT-In incidents must be reported within six hours of
          noticing or being informed, not after the investigation finishes.
        </p>

        <h2>Questions and complaints</h2>
        <p>
          The founder is the designated public grievance and privacy contact. Write to{" "}
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> with the subject “Privacy grievance” and
          enough non-sensitive detail to identify the request. {CONTACT_RESPONSE}
        </p>

        <h2>Changes</h2>
        <p>
          When this notice changes, the date at the top changes with it and the{" "}
          <Link to="/changelog">changelog</Link> records what moved.
        </p>
      </div>
    </PublicPage>
  ),
});
