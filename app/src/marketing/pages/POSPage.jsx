import React from "react";
import { Link } from "react-router-dom";
import {
  Zap,
  ScanLine,
  ShoppingCart,
  Tag,
  CreditCard,
  Receipt,
  UserRound,
  PauseCircle,
  Wallet,
  Undo2,
  Hand,
  Printer,
  Touchpad,
  ArrowRight,
  CircleDollarSign,
  Banknote,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection, BrowserFrame } from "../components/Ui";
import { PosScreen } from "../components/AppMockups";

const CAPABILITIES = [
  { icon: Zap, title: "Fast checkout", blurb: "Scan a barcode, search, or tap a product tile — items land in the basket instantly." },
  { icon: ScanLine, title: "Barcode scanning", blurb: "Products carry barcodes so scanners speed up the busiest queues." },
  { icon: ShoppingCart, title: "Basket & totals", blurb: "Subtotal, VAT and total update live; quantities and lines adjust in place." },
  { icon: Tag, title: "Discounts", blurb: "Percentage or amount discounts at line or sale level, behind permissions." },
  { icon: CreditCard, title: "Payments", blurb: "Cash with automatic change, card, or split payment — recorded per sale." },
  { icon: Receipt, title: "Receipts & invoices", blurb: "Receipt on screen, printable receipt, and PDF invoice per sale." },
  { icon: UserRound, title: "Customer association", blurb: "Attach any sale to a customer (walk-in by default) for history and invoicing." },
  { icon: PauseCircle, title: "Hold & resume", blurb: "Hold a sale for later and resume it — useful for complex or multi-part transactions." },
  { icon: Wallet, title: "Till sessions", blurb: "Open/close per terminal with opening cash, expected cash and cash difference." },
  { icon: Undo2, title: "Returns", blurb: "Customer returns and refunds with permissions and automatic stock reversal." },
  { icon: Hand, title: "Cash control", blurb: "Drawer open, payouts and cash adjustments — each action permission-gated." },
  { icon: Printer, title: "Hardware", blurb: "Receipt printers, scanners, cash drawers and touchscreens where the connection supports them." },
];

const WORKFLOW = [
  { step: "01", title: "Scan or search", detail: "Barcode scanner, search field or category tiles build the basket." },
  { step: "02", title: "Tune the sale", detail: "Discounts, quantities, customer association — before payment." },
  { step: "03", title: "Take payment", detail: "Cash (with change), card, or split — in one payment screen." },
  { step: "04", title: "Done — instantly recorded", detail: "Receipt, invoice PDF, stock movement and report all happen together." },
];

const PAYMENTS = [
  { icon: Banknote, title: "Cash", blurb: "Enter cash received; change is calculated automatically." },
  { icon: CreditCard, title: "Card", blurb: "One tap to record a card payment on the sale." },
  { icon: CircleDollarSign, title: "Split payment", blurb: "Pay one sale with more than one method, when it matters." },
];

export default function POSPage() {
  usePageMeta({
    title: "onePOS | POS & Till — fast checkout for retail",
    description:
      "onePOS point of sale: barcode scanning, basket, discounts, cash/card/split payments, receipts, invoice PDFs, customer association, till sessions and returns.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "POS & Till" }]}
        eyebrow="Point of sale"
        title="A till built for the pace of retail"
        lead="Scan, sell, repeat. onePOS turns the counter into a fast, accurate checkout — with the payments, receipts, stock and reports handled automatically in the background."
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/inventory" variant="secondary">See Inventory</Btn>
        </div>
      </PageHero>

      {/* Visual */}
      <section className="section section--flush">
        <div className="wrap">
          <BrowserFrame url="app.onepos.example/pos" caption="The onePOS till — categories on the left, products in the middle, live basket on the right.">
            <PosScreen />
          </BrowserFrame>
        </div>
      </section>

      {/* Capabilities */}
      <section className="section">
        <div className="wrap">
          <SectionHead
            eyebrow="Till capabilities"
            title="Everything the counter needs, in one screen"
            lead="Designed for touch and keyboard alike, the till keeps scanning, basket and payment visible together."
          />
          <div className="feature-grid feature-grid--4">
            {CAPABILITIES.map((cap) => {
              const Icon = cap.icon;
              return (
                <div className="feature-card feature-card--static" key={cap.title}>
                  <span className="icon-tile"><Icon size={18} /></span>
                  <h3>{cap.title}</h3>
                  <p>{cap.blurb}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="Sale workflow" title="From scan to receipt in seconds" />
          <div className="step-row">
            {WORKFLOW.map((item, i) => (
              <React.Fragment key={item.step}>
                <div className="step-card">
                  <span className="step-num">{item.step}</span>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                </div>
                {i < WORKFLOW.length - 1 && <span className="step-arrow" aria-hidden="true"><ArrowRight size={18} /></span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* Payments */}
      <section className="section">
        <div className="wrap split-section">
          <div className="split-copy">
            <SectionHead eyebrow="Payments" title="Cash, card or split — one payment screen" />
            <p className="lead">
              The payment screen keeps it simple: pick the method, enter what you received, and onePOS
              works out the change. Every payment is recorded against the sale for the till report.
            </p>
            <div className="mini-cards">
              {PAYMENTS.map((p) => {
                const Icon = p.icon;
                return (
                  <div className="mini-card" key={p.title}>
                    <span className="icon-tile icon-tile--sm"><Icon size={16} /></span>
                    <div>
                      <h4>{p.title}</h4>
                      <p>{p.blurb}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="split-note">
            <div className="note-card">
              <h4>Cash accountability</h4>
              <CheckList
                items={[
                  "Open a session per terminal with opening cash",
                  "Expected cash calculated from cash sales",
                  "Cash difference shown at close",
                  "Cash movements (payouts, adjustments) recorded",
                ]}
              />
              <Link to="/reports" className="text-link">Till & cash report <ArrowRight size={13} /></Link>
            </div>
          </div>
        </div>
      </section>

      {/* Hardware note */}
      <section className="section section--soft">
        <div className="wrap note-band">
          <span className="note-band-icon"><Touchpad size={20} /></span>
          <div>
            <h3>Works with the equipment you already own</h3>
            <p>
              onePOS is browser-based, so it runs on Windows touch terminals, Android tablets and iPads.
              Barcode scanners, receipt printers and cash drawers connect through the device and connection
              setup — where a bridge or connector is needed, it belongs to that setup layer.
            </p>
          </div>
          <Btn to="/hardware" variant="secondary">Hardware guide</Btn>
        </div>
      </section>

      <CTASection
        title="See the till on your own screen"
        lead="Log in to onePOS to run a sale — or explore inventory, purchasing and reports to see the platform behind the counter."
      />
    </div>
  );
}