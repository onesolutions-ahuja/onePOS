import React from "react";
import { Link } from "react-router-dom";
import { BookOpen, MessageCircleQuestion, LifeBuoy, FileText, Mail, ArrowRight, ShieldCheck } from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, Btn, CTASection } from "../components/Ui";

const GUIDES = [
  {
    icon: LifeBuoy,
    title: "Help & Support centre",
    blurb: "Practical tutorials, troubleshooting, staff training and screenshot-ready product guides.",
    to: "/help",
    cta: "Open the Help Centre",
  },
  {
    icon: MessageCircleQuestion,
    title: "Frequently asked questions",
    blurb: "Till setup, inventory, purchasing, online orders, WhatsApp, hardware and accounts.",
    to: "/faq",
    cta: "Open the FAQ",
  },
  {
    icon: ShieldCheck,
    title: "Security & business control",
    blurb: "Roles, permissions, company/store separation, audit logging and secure invoice links.",
    to: "/security",
    cta: "Read the guide",
  },
  {
    icon: BookOpen,
    title: "Hardware guide",
    blurb: "Scanners, receipt printers, cash drawers and touchscreens — what connects how.",
    to: "/hardware",
    cta: "Read the guide",
  },
  {
    icon: LifeBuoy,
    title: "Support",
    blurb: "Log in to onePOS and use the in-app workspace — settings, diagnostics and test workflows live there.",
    to: "/login",
    cta: "Log in for support",
  },
];

export default function ResourcesPage() {
  usePageMeta({
    title: "onePOS | Resources, guides & support",
    description: "onePOS resources: FAQ, hardware guide, security & business control, and support through the app workspace.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Resources" }]}
        eyebrow="Resources & support"
        title="Guides, answers and the workspace itself"
        lead="Everything a team needs to get the most from onePOS — from quick answers to the details behind the platform."
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
        </div>
      </PageHero>

      <section className="section section--flush">
        <div className="wrap">
          <div className="guide-grid">
            {GUIDES.map((g) => {
              const Icon = g.icon;
              return (
                <Link to={g.to} className="guide-card" key={g.title}>
                  <span className="icon-tile"><Icon size={19} /></span>
                  <h3>{g.title}</h3>
                  <p>{g.blurb}</p>
                  <span className="feature-link">{g.cta} <ArrowRight size={13} /></span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section--soft" id="contact">
        <div className="wrap">
          <SectionHead eyebrow="Contact" title="Talk to us" lead="Pre-launch website — the fastest route is the app itself." />
          <div className="contact-card">
            <span className="icon-tile"><Mail size={19} /></span>
            <div>
              <h3>Contact the onePOS team</h3>
              <p>
                For launch questions, partnerships or feedback: reach out through your onePOS workspace,
                or email the team at <a href="mailto:hello@onepos.example" className="text-link">hello@onepos.example</a>{" "}
                (placeholder address until launch).
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="legal">
        <div className="wrap">
          <SectionHead eyebrow="Legal" title="Privacy & terms" lead="Placeholder documents pending launch." />
          <div className="guide-grid guide-grid--2">
            <div className="guide-card guide-card--static">
              <span className="icon-tile"><FileText size={19} /></span>
              <h3>Privacy policy</h3>
              <p>
                onePOS stores business and customer data only in support of the platform's functions —
                sales, stock, purchasing, customers and communications. A full policy will be published
                before launch.
              </p>
            </div>
            <div className="guide-card guide-card--static">
              <span className="icon-tile"><FileText size={19} /></span>
              <h3>Terms of service</h3>
              <p>
                onePOS is an internal/pre-launch platform. Terms of service will be published before the
                public launch of the product.
              </p>
            </div>
          </div>
          <p className="channel-note">
            Brand names on this website (WhatsApp, Uber Eats, Deliveroo, Just Eat, Shopify, Microsoft,
            Android, Apple) are trademarks of their owners and appear to identify compatibility only.
          </p>
        </div>
      </section>
    </div>
  );
}