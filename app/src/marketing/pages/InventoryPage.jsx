import React from "react";
import { Link } from "react-router-dom";
import {
  Package,
  ScanLine,
  Tag,
  Layers,
  AlertTriangle,
  Scale,
  RefreshCw,
  ShoppingBag,
  Download,
  ArrowRight,
  History,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection, BrowserFrame } from "../components/Ui";
import { InventoryScreen } from "../components/AppMockups";

const MOVEMENT_TYPES = [
  ["PURCHASE", "Receiving stock adds quantity and records the supplier-facing detail."],
  ["SALE", "Every till sale reduces stock exactly as sold."],
  ["CUSTOMER_RETURN", "Returned goods go back onto the shelf automatically."],
  ["ADJUSTMENT_IN / OUT", "Counted corrections with quantity and reason."],
  ["ONLINE_RESERVE / RELEASE", "Delivery orders reserve stock; cancellations release it."],
  ["SUPPLIER_RETURN", "Goods sent back to a supplier leave the balance."],
];

const FEATURES = [
  { icon: Layers, title: "Live balances", blurb: "Stock moves the moment a sale, purchase, return or online order happens." },
  { icon: History, title: "Movement ledger", blurb: "Every change is dated with type, quantity, balance after, reference, user and reason." },
  { icon: AlertTriangle, title: "Low-stock visibility", blurb: "Thresholds per product make the reorder list obvious before shelves run dry." },
  { icon: Scale, title: "Reconciliation", blurb: "Compare system stock against the ledger and flag mismatches." },
  { icon: ScanLine, title: "SKU & barcode", blurb: "Products are identifiable by name, SKU and barcode for scanning and lookup." },
  { icon: Tag, title: "Pricing & VAT", blurb: "Price, cost price and VAT rate per product, all feeding reports." },
  { icon: Package, title: "Track-stock control", blurb: "Per-product switch for which items drive quantities." },
  { icon: Download, title: "Export", blurb: "Stock data leaves as CSV when you need it elsewhere." },
];

export default function InventoryPage() {
  usePageMeta({
    title: "onePOS | Inventory — stock control with a full movement ledger",
    description:
      "onePOS inventory: product catalogue, live stock levels, low-stock thresholds, stock adjustments, reconciliation and a dated movement ledger behind every balance.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Inventory" }]}
        eyebrow="Inventory & stock"
        title="Know what you have, where it is, and what to reorder"
        lead="One product catalogue with live balances — and a dated movement ledger behind every number, so stock never becomes a mystery."
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/purchasing" variant="secondary">See Purchasing</Btn>
        </div>
      </PageHero>

      <section className="section section--flush">
        <div className="wrap">
          <BrowserFrame url="app.onepos.example/inventory" caption="The inventory workspace — stock levels, movement history and reconciliation together.">
            <InventoryScreen />
          </BrowserFrame>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead
            eyebrow="How stock stays honest"
            title="Every balance has a history"
            lead="onePOS records each quantity change as a typed movement, so 'current stock' is never just a number — it is the sum of dated, referenced events."
          />
          <div className="movement-grid">
            {MOVEMENT_TYPES.map(([type, detail]) => (
              <div className="movement-card" key={type}>
                <span className="movement-type">{type}</span>
                <p>{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="Inventory capabilities" title="The tools behind the balance" />
          <div className="feature-grid feature-grid--4">
            {FEATURES.map((f) => {
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

      <section className="section">
        <div className="wrap split-section split-section--reverse">
          <div className="split-note">
            <div className="note-card">
              <h4>Reconciliation in practice</h4>
              <p>
                Count the shelf, run reconciliation, and onePOS compares your count against the
                ledger — flagging mismatches and showing the movement history that explains them.
              </p>
              <CheckList
                items={[
                  "System stock vs ledger balance side by side",
                  "Per-product movement drill-down",
                  "Adjust with quantity, reason and permission",
                ]}
              />
              <Link to="/reports" className="text-link">Inventory movements report <ArrowRight size={13} /></Link>
            </div>
          </div>
          <div className="split-copy">
            <SectionHead eyebrow="Reconciliation" title="The shelf and the system, in agreement" />
            <p className="lead">
              Stock counts drift; ledgers don't. Reconciliation shows exactly where the shelf and the
              system disagree — and the movement history explains why, so corrections are informed,
              not guessed.
            </p>
            <div className="pillar-inline">
              <span className="pillar-icon pillar-icon--teal"><RefreshCw size={18} /></span>
              <span className="pillar-icon pillar-icon--blue"><ShoppingBag size={18} /></span>
              <span className="pillar-icon pillar-icon--violet"><Layers size={18} /></span>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap note-band">
          <span className="note-band-icon"><ShoppingBag size={20} /></span>
          <div>
            <h3>Purchasing keeps stock moving</h3>
            <p>
              Receiving stock creates PURCHASE movements, so ordering, receiving and inventory live in
              one flow — from supplier desk to shelf to sale.
            </p>
          </div>
          <Btn to="/purchasing" variant="secondary">See Purchasing</Btn>
        </div>
      </section>

      <CTASection
        title="Put stock control on one system"
        lead="Log in to onePOS to see your products, balances and movements — or explore purchasing, reports and the multi-store view first."
      />
    </div>
  );
}