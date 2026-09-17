import React from "react";
import { Link } from "react-router-dom";
import {
  Link2,
  FileText,
  Send,
  ShieldCheck,
  Bell,
  FlaskConical,
  Eye,
  ArrowRight,
  Lock,
  History,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection, BrowserFrame } from "../components/Ui";
import { BrandIcon } from "../components/BrandIcons";
import { WhatsAppScreen } from "../components/AppMockups";

const STEPS = [
  { icon: Send, step: "01", title: "Connect", detail: "Add your WhatsApp Business credentials and prove them with a real connection test." },
  { icon: FileText, step: "02", title: "Deliver", detail: "Choose secure-link or PDF delivery; send automatically or on demand." },
  { icon: Eye, step: "03", title: "Verify", detail: "The delivery log shows attempts with customer numbers masked." },
];

const MODES = [
  {
    icon: Link2,
    title: "Secure invoice link",
    blurb: "A tokenised URL (/i/:token) that opens the invoice without a login — no customer account required.",
    ticks: ["Opaque token, no customer IDs in the URL", "Hash-only token storage", "Generic 404s for unknown tokens"],
  },
  {
    icon: FileText,
    title: "PDF invoice",
    blurb: "A branded invoice PDF delivered straight to the customer's chat.",
    ticks: ["Generated per sale", "Same secure-link protection", "Downloadable from the chat"],
  },
];

export default function WhatsAppPage() {
  usePageMeta({
    title: "onePOS | WhatsApp invoicing — secure invoice links and PDF delivery",
    description:
      "onePOS WhatsApp invoicing: secure tokenised invoice links and PDF invoices delivered to customers automatically or on demand, with a test-before-activate workflow.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "WhatsApp invoicing" }]}
        eyebrow="Customer communication"
        title="Invoices delivered the way your customers already chat"
        lead="WhatsApp is an available onePOS capability: send each sale to the customer as a secure, tokenised invoice link or a PDF — automatically after the sale, or on demand."
      >
        <div className="page-hero-actions">
          <Btn to="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/integrations" variant="secondary">All integrations</Btn>
        </div>
        <div className="hero-brand-note">
          <span className="brand-note-icon"><BrandIcon name="whatsapp" /></span>
          WhatsApp is a trademark of Meta Platforms, Inc. onePOS is not affiliated with, endorsed by or sponsored by Meta.
        </div>
      </PageHero>

      {/* Visual */}
      <section className="section section--flush">
        <div className="wrap">
          <BrowserFrame url="app.onepos.example/whatsapp" caption="What the customer sees (right) and the settings that make it happen (left).">
            <WhatsAppScreen />
          </BrowserFrame>
        </div>
      </section>

      {/* Steps */}
      <section className="section">
        <div className="wrap">
          <SectionHead eyebrow="How it works" title="Connect · Deliver · Verify" />
          <div className="step-row step-row--3">
            {STEPS.map((item, i) => {
              const Icon = item.icon;
              return (
                <React.Fragment key={item.step}>
                  <div className="step-card">
                    <span className="step-num">{item.step}</span>
                    <span className="icon-tile icon-tile--sm"><Icon size={16} /></span>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </div>
                  {i < STEPS.length - 1 && <span className="step-arrow" aria-hidden="true"><ArrowRight size={18} /></span>}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </section>

      {/* Delivery modes */}
      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="Delivery modes" title="Link or PDF — your choice, per business" />
          <div className="mode-grid">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <div className="mode-card" key={m.title}>
                  <span className="icon-tile"><Icon size={19} /></span>
                  <h3>{m.title}</h3>
                  <p>{m.blurb}</p>
                  <CheckList items={m.ticks} />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Test workflow */}
      <section className="section">
        <div className="wrap split-section split-section--reverse">
          <div className="split-note">
            <div className="note-card">
              <h4>Test before you activate</h4>
              <div className="test-flow">
                <span className="test-item"><FlaskConical size={14} /><b>Test Connection</b> probes real credentials</span>
                <span className="test-item"><Eye size={14} /><b>Preview test invoice</b> builds the message — sends nothing</span>
                <span className="test-item"><Send size={14} /><b>Send real test invoice</b> delivers to the number you enter</span>
              </div>
            </div>
          </div>
          <div className="split-copy">
            <SectionHead eyebrow="Safety first" title="Prove the pipe before you switch it on" />
            <p className="lead">
              onePOS gates activation on a successful connection test: new credentials invalidate the
              previous test, and "Save & Activate" stays disabled until the connection is proven.
              Delivery history keeps customer numbers masked.
            </p>
            <CheckList
              items={[
                "Connection test before activation",
                "Preview builds the exact message shown to customers",
                "Real test send uses a number you choose",
                "Delivery log masks customer numbers",
              ]}
            />
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="section section--dark">
        <div className="wrap">
          <SectionHead
            eyebrow="Secure by design"
            title="Tokens, not accounts"
            lead="An invoice link is a credential in its own right — so it is treated like one."
            dark
          />
          <div className="feature-grid feature-grid--4 dark-cards">
            <div className="feature-card feature-card--dark">
              <span className="icon-tile"><Lock size={18} /></span>
              <h3>Opaque tokens</h3>
              <p>No customer or sale IDs in the URL — nothing guessable.</p>
            </div>
            <div className="feature-card feature-card--dark">
              <span className="icon-tile"><ShieldCheck size={18} /></span>
              <h3>Hash-only storage</h3>
              <p>Tokens are stored hashed; unknown tokens return generic 404s.</p>
            </div>
            <div className="feature-card feature-card--dark">
              <span className="icon-tile"><History size={18} /></span>
              <h3>Audited lifecycle</h3>
              <p>Link creation and revocation are recorded via the audit log.</p>
            </div>
            <div className="feature-card feature-card--dark">
              <span className="icon-tile"><Bell size={18} /></span>
              <h3>Automatic sending</h3>
              <p>Auto-send switches on per business after activation.</p>
            </div>
          </div>
        </div>
      </section>

      <CTASection
        title="Put invoices in your customers' favourite chat"
        lead="Log in to onePOS to open WhatsApp settings — or read about secure invoice links and the API & integrations foundation first."
      />
    </div>
  );
}