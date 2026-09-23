import React from "react";
import { Link } from "react-router-dom";
import { BrandMark } from "./Ui";

const SECTIONS = [
  {
    title: "Product",
    links: [
      { label: "POS & Till", to: "/pos" },
      { label: "Inventory", to: "/inventory" },
      { label: "Purchasing", to: "/purchasing" },
      { label: "Customers", to: "/customers" },
      { label: "Employees & Permissions", to: "/employees" },
      { label: "Multi-store", to: "/multi-store" },
      { label: "Reports", to: "/reports" },
    ],
  },
  {
    title: "Online & Integrations",
    links: [
      { label: "Online Orders", to: "/online-orders" },
      { label: "WhatsApp invoicing", to: "/whatsapp" },
      { label: "Uber Eats", to: "/integrations/uber-eats" },
      { label: "Deliveroo", to: "/integrations/deliveroo" },
      { label: "Just Eat", to: "/integrations/just-eat" },
      { label: "Accounting", to: "/integrations/accounting" },
      { label: "API & Integrations", to: "/integrations/api" },
    ],
  },
  {
    title: "Platforms",
    links: [
      { label: "Web Browser", to: "/platform/web" },
      { label: "Windows", to: "/platform/windows" },
      { label: "Android", to: "/platform/android" },
      { label: "iPad", to: "/platform/ios" },
      { label: "Offline & Connectivity", to: "/platforms" },
      { label: "Hardware", to: "/hardware" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Help & Support", to: "/help" },
      { label: "Security & Control", to: "/security" },
      { label: "onePOS Ecosystem", to: "/ecosystem" },
      { label: "FAQ", to: "/faq" },
      { label: "Resources", to: "/resources" },
      { label: "Contact", to: "/resources#contact" },
    ],
  },
];

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Link to="/" className="brand" aria-label="onePOS home">
            <BrandMark />
            <span>onePOS</span>
          </Link>
          <p className="footer-tagline">
            Complete retail management, POS and business platform. The till, stock, purchasing,
            customers and online channels in one workspace.
          </p>
          <div className="footer-cta">
            <a href="/login" className="btn btn-primary btn-sm">
              Log in to onePOS
            </a>
            <Link to="/ecosystem" className="btn btn-ghost btn-sm">
              Explore the ecosystem
            </Link>
          </div>
        </div>

        {SECTIONS.map((section) => (
          <div className="footer-col" key={section.title}>
            <h4>{section.title}</h4>
            <ul>
              {section.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="wrap footer-bottom">
        <div className="footer-legal">
          <a href="/login">Login</a>
          <span>·</span>
          <Link to="/resources">Privacy</Link>
          <span>·</span>
          <Link to="/resources">Terms</Link>
          <span>·</span>
          <span>© {year} onePOS. All rights reserved.</span>
        </div>
        <p className="footer-disclaimer">
          WhatsApp, Uber Eats, Deliveroo, Just Eat, Shopify, Microsoft, Android and Apple are trademarks
          of their respective owners. They appear here only to identify compatibility; onePOS is not
          affiliated with, endorsed by or sponsored by any of them.
        </p>
      </div>
    </footer>
  );
}