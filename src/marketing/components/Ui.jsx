import React from "react";
import { Link } from "react-router-dom";
import {
  Package,
  Truck,
  Users,
  Building2,
  UserCog,
  Calculator,
  Plug,
  ShoppingBag,
  CreditCard,
  BarChart3,
  Printer,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { BrandIcon, WindowsIcon } from "./BrandIcons";

/* ------------------------------------------------------------------ */
/* Icon name -> component map (used by data-driven cards)             */
/* ------------------------------------------------------------------ */

const LUCIDE_MAP = {
  package: Package,
  truck: Truck,
  users: Users,
  building: Building2,
  "user-cog": UserCog,
  calculator: Calculator,
  plug: Plug,
  "shopping-bag": ShoppingBag,
  "credit-card": CreditCard,
  "bar-chart-3": BarChart3,
  printer: Printer,
  "shield-check": ShieldCheck,
};

export function Icon({ name, size = 20, className }) {
  if (name === "windows") return <span className={`brand-icon ${className || ""}`}><WindowsIcon /></span>;
  const Lucide = LUCIDE_MAP[name];
  if (Lucide) return <Lucide size={size} className={className} />;
  const brand = ["whatsapp", "uber-eats", "deliveroo", "just-eat", "shopify", "android", "apple"].includes(name);
  if (brand) return <span className={`brand-icon ${className || ""}`}><BrandIcon name={name} /></span>;
  return null;
}

/* ------------------------------------------------------------------ */
/* onePOS brand mark                                                   */
/* ------------------------------------------------------------------ */

export function BrandMark({ dark = false }) {
  return (
    <span className={`brand-mark ${dark ? "brand-mark--dark" : ""}`} aria-hidden="true">
      <i></i>
      <i></i>
      <i></i>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export function Btn({ to, href, variant = "primary", size = "md", children, className = "" }) {
  const cls = `btn btn-${variant} btn-${size} ${className}`.trim();
  const inner = (
    <>
      {children}
      <ArrowRight size={15} className="btn-arrow" aria-hidden="true" />
    </>
  );
  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Section helpers                                                     */
/* ------------------------------------------------------------------ */

export function Eyebrow({ children, dark = false }) {
  return <p className={`eyebrow ${dark ? "eyebrow--dark" : ""}`}>{children}</p>;
}

export function SectionHead({ eyebrow, title, lead, center = false, dark = false, id }) {
  return (
    <div className={`section-head ${center ? "section-head--center" : ""} ${dark ? "section-head--dark" : ""}`}>
      {eyebrow && <Eyebrow dark={dark}>{eyebrow}</Eyebrow>}
      <h2 id={id}>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page hero (interior pages)                                          */
/* ------------------------------------------------------------------ */

export function PageHero({ crumbs = [], eyebrow, title, lead, children }) {
  return (
    <section className="page-hero">
      <div className="wrap">
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((crumb, i) => (
              <span key={i} className="crumb">
                {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span>{crumb.label}</span>}
                {i < crumbs.length - 1 && <span className="crumb-sep" aria-hidden="true">/</span>}
              </span>
            ))}
          </nav>
        )}
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1>{title}</h1>
        {lead && <p className="page-hero-lead">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Small atoms                                                         */
/* ------------------------------------------------------------------ */

export function Chip({ children }) {
  return <span className="chip">{children}</span>;
}

export function CheckItem({ children, dark = false }) {
  return (
    <li className={`check-item ${dark ? "check-item--dark" : ""}`}>
      <span className="check-tick" aria-hidden="true">
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 6.5 4.5 9 10 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {children}
    </li>
  );
}

export function CheckList({ items, dark = false, className = "" }) {
  return (
    <ul className={`check-list ${className}`}>
      {items.map((item, i) => (
        <CheckItem key={i} dark={dark}>
          {item}
        </CheckItem>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Call to action band                                                 */
/* ------------------------------------------------------------------ */

export function CTASection({
  title = "Put the whole business on one system",
  lead = "Log in to your onePOS workspace, or explore the platform to see what the till, inventory, purchasing and reports can do together.",
  primary = { label: "Log in to onePOS", to: "/login" },
  secondary = { label: "Explore onePOS", to: "/pos" },
}) {
  return (
    <section className="cta-band">
      <div className="wrap cta-wrap">
        <div className="cta-copy">
          <h2>{title}</h2>
          <p>{lead}</p>
        </div>
        <div className="cta-actions">
          <Btn to={primary.to} variant="primary">{primary.label}</Btn>
          <Btn to={secondary.to} variant="ghost-light">{secondary.label}</Btn>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Compatibility strip (third-party brands as "works with")            */
/* ------------------------------------------------------------------ */

export function CompatibilityStrip({ items, dark = false }) {
  return (
    <div className={`compat ${dark ? "compat--dark" : ""}`}>
      {items.map((item, i) => (
        <span className="compat-item" key={i}>
          <span className="compat-icon">
            <Icon name={item.icon} />
          </span>
          <span className="compat-label">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Browser frame for product visuals                                   */
/* ------------------------------------------------------------------ */

export function BrowserFrame({ url = "app.onepos.example", children, className = "", caption }) {
  return (
    <figure className={`browser ${className}`}>
      <div className="browser-bar">
        <span className="browser-dots" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span className="browser-url">{url}</span>
      </div>
      <div className="browser-body">{children}</div>
      {caption && <figcaption className="visual-caption">{caption}</figcaption>}
    </figure>
  );
}