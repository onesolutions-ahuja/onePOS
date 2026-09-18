import React from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import {
  ArrowRight,
  Lock,
  Map,
  FlaskConical,
  FileSearch,
  ShieldCheck,
  Plug,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection, BrowserFrame, Icon } from "../components/Ui";
import { BrandIcon } from "../components/BrandIcons";
import { IntegrationsScreen } from "../components/AppMockups";
import integrationData from "../data/integrationData";
import ecosystemData from "../data/ecosystemData";

const ORDER = ["whatsapp", "uber-eats", "deliveroo", "just-eat", "shopify", "accounting", "api"];

const FOUNDATION = [
  { icon: Lock, title: "Encrypted at rest", blurb: "Credentials and API keys are encrypted before they touch the database." },
  { icon: ShieldCheck, title: "Masked on screen", blurb: "The interface only ever shows configured flags and masked hints." },
  { icon: Map, title: "Field mapping", blurb: "Source fields map to target fields — no rigid schemas." },
  { icon: FlaskConical, title: "Test before use", blurb: "Endpoints and connections test with real or saved credentials." },
  { icon: FileSearch, title: "API logs", blurb: "Every attempt records status, duration and outcome." },
  { icon: Plug, title: "Permission-gated", blurb: "Integration management sits behind 'manage integrations' permissions." },
];

export default function IntegrationsPage() {
  const { integration } = useParams();
  const entry = integration ? integrationData[integration] : null;

  usePageMeta(
    entry
      ? {
          title: `onePOS | ${entry.name} — integration overview`,
          description: entry.summary,
        }
      : {
          title: "onePOS | Integrations, channels & API foundation",
          description:
            "onePOS integrations: WhatsApp invoicing, online delivery channels, accounting and a provider-agnostic API foundation with encrypted credentials, field mapping and API logs.",
        }
  );

  // Detail view
  if (integration) {
    if (integration === "whatsapp") {
      return <Navigate to="/whatsapp" replace />;
    }
    if (!entry) {
      return (
        <div className="page">
          <PageHero
            crumbs={[{ label: "Home", to: "/" }, { label: "Integrations" }]}
            eyebrow="Integrations"
            title="Integration not found"
            lead="That integration page doesn't exist — browse the full list instead."
          >
            <Btn to="/integrations" variant="primary">All integrations</Btn>
          </PageHero>
        </div>
      );
    }

    const related = ORDER.filter((slug) => slug !== integration).slice(0, 4);

    return (
      <div className="page">
        <PageHero
          crumbs={[{ label: "Home", to: "/" }, { label: "Integrations", to: "/integrations" }, { label: entry.name }]}
          eyebrow={`${entry.category} · works with onePOS`}
          title={entry.name}
          lead={entry.tagline}
        >
          <div className="page-hero-actions">
            <Btn href="/login" variant="primary">Log in to onePOS</Btn>
            <Btn to="/online-orders" variant="secondary">Online Orders</Btn>
          </div>
          <div className="hero-brand-note">
            <span className="brand-note-icon"><BrandIcon name={entry.icon} /></span>
            {entry.note}
          </div>
        </PageHero>

        <section className="section section--flush">
          <div className="wrap">
            <div className="int-summary">
              <span className="icon-tile icon-tile--lg"><Icon name={entry.icon} size={26} /></span>
              <div>
                <h2>{entry.summary}</h2>
              </div>
            </div>
          </div>
        </section>

        <section className="section section--soft">
          <div className="wrap">
            <SectionHead eyebrow="Inside the integration" title={`${entry.name} within onePOS`} />
            <div className="feature-grid feature-grid--3">
              {entry.features.map((f) => (
                <div className="feature-card feature-card--static" key={f}>
                  <span className="check-tick check-tick--static" aria-hidden="true">✓</span>
                  <p>{f}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <SectionHead eyebrow="How it works" title="The workflow in onePOS" />
            <div className="step-row step-row--3">
              {entry.workflow.map((item, i) => (
                <React.Fragment key={item.step}>
                  <div className="step-card">
                    <span className="step-num">0{i + 1}</span>
                    <h3>{item.step}</h3>
                    <p>{item.detail}</p>
                  </div>
                  {i < entry.workflow.length - 1 && <span className="step-arrow" aria-hidden="true"><ArrowRight size={18} /></span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>

        <section className="section section--soft">
          <div className="wrap">
            <SectionHead eyebrow="Related" title="More of the onePOS platform" />
            <div className="related-grid">
              {related.map((slug) => {
                const c = integrationData[slug];
                return (
                  <Link to={c.route} className="related-card" key={slug}>
                    <span className="icon-tile icon-tile--sm"><Icon name={c.icon} size={16} /></span>
                    <div>
                      <h4>{c.name}</h4>
                      <p>{c.tagline}</p>
                    </div>
                  </Link>
                );
              })}
              <Link to="/online-orders" className="related-card">
                <span className="icon-tile icon-tile--sm"><Icon name="shopping-bag" size={16} /></span>
                <div>
                  <h4>Online Orders</h4>
                  <p>The single workflow every channel flows through.</p>
                </div>
              </Link>
            </div>
          </div>
        </section>

        <CTASection
          title={`See how ${entry.name} fits your workflow`}
          lead="Log in to onePOS to open the integration workspace — or explore another channel first."
        />
      </div>
    );
  }

  // Hub view
  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Integrations" }]}
        eyebrow="Channels & integrations"
        title="One platform, connected to the channels your customers use"
        lead="Invoices to WhatsApp, orders from delivery platforms, data to your accounting system — each connection is a configuration, not a compromise."
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/ecosystem" variant="secondary">The ecosystem</Btn>
        </div>
      </PageHero>

      {/* Channels */}
      <section className="section section--flush">
        <div className="wrap">
          <div className="channel-grid">
            {ORDER.map((slug) => {
              const c = integrationData[slug];
              return (
                <Link to={c.route} className="channel-card channel-card--lg" key={slug}>
                  <span className="channel-brand"><BrandIcon name={c.icon} /></span>
                  <span className="channel-name">{c.name}</span>
                  <span className="channel-sub">{c.tagline}</span>
                  <span className="channel-cta">Explore <ArrowRight size={13} /></span>
                </Link>
              );
            })}
          </div>
          <p className="channel-note">
            Third-party names identify compatibility only. onePOS is not affiliated with, endorsed by or
            sponsored by WhatsApp/Meta, Uber Eats, Deliveroo, Just Eat, Shopify or any other brand shown.
          </p>
        </div>
      </section>

      {/* Foundation */}
      <section className="section">
        <div className="wrap">
          <SectionHead
            eyebrow="The foundation"
            title="Connected by design, secured by default"
            lead="Every integration in onePOS — WhatsApp, delivery platforms, accounting — sits on the same provider-agnostic foundation."
          />
          <div className="feature-grid feature-grid--3">
            {FOUNDATION.map((f) => {
              const Icon = f.icon;
              return (
                <div className="feature-card feature-card--static" key={f.title}>
                  <span className="icon-tile"><Icon size={18} /></span>
                  <h3>{f.title}</h3>
                  <p>{f.blurb}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Visual */}
      <section className="section section--soft">
        <div className="wrap">
          <BrowserFrame url="app.onepos.example/integrations" caption="The integrations workspace — providers, status, endpoint configuration, field mapping and API logs.">
            <IntegrationsScreen />
          </BrowserFrame>
        </div>
      </section>

      <CTASection
        title="Connect onePOS to the channels you already use"
        lead="Log in to onePOS to open the integration workspace — or read the accounting and API pages to understand the foundation."
      />
    </div>
  );
}