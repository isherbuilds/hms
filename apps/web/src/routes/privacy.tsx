import { env } from "@hms/env/web";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { pageHead } from "@/lib/seo";

/* Written in plain language to the shape India's DPDP Rules take from 13 May
   2027 (itemized data and purposes, a way to withdraw, a way to complain, a
   published contact) while meeting the SPDI Rules' current requirement to
   publish how sensitive personal data is handled. It is a notice, not a
   contract; the hospital's agreement with us governs the rest. */
export const Route = createFileRoute("/privacy")({
  head: () => pageHead({ path: "/privacy" }),
  component: () => (
    <PublicPage
      eyebrow="Privacy · effective 5 September 2026"
      title="What we collect, and what we do with it."
      lead="Short version: this website collects almost nothing; the software holds your hospital's data on your hospital's behalf, and never shares it across hospitals."
    >
      <div className={PROSE}>
        <h2>Who this covers</h2>
        <p>
          <strong>Visitors</strong> to this website. <strong>Staff</strong> who sign in to HMS with
          an account their hospital created. <strong>Patients</strong> whose records a hospital
          keeps in HMS. Each is handled differently below.
        </p>

        <h2>This website</h2>
        <p>
          We do not run analytics, advertising or tracking on these pages. The only thing stored in
          your browser is your light/dark theme preference, which never leaves it. Our server keeps
          ordinary access logs (address, page, time) only to keep the site running and to
          investigate abuse.
        </p>
        <p>
          If you contact us on WhatsApp or by email, we receive what you send and the number or
          address you send it from. We use it to reply and to follow up about HMS, and for nothing
          else. Please do not send patient information through either channel.
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
          <strong>Data Fiduciary</strong>, and HMS processes data on its instructions as a{" "}
          <strong>Data Processor</strong>. HMS stores, for each hospital, what its staff enter:
          demographics and MRN, phone, allergies, appointments, prescription scans, charges,
          invoices, payments and receipts.
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
            <strong>No AI on patient data.</strong> Nothing in HMS sends patient records to an AI
            service or trains a model on them.
          </li>
          <li>
            <strong>No sale, no sharing.</strong> We do not sell, rent or share patient or staff
            data with anyone. The only third parties are the infrastructure the hospital's
            deployment runs on.
          </li>
          <li>
            <strong>It is exportable.</strong> Every report exports to Excel or PDF over any date
            range, and every document renders as a PDF. A hospital's records are the hospital's to
            take with it.
          </li>
        </ul>
        <p>
          If you are a patient, your rights — to see what is held, correct it, or ask that it be
          erased — are exercised through the hospital that treated you. It holds the record and the
          relationship; we act on its instruction. Where a request reaches us directly, we pass it
          to the hospital and tell you we have done so.
        </p>

        <h2>If something goes wrong</h2>
        <p>
          If patient or staff data is exposed, we tell the affected hospital as soon as we know,
          with what happened and what we are doing about it, so it can meet its own duty to inform
          the people affected and the Data Protection Board.
        </p>

        <h2>Questions and complaints</h2>
        <p>
          Write to <a href={`mailto:${env.VITE_CONTACT_EMAIL}`}>{env.VITE_CONTACT_EMAIL}</a> with
          privacy questions or grievances. When the company operating HMS is incorporated, its legal
          name, registered office and the name of the person responsible for this notice will appear
          here and on the <Link to="/about">about page</Link>.
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
