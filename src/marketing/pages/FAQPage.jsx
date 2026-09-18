import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, Btn, CTASection } from "../components/Ui";

const FAQS = [
  {
    q: "What is onePOS?",
    a: "onePOS is a retail management platform: point of sale, inventory, purchasing, customers, employees, reports and online channels in one workspace. It is more than a till — the counter, the stockroom, the supplier desk and the delivery channels share one system.",
  },
  {
    q: "What devices can I run onePOS on?",
    a: "onePOS is browser-based, so it runs in any modern browser — on Windows desktops and touch terminals, Android tablets and iPads. There's no install: the same account works from any device.",
  },
  {
    q: "Does onePOS work offline?",
    a: "onePOS is designed around connectivity loss: essential context is kept locally and activity queues and syncs when the connection returns. Offline behaviour depends on the version and configuration, so verify in your own setup.",
  },
  {
    q: "How do sales and stock stay in sync?",
    a: "Every sale, purchase, return and online order writes a dated stock movement. Receiving stock creates PURCHASE movements; completing an online order creates the POS sale and updates stock in the same transaction.",
  },
  {
    q: "How do online orders arrive?",
    a: "onePOS's online-orders module is built around the Uber Eats and Deliveroo order flow: orders arrive by webhook with signature verification, items map to your product catalogue, orders progress through prep, and completion creates the POS sale. Just Eat and online commerce sit in the same channel architecture.",
  },
  {
    q: "How does WhatsApp invoicing work?",
    a: "Each sale can be delivered to the customer over WhatsApp as a secure tokenised invoice link or a PDF — automatically after the sale or on demand. Activation is gated on a successful connection test, and the delivery log masks customer numbers.",
  },
  {
    q: "Are invoice links secure?",
    a: "Yes — invoice links are tokenised URLs with opaque tokens, hash-only storage and generic 404s for unknown tokens. No customer login is required: the link itself is the credential.",
  },
  {
    q: "How are roles and permissions handled?",
    a: "Users belong to a company and a store, and carry a role with granular permission codes — covering the till, cash, products, inventory, customers, reports, users, roles, payments, integrations and online orders. Discounts, voids, refunds and cash actions all sit behind permissions.",
  },
  {
    q: "Can I manage more than one store?",
    a: "Yes. onePOS is built around companies, stores and terminals. Users are store-scoped, tills belong to terminals, and the owner sees consolidated reports across the company.",
  },
  {
    q: "Which reports are available?",
    a: "Sales by day, payments by method, top products, customers, inventory movements, profit & margin, till & cash and VAT summary — each with date ranges, permissions and CSV export.",
  },
  {
    q: "How do I log in?",
    a: "Use the Log in button in the navigation — it takes you to the existing onePOS login at /login. Marketing pages and the app are separate: the login and app are untouched by the website.",
  },
  {
    q: "Is onePOS affiliated with the delivery and messaging platforms shown?",
    a: "No. WhatsApp, Uber Eats, Deliveroo, Just Eat and Shopify are trademarks of their owners and appear on this website only to identify compatibility and integration targets. onePOS is not affiliated with, endorsed by or sponsored by any of them.",
  },
];

export default function FAQPage() {
  const [open, setOpen] = useState(0);

  usePageMeta({
    title: "onePOS | FAQ — platform questions answered",
    description: "Frequently asked questions about onePOS: devices, offline, stock sync, online orders, WhatsApp invoicing, permissions, multi-store and reports.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "FAQ" }]}
        eyebrow="Resources"
        title="Frequently asked questions"
        lead="Quick answers about the platform — from devices and offline to permissions and online orders."
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/resources" variant="secondary">All resources</Btn>
        </div>
      </PageHero>

      <section className="section section--flush">
        <div className="wrap faq-wrap">
          {FAQS.map((faq, i) => (
            <div className={`faq-item ${open === i ? "is-open" : ""}`} key={i}>
              <button
                type="button"
                className="faq-q"
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
              >
                <span>{faq.q}</span>
                <ChevronDown size={17} className="faq-chevron" />
              </button>
              {open === i && <div className="faq-a">{faq.a}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="Still curious?" title="Explore the platform in depth" />
          <div className="inline-actions inline-actions--center">
            <Btn to="/pos" variant="secondary">POS & Till</Btn>
            <Btn to="/inventory" variant="ghost">Inventory</Btn>
            <Btn to="/online-orders" variant="ghost">Online Orders</Btn>
            <Btn to="/whatsapp" variant="ghost">WhatsApp invoicing</Btn>
            <Btn to="/security" variant="ghost">Security & Control</Btn>
          </div>
        </div>
      </section>

      <CTASection />
    </div>
  );
}