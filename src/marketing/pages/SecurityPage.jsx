import React from "react";
import { Link } from "react-router-dom";
import {
  ShieldCheck,
  UserCog,
  KeyRound,
  FileClock,
  Lock,
  Link2,
  Building2,
  ArrowRight,
  ScanSearch,
  CreditCard,
  Settings2,
  Users,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection } from "../components/Ui";

const AREAS = [
  { icon: CreditCard, title: "Sales & cash", perms: "sale.create · void · refund · discount · price change · cash drawer · payout · till open/close" },
  { icon: Users, title: "Catalogue & people", perms: "product view/create/edit/delete · inventory view/adjust · customer view/create/edit" },
  { icon: ScanSearch, title: "Reporting", perms: "report.view · report.export — viewing and exporting controlled separately" },
  { icon: KeyRound, title: "Administration", perms: "user.manage · role.manage · payment.manage · settings.manage" },
  { icon: Settings2, title: "Platform control", perms: "integration.manage · online_orders.view · online_orders.manage · online_orders.configure" },
  { icon: ShieldCheck, title: "Guarding duties", perms: "every change is attributable to the user behind it" },
];

const MATRIX = [
  ["Capability", "Cashier", "Manager", "Owner"],
  ["Run sales", "✓", "✓", "✓"],
  ["Discounts & voids", "—", "✓", "✓"],
  ["Open/close till", "✓", "✓", "✓"],
  ["Cash payouts", "—", "✓", "✓"],
  ["Adjust stock", "—", "✓", "✓"],
  ["View reports", "—", "✓", "✓"],
  ["Export reports", "—", "—", "✓"],
  ["Manage users & roles", "—", "—", "✓"],
];

export default function SecurityPage() {
  usePageMeta({
    title: "onePOS | Security & business control — roles, permissions, audit",
    description:
      "onePOS security: granular roles and permissions, company and store separation, audit logging, secure invoice links and encrypted credentials.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Security & Control" }]}
        eyebrow="Security & business control"
        title="Sharper controls, without slowing the team down"
        lead="onePOS puts permissions where decisions matter — discounts, refunds, cash access, stock changes and reports — so every action is understood, attributable and reversible."
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/employees" variant="secondary">Employees & Permissions</Btn>
        </div>
      </PageHero>

      {/* Permission areas */}
      <section className="section section--flush">
        <div className="wrap">
          <SectionHead eyebrow="Granular permissions" title="Permission areas across the platform" />
          <div className="feature-grid feature-grid--3">
            {AREAS.map((a) => {
              const Icon = a.icon;
              return (
                <div className="feature-card feature-card--static" key={a.title}>
                  <span className="icon-tile"><Icon size={18} /></span>
                  <h3>{a.title}</h3>
                  <p className="perm-code">{a.perms}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Matrix */}
      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="In practice" title="A typical permission matrix" lead="Illustrative — real setups are configured per role. The pattern: least privilege by default." />
          <div className="matrix-wrap">
            <div className="matrix">
              {MATRIX.map((row, ri) => (
                <div className={`matrix-row ${ri === 0 ? "matrix-head" : ""}`} key={ri}>
                  {row.map((cell, ci) => (
                    <span className={`matrix-cell ${ci === 0 ? "matrix-label" : ""}`} key={ci}>{cell}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Separation & audit */}
      <section className="section">
        <div className="wrap split-section">
          <div className="split-copy">
            <SectionHead eyebrow="Company & store separation" title="One business's data stays its own" />
            <p className="lead">
              Every record — products, users, invoices, tokens — belongs to a company. Users attach to
              stores. A login can't cross company lines, and store-scoped roles can't see the whole
              group unless they're meant to.
            </p>
            <CheckList
              items={[
                "Company-scoped data at every layer",
                "Store-scoped users and terminals",
                "Consolidated company view only for those with access",
                "Audit log records actions over time",
              ]}
            />
          </div>
          <div className="split-note">
            <div className="note-card">
              <h4>Secure invoice links</h4>
              <p>
                Customer invoices open via tokenised URLs — no login, no account. Tokens are opaque and
                stored hashed, unknown tokens get generic 404s, and link lifecycle is audited.
              </p>
              <Link to="/whatsapp" className="text-link">WhatsApp invoicing <ArrowRight size={13} /></Link>
            </div>
          </div>
        </div>
      </section>

      {/* Credentials */}
      <section className="section section--dark">
        <div className="wrap">
          <SectionHead
            eyebrow="Credentials"
            title="Secrets that stay secret"
            lead="Integration secrets are treated as what they are — credentials."
            dark
          />
          <div className="feature-grid feature-grid--3 dark-cards">
            <div className="feature-card feature-card--dark">
              <span className="icon-tile"><Lock size={18} /></span>
              <h3>Encrypted at rest</h3>
              <p>WhatsApp tokens, platform keys and API secrets are encrypted before they touch the database.</p>
            </div>
            <div className="feature-card feature-card--dark">
              <span className="icon-tile"><ScanSearch size={18} /></span>
              <h3>Never echoed</h3>
              <p>The interface shows configured flags and masked hints — never the secret itself.</p>
            </div>
            <div className="feature-card feature-card--dark">
              <span className="icon-tile"><FileClock size={18} /></span>
              <h3>Test-gated activation</h3>
              <p>New credentials invalidate previous tests; activation stays disabled until proven.</p>
            </div>
          </div>
        </div>
      </section>

      <CTASection
        title="Control without friction"
        lead="Log in to onePOS to review roles and permissions — or explore multi-store management and employees first."
      />
    </div>
  );
}