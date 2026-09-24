import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ShoppingBag,
  MapPin,
  Map,
  CheckCircle2,
  Settings2,
  Lock,
  BarChart3,
  Layers,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection, BrowserFrame, CompatibilityStrip } from "../components/Ui";
import { BrandIcon } from "../components/BrandIcons";
import { OnlineOrdersScreen } from "../components/AppMockups";
import integrationData from "../data/integrationData";

const CHANNELS = ["uber-eats", "deliveroo", "just-eat", "shopify"];

const FLOW = [
  { icon: MapPin, step: "01", title: "Order arrives", detail: "Webhook intake with verification; duplicates can't double-book." },
  { icon: Map, step: "02", title: "Items map to products", detail: "Platform items link to your catalogue — saved mappings speed it up." },
  { icon: ShoppingBag, step: "03", title: "Prep in one place", detail: "One prep workflow for every channel, next to the till." },
  { icon: CheckCircle2, step: "04", title: "Complete → POS sale", detail: "Completing an order creates the POS sale and updates stock together." },
];

const CONTROL = [
  { icon: Settings2, title: "Environment control", blurb: "Sandbox and production environments per platform, stored per company." },
  { icon: Lock, title: "Encrypted credentials", blurb: "Secrets are encrypted at rest and only ever shown as masked hints." },
  { icon: CheckCircle2, title: "Order acceptance", blurb: "Manual or automatic acceptance, plus customer OTP on completion where you want it." },
  { icon: Layers, title: "Item mapping", blurb: "Manual mapping never auto-creates products; future orders resolve automatically." },
];

export default function OnlineOrdersPage() {
  usePageMeta({
    title: "onePOS | Online orders — delivery platforms meet the till",
    description:
      "onePOS online orders: Uber Eats and Deliveroo order intake, item mapping, one prep workflow, POS sale creation and stock updates on completion.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Online Orders" }]}
        eyebrow="Online orders & delivery"
        title="Delivery orders, in the same workflow as the counter"
        lead="onePOS's online-orders module is built around delivery platforms: orders arrive, map to your products, prep in one place — and completing an order creates the POS sale and updates stock in the same transaction."
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/integrations" variant="secondary">See all integrations</Btn>
        </div>
      </PageHero>

      {/* Channel cards */}
      <section className="section section--flush">
        <div className="wrap">
          <div className="channel-grid">
            {CHANNELS.map((slug) => {
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
            OnePOS is not affiliated with, endorsed by or sponsored by these platforms. Channel branding
            identifies compatibility and integration targets only.
          </p>
        </div>
      </section>

      {/* Visual */}
      <section className="section section--flush">
        <div className="wrap">
          <BrowserFrame url="app.onepos.example/order-prep" caption="Online orders next to the till — platform, customer, items and status in each card.">
            <OnlineOrdersScreen />
          </BrowserFrame>
        </div>
      </section>

      {/* Flow */}
      <section className="section">
        <div className="wrap">
          <SectionHead eyebrow="The order lifecycle" title="From ping to POS sale" />
          <div className="step-row step-row--4">
            {FLOW.map((item, i) => {
              const Icon = item.icon;
              return (
                <React.Fragment key={item.step}>
                  <div className="step-card">
                    <span className="step-num">{item.step}</span>
                    <span className="icon-tile icon-tile--sm"><Icon size={16} /></span>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </div>
                  {i < FLOW.length - 1 && <span className="step-arrow" aria-hidden="true"><ArrowRight size={18} /></span>}
                </React.Fragment>
              );
            })}
          </div>
          <div className="flow-quote">
            <div className="flow-quote-visual">
              <CompatibilityStrip
                items={[
                  { icon: "uber-eats", label: "Uber Eats" },
                  { icon: "deliveroo", label: "Deliveroo" },
                  { icon: "just-eat", label: "Just Eat" },
                  { icon: "shopify", label: "Shopify (commerce direction)" },
                ]}
              />
            </div>
            <p>
              Channel branding appears for identification only — it means "works with onePOS's online
              order workflow", never partnership or endorsement.
            </p>
          </div>
        </div>
      </section>

      {/* Control */}
      <section className="section section--dark">
        <div className="wrap">
          <SectionHead
            eyebrow="Platform control"
            title="Configured per company, secured by default"
            lead="Platform settings live in the same integration architecture as every other connection."
            dark
          />
          <div className="feature-grid feature-grid--4 dark-cards">
            {CONTROL.map((f) => {
              const Icon = f.icon;
              return (
                <div className="feature-card feature-card--dark" key={f.title}>
                  <span className="icon-tile"><Icon size={18} /></span>
                  <h3>{f.title}</h3>
                  <p>{f.blurb}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Inventory + reporting */}
      <section className="section section--soft">
        <div className="wrap split-section">
          <div className="split-copy">
            <SectionHead eyebrow="One ledger, every channel" title="Stock reserves, releases and sales — all in the same reports" />
            <p className="lead">
              Online orders use dedicated movement types (reserve / release) so delivery stock behaves
              like everything else — and online sales land in the same reporting as the counter.
            </p>
            <CheckList
              items={[
                "Online reserve and release movements recorded",
                "Completed orders create real POS sales",
                "Delivery activity appears in platform logs",
                "Reports cover in-store and online together",
              ]}
            />
            <div className="inline-actions">
              <Btn to="/inventory" variant="secondary">See Inventory</Btn>
              <Btn to="/reports" variant="ghost">See Reports</Btn>
            </div>
          </div>
          <div className="split-note">
            <div className="note-card">
              <h4>Visiting platform pages</h4>
              <p>Each channel has its own page with the workflow it follows inside onePOS:</p>
              <ul className="mini-list">
                <li><ShoppingBag size={14} /> <Link to="/integrations/uber-eats" className="text-link">Uber Eats in onePOS <ArrowRight size={12} /></Link></li>
                <li><ShoppingBag size={14} /> <Link to="/integrations/deliveroo" className="text-link">Deliveroo in onePOS <ArrowRight size={12} /></Link></li>
                <li><BarChart3 size={14} /> <Link to="/integrations/just-eat" className="text-link">Just Eat channel <ArrowRight size={12} /></Link></li>
                <li><ShoppingBag size={14} /> <Link to="/integrations/shopify" className="text-link">Shopify direction <ArrowRight size={12} /></Link></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <CTASection
        title="Put delivery in the same system as the till"
        lead="Log in to onePOS to explore the online-orders workspace — or read the per-platform pages first."
      />
    </div>
  );
}