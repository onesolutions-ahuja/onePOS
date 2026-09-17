import React from "react";
import { Link } from "react-router-dom";
import {
  ShoppingCart,
  Package,
  Truck,
  Users,
  UserCog,
  Store,
  ShoppingBag,
  MessageCircle,
  BarChart3,
  Calculator,
  WifiOff,
  Printer,
  ArrowRight,
  ShieldCheck,
  Zap,
  Layers,
  PieChart,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { Btn, Eyebrow, SectionHead, CheckList, CTASection, CompatibilityStrip, BrowserFrame } from "../components/Ui";
import { BrandIcon } from "../components/BrandIcons";
import { DashboardScreen, WhatsAppScreen } from "../components/AppMockups";

const FEATURES = [
  { icon: ShoppingCart, to: "/pos", title: "POS & Till", blurb: "Barcode-first checkout with basket, discounts, payments, receipts and customer association." },
  { icon: Package, to: "/inventory", title: "Inventory", blurb: "Live stock levels, low-stock visibility and a dated movement ledger behind every balance." },
  { icon: Truck, to: "/purchasing", title: "Purchasing & Suppliers", blurb: "Purchase orders, goods receiving and cost control — receiving updates stock automatically." },
  { icon: Users, to: "/customers", title: "Customers", blurb: "Profiles, loyalty numbers and purchase history that builds itself at the till." },
  { icon: UserCog, to: "/employees", title: "Employees & Permissions", blurb: "Roles and granular permissions covering the till, cash, stock, reports and settings." },
  { icon: Store, to: "/multi-store", title: "Multi-store", blurb: "One company, many stores — store-scoped users, terminals and consolidated reports." },
  { icon: ShoppingBag, to: "/online-orders", title: "Online Orders", blurb: "Delivery orders arrive in one workflow — item mapping, prep and a POS sale on completion." },
  { icon: MessageCircle, to: "/whatsapp", title: "WhatsApp invoicing", blurb: "Secure invoice links and PDF invoices delivered to customers over WhatsApp." },
  { icon: BarChart3, to: "/reports", title: "Reports", blurb: "Sales, payments, top products, profit & margin, till & cash, VAT and inventory reports." },
  { icon: Calculator, to: "/integrations", title: "Accounting & API", blurb: "Provider-agnostic integrations with encrypted credentials, field mapping and API logs." },
  { icon: WifiOff, to: "/platforms", title: "Offline & connectivity", blurb: "Offline storage and a sync queue keep the counter usable when the internet blinks." },
  { icon: Printer, to: "/hardware", title: "Hardware", blurb: "Scanners, receipt printers, cash drawers and touchscreens — where the connection supports them." },
];

const PLATFORM_CHIPS = [
  { icon: "windows", label: "Windows" },
  { icon: "android", label: "Android" },
  { icon: "apple", label: "iPad" },
  { icon: "web", label: "Web Browser", glyph: true },
];

export default function HomePage() {
  usePageMeta({
    title: "onePOS | Complete retail management, POS and business platform",
    description:
      "onePOS connects your till, inventory, purchasing, customers and online channels in one platform. Modern POS and business management for retail — on Windows, Android, iPad and any browser.",
  });

  return (
    <div className="home-page">
      {/* ================= HERO ================= */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <Eyebrow>Complete retail management platform</Eyebrow>
            <h1 className="hero-title">
              The till. The stockroom. <span className="hero-accent">Every store.</span> One platform.
            </h1>
            <p className="hero-lead">
              onePOS brings point of sale, inventory, purchasing, customers, suppliers, reports and
              online orders into one workspace — from a single counter to a multi-store business.
            </p>
            <div className="hero-actions">
              <Btn to="/login" variant="primary" size="lg">Log in to onePOS</Btn>
              <Btn to="/pos" variant="secondary" size="lg">Explore onePOS</Btn>
            </div>
            <div className="hero-chips">
              <span className="chip"><Zap size={13} /> Point of Sale</span>
              <span className="chip"><Package size={13} /> Inventory & Purchasing</span>
              <span className="chip"><Store size={13} /> Multi-store</span>
              <span className="chip"><ShoppingBag size={13} /> Online Orders</span>
              <span className="chip"><MessageCircle size={13} /> WhatsApp invoicing</span>
              <span className="chip"><BarChart3 size={13} /> Reports</span>
            </div>
          </div>

          <div className="hero-visual">
            <BrowserFrame url="app.onepos.example" caption="The onePOS dashboard — sales, transactions and quick actions in one view.">
              <DashboardScreen />
            </BrowserFrame>
            <div className="hero-float hero-float--1">
              <span className="float-icon"><MessageCircle size={15} /></span>
              <div>
                <b>Invoice delivered</b>
                <small>£5.19 via WhatsApp · secure link</small>
              </div>
            </div>
            <div className="hero-float hero-float--2">
              <span className="float-icon float-icon--dark"><ShoppingBag size={15} /></span>
              <div>
                <b>New Uber Eats order</b>
                <small>ORD-U-88412 · Preparing</small>
              </div>
            </div>
            <div className="hero-float hero-float--3">
              <span className="float-icon float-icon--amber"><Package size={15} /></span>
              <div>
                <b>Low stock</b>
                <small>Crisps · 0 left · reorder</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= COMPATIBILITY ================= */}
      <section className="compat-band">
        <div className="wrap">
          <div className="compat-band-line">
            <span className="compat-band-label">OnePOS runs in any modern browser — on the hardware you already run:</span>
            <CompatibilityStrip
              items={[
                { icon: "windows", label: "Windows" },
                { icon: "android", label: "Android" },
                { icon: "apple", label: "iPad / iOS" },
                { icon: "web", label: "Web Browser" },
                { icon: "whatsapp", label: "WhatsApp" },
                { icon: "uber-eats", label: "Uber Eats" },
                { icon: "deliveroo", label: "Deliveroo" },
                { icon: "just-eat", label: "Just Eat" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* ================= PLATFORM OVERVIEW ================= */}
      <section className="section">
        <div className="wrap">
          <SectionHead
            eyebrow="The platform"
            title="More than a till. The whole business, connected."
            lead="onePOS is a retail management platform: the counter, the stockroom, the supplier desk and the online channels share one system, one product catalogue and one set of numbers."
          />
          <div className="feature-grid">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <Link to={feature.to} className="feature-card" key={feature.title}>
                  <span className="icon-tile"><Icon size={19} /></span>
                  <h3>{feature.title}</h3>
                  <p>{feature.blurb}</p>
                  <span className="feature-link">
                    Explore <ArrowRight size={13} />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================= PILLARS ================= */}
      <section className="section section--soft">
        <div className="wrap">
          <SectionHead
            eyebrow="Built for the realities of retail"
            title="Three things retail never forgives"
            lead="Speed at the counter, honest stock, and one set of books. onePOS is designed around all three."
          />
          <div className="pillar-grid">
            <div className="pillar-card">
              <span className="pillar-icon pillar-icon--teal"><Zap size={20} /></span>
              <h3>Speed at the counter</h3>
              <p>Scan, search or tap a product tile. Discounts, customer association and cash/card/split
                payment are a few taps away — every sale records itself as it happens.</p>
              <CheckList items={["Barcode and search-first checkout", "Discounts, held sales and quick resume", "Receipts and invoice PDFs from every sale"]} />
              <Link to="/pos" className="text-link">See the till experience <ArrowRight size={13} /></Link>
            </div>
            <div className="pillar-card">
              <span className="pillar-icon pillar-icon--blue"><Layers size={20} /></span>
              <h3>Stock that tells the truth</h3>
              <p>Every sale, purchase, return and online order writes a dated movement. Balances have
                history; low stock is visible before it becomes an empty shelf.</p>
              <CheckList items={["Full movement ledger per product", "Low-stock thresholds and alerts", "Reconciliation: system stock vs ledger"]} />
              <Link to="/inventory" className="text-link">See inventory in onePOS <ArrowRight size={13} /></Link>
            </div>
            <div className="pillar-card">
              <span className="pillar-icon pillar-icon--violet"><PieChart size={20} /></span>
              <h3>One set of numbers</h3>
              <p>In-store sales, online orders, purchases and payments land in the same reports — so the
                figures on screen are the figures that run the business.</p>
              <CheckList items={["Sales, payments, profit & margin, VAT", "Till & cash sessions per terminal", "Reports permission-gated and exportable"]} />
              <Link to="/reports" className="text-link">See the reports <ArrowRight size={13} /></Link>
            </div>
          </div>
        </div>
      </section>

      {/* ================= ONLINE ORDERS BAND ================= */}
      <section className="section section--dark">
        <div className="wrap dark-grid">
          <div className="dark-copy">
            <Eyebrow dark>Online orders</Eyebrow>
            <h2 className="dark-title">Delivery orders, in the same workflow as the counter</h2>
            <p className="dark-lead">
              onePOS's online-orders module is built around the Uber Eats and Deliveroo order flow, with
              Just Eat and online commerce sitting in the same channel architecture: orders arrive, items
              map to your products, prep happens in one place, and completing an order creates the POS
              sale and updates stock in the same transaction.
            </p>
            <CheckList
              dark
              items={[
                "Webhook intake with signature verification",
                "Item mapping to your product catalogue",
                "Received → preparing → completed lifecycle",
                "POS sale creation and stock updates on completion",
              ]}
            />
            <div className="dark-actions">
              <Btn to="/online-orders" variant="primary">Explore Online Orders</Btn>
              <Btn to="/integrations" variant="ghost-light">All integrations</Btn>
            </div>
          </div>
          <div className="dark-visual">
            <div className="channel-cards">
              {[
                ["uber-eats", "Uber Eats", "Delivery orders"],
                ["deliveroo", "Deliveroo", "Webhook-first intake"],
                ["just-eat", "Just Eat", "Channel target"],
                ["shopify", "Shopify", "Commerce direction"],
              ].map(([icon, name, sub]) => (
                <Link to={`/integrations/${icon}`} className="channel-card" key={icon}>
                  <span className="channel-brand"><BrandGlyph name={icon} /></span>
                  <span className="channel-name">{name}</span>
                  <span className="channel-sub">{sub}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ================= WHATSAPP TEASER ================= */}
      <section className="section">
        <div className="wrap whatsapp-teaser">
          <div className="teaser-visual">
            <BrowserFrame url="app.onepos.example/whatsapp" caption="WhatsApp settings and the invoice your customer actually receives.">
              <WhatsAppScreen />
            </BrowserFrame>
          </div>
          <div className="teaser-copy">
            <Eyebrow>WhatsApp invoice delivery</Eyebrow>
            <h2>Invoices delivered the way your customers already chat</h2>
            <p>
              Every sale can reach the customer as a secure, tokenised invoice link — or as a PDF — over
              WhatsApp, automatically or on demand, with a test-before-activate workflow built into
              settings.
            </p>
            <ul className="mini-list">
              <li><ShieldCheck size={15} /> Secure tokenised invoice links — no customer login required</li>
              <li><ShieldCheck size={15} /> Link or PDF delivery mode, configured per business</li>
              <li><ShieldCheck size={15} /> Automatic sending, with a delivery log that masks customer numbers</li>
            </ul>
            <div className="teaser-actions">
              <Btn to="/whatsapp" variant="primary">See how WhatsApp invoicing works</Btn>
            </div>
          </div>
        </div>
      </section>

      {/* ================= REPORTS STRIP ================= */}
      <section className="section section--soft">
        <div className="wrap">
          <div className="report-strip">
            <div className="report-strip-copy">
              <Eyebrow>Reports</Eyebrow>
              <h2>From daily takings to VAT — the numbers are one click away</h2>
              <p>
                Sales by day, payments by method, top products, profit & margin, till & cash, VAT summary,
                inventory movements and customers. Filter by range and export.
              </p>
              <Btn to="/reports" variant="secondary">See all reports</Btn>
            </div>
            <div className="report-chip-cloud">
              {["Sales by Day", "Payments", "Top Products", "Customers", "Inventory Movements", "Profit & Margin", "Till & Cash", "VAT Summary"].map((r) => (
                <Link to="/reports" className="report-chip" key={r}>{r}</Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <CTASection />
    </div>
  );
}

function BrandGlyph({ name }) {
  return <BrandIcon name={name} />;
}