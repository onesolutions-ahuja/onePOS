import React from "react";
import { Link } from "react-router-dom";
import {
  Truck,
  Building2,
  Receipt,
  PackagePlus,
  Upload,
  CircleDollarSign,
  ArrowRight,
  FileSpreadsheet,
  ClipboardCheck,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection, BrowserFrame } from "../components/Ui";
import { PurchasingScreen } from "../components/AppMockups";

const WORKFLOW = [
  { icon: Building2, step: "01", title: "Choose supplier", detail: "Every order references a supplier record and a store." },
  { icon: Receipt, step: "02", title: "Build the order", detail: "Lines of product, quantity and unit cost with live line totals." },
  { icon: ClipboardCheck, step: "03", title: "Receive goods", detail: "Receiving creates PURCHASE ledger movements automatically." },
  { icon: PackagePlus, step: "04", title: "Stock & books update", detail: "Balances, cost, valuation and history update in one step." },
];

const FEATURES = [
  { icon: Building2, title: "Suppliers", blurb: "Supplier records with contact details, status and purchase history." },
  { icon: Receipt, title: "Purchase orders", blurb: "Reference, supplier, store, date, status and total per order." },
  { icon: PackagePlus, title: "Receiving", blurb: "Turn goods in into stock on the shelf without double entry." },
  { icon: Upload, title: "Purchase import", blurb: "Map supplier columns to product lookup, quantity and unit cost, preview, then import." },
  { icon: CircleDollarSign, title: "Cost & valuation", blurb: "Unit cost and line totals feed profit and margin reporting." },
  { icon: FileSpreadsheet, title: "History & export", blurb: "Everything is searchable and exportable when the accountant asks." },
];

export default function PurchasingPage() {
  usePageMeta({
    title: "onePOS | Purchasing — order, receive and track goods",
    description:
      "onePOS purchasing: purchase orders, supplier management, goods receiving that updates stock automatically, purchase import and cost control.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Purchasing" }]}
        eyebrow="Purchasing & suppliers"
        title="Order it, receive it, stock it — without double entry"
        lead="Purchase orders and goods receiving in the same flow as the stockroom: create the order, receive the goods, and the balances, cost and history all update together."
      >
        <div className="page-hero-actions">
          <Btn to="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/inventory" variant="secondary">See Inventory</Btn>
        </div>
      </PageHero>

      <section className="section section--flush">
        <div className="wrap">
          <BrowserFrame url="app.onepos.example/purchases" caption="Purchase orders with supplier, store, status and total — plus the receive-stock and import workflows.">
            <PurchasingScreen />
          </BrowserFrame>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead eyebrow="Purchasing workflow" title="From supplier to shelf in four steps" />
          <div className="step-row">
            {WORKFLOW.map((item, i) => {
              const Icon = item.icon;
              return (
                <React.Fragment key={item.step}>
                  <div className="step-card">
                    <span className="step-num">{item.step}</span>
                    <span className="icon-tile icon-tile--sm"><Icon size={16} /></span>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </div>
                  {i < WORKFLOW.length - 1 && <span className="step-arrow" aria-hidden="true"><ArrowRight size={18} /></span>}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="Receiving that flows" title="Receiving stock writes the ledger" lead="No separate stock-entry screen after the goods arrive — receiving IS the stock update." />
          <div className="note-band">
            <span className="note-band-icon"><ClipboardCheck size={20} /></span>
            <div>
              <h3>Purchase detail shows its own movements</h3>
              <p>
                Open any purchase and see the generated inventory movements — product, movement type,
                quantity, balance and date — so the trail from order to shelf is visible end to end.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead eyebrow="Purchasing capabilities" title="The workbench behind the order" />
          <div className="feature-grid feature-grid--3">
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

      <section className="section section--soft">
        <div className="wrap split-section split-section--reverse">
          <div className="split-note">
            <div className="note-card">
              <h4>Import without the typing</h4>
              <p>
                Suppliers send spreadsheets; onePOS imports them. Column mapping previews what will
                match before anything touches stock.
              </p>
              <CheckList
                items={[
                  "Map supplier columns to product lookup",
                  "Preview matches before import",
                  "Quantities and unit costs in one pass",
                ]}
              />
            </div>
          </div>
          <div className="split-copy">
            <SectionHead eyebrow="Purchase import" title="Spreadsheets in, stock out" />
            <p className="lead">
              Bring supplier lists of products, quantities and unit costs straight into the receiving
              workflow — with a preview that shows exactly how each row will map before you commit.
            </p>
          </div>
        </div>
      </section>

      <CTASection
        title="Bring purchasing into the same system as the till"
        lead="Log in to onePOS to raise an order or receive stock — or explore inventory and reports to see how cost flows through."
      />
    </div>
  );
}