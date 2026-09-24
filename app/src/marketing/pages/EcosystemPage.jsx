import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Layers, Boxes, Cable, Workflow } from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, Btn, CTASection, Icon } from "../components/Ui";
import ecosystemData from "../data/ecosystemData";

const PILLARS = [
  { icon: Layers, title: "One core", blurb: "Till, inventory, purchasing, customers and reports share one catalogue, one ledger and one set of permissions." },
  { icon: Boxes, title: "Growing channels", blurb: "Online orders, WhatsApp invoicing, accounting and API connections extend the core — each behind the same configuration and security." },
  { icon: Cable, title: "Honest hardware", blurb: "Scanners, printers, drawers and touchscreens connect where the device and setup allow — no exaggerated claims." },
  { icon: Workflow, title: "One workflow", blurb: "A delivery order, an in-store sale and a supplier receipt all end up in the same reports." },
];

export default function EcosystemPage() {
  usePageMeta({
    title: "onePOS | Ecosystem — channels, add-ons and connections",
    description:
      "The onePOS ecosystem: WhatsApp invoicing, online delivery channels, accounting, API & integrations, payments, reporting and hardware — one platform, many connections.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Ecosystem" }]}
        eyebrow="The onePOS ecosystem"
        title="Not just a till — a platform with room to grow"
        lead="onePOS is built around a solid retail core: the till, stock, purchasing, customers and reports. Around that core sit channels, connections and add-ons — each one a configuration, not a second system."
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/integrations" variant="secondary">All integrations</Btn>
        </div>
      </PageHero>

      {/* Pillars */}
      <section className="section section--flush">
        <div className="wrap">
          <div className="pillar-grid">
            {PILLARS.map((p) => {
              const Icon = p.icon;
              return (
                <div className="pillar-card" key={p.title}>
                  <span className="pillar-icon pillar-icon--teal"><Icon size={20} /></span>
                  <h3>{p.title}</h3>
                  <p>{p.blurb}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Ecosystem cards */}
      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="The catalogue" title="What's in the ecosystem" lead="Every card links to its dedicated page — brand marks identify compatibility, never partnership." />
          <div className="eco-grid">
            {ecosystemData.map((item) => (
              <Link to={item.to} className="eco-card" key={item.slug}>
                <span className="eco-icon" style={{ "--eco-color": item.color }}>
                  <Icon name={item.icon} size={20} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.blurb}</p>
                <span className="feature-link">Learn more <ArrowRight size={13} /></span>
              </Link>
            ))}
          </div>
          <p className="channel-note">
            WhatsApp, Uber Eats, Deliveroo, Just Eat and Shopify are trademarks of their respective
            owners and appear for identification only. onePOS is not affiliated with, endorsed by or
            sponsored by any of them.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap note-band">
          <span className="note-band-icon"><Workflow size={20} /></span>
          <div>
            <h3>Everything flows into the same numbers</h3>
            <p>
              A WhatsApp invoice, an Uber Eats order and a till sale all live on the same transaction
              records — so the ecosystem never fragments the business.
            </p>
          </div>
        </div>
      </section>

      <CTASection
        title="One platform, ready to grow with you"
        lead="Log in to onePOS to see the workspace — or explore any add-on above to understand how it fits."
      />
    </div>
  );
}