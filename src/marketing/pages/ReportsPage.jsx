import React from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  Sun,
  BarChart3,
  Wallet,
  Clock,
  Package,
  Users,
  Percent,
  Landmark,
  Download,
  ArrowRight,
  TrendingUp,
  PiggyBank,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection, BrowserFrame } from "../components/Ui";
import { ReportsScreen } from "../components/AppMockups";

const REPORTS = [
  { icon: Sun, title: "Sales by Day", blurb: "Daily sales totals for any selected range — the day, the week, the month." },
  { icon: Wallet, title: "Payments", blurb: "Payments broken down by method: cash, card and split." },
  { icon: Package, title: "Top Products", blurb: "Best-selling products across the range — the stock you should protect." },
  { icon: Users, title: "Customers", blurb: "Customer spend and returns, from walk-in to regular." },
  { icon: Clock, title: "Inventory Movements", blurb: "Recent stock movements with type, quantity and balance." },
  { icon: TrendingUp, title: "Profit & Margin", blurb: "Profit and margin per range, from cost prices through sales." },
  { icon: PiggyBank, title: "Till & Cash", blurb: "Till sessions and cash movements per terminal." },
  { icon: Landmark, title: "VAT Summary", blurb: "VAT collected and reclaimed across the range." },
];

const RANGES = ["Today", "Last 7 days", "Last 30 days", "Custom range"];

export default function ReportsPage() {
  usePageMeta({
    title: "onePOS | Reports — sales, payments, profit, till & cash, VAT",
    description:
      "onePOS reports: sales by day, payments by method, top products, customers, inventory movements, profit & margin, till & cash and VAT summary — filtered by range and exportable.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Reports" }]}
        eyebrow="Reporting & insights"
        title="The numbers that run the business, one click away"
        lead="Sales, payments, products, profit, cash and VAT — each report filters by range, respects permissions, and exports when the accountant asks."
      >
        <div className="page-hero-actions">
          <Btn to="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/inventory" variant="secondary">See Inventory</Btn>
        </div>
      </PageHero>

      <section className="section section--flush">
        <div className="wrap">
          <BrowserFrame url="app.onepos.example/reports" caption="Report tabs, date ranges, summary totals and export — the reports workspace in oneOS.">
            <ReportsScreen />
          </BrowserFrame>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead
            eyebrow="Report library"
            title="Eight reports that cover the business"
            lead="Each report reflects the real onePOS data model — the same sales, stock and cash records the till writes every day."
          />
          <div className="feature-grid feature-grid--4">
            {REPORTS.map((r) => {
              const Icon = r.icon;
              return (
                <div className="feature-card feature-card--static" key={r.title}>
                  <span className="icon-tile"><Icon size={18} /></span>
                  <h3>{r.title}</h3>
                  <p>{r.blurb}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap split-section">
          <div className="split-copy">
            <SectionHead eyebrow="Range & export" title="Filter. Look. Export." />
            <p className="lead">
              Every report picks a range and renders instantly — then exports as CSV when the figures
              need to travel.
            </p>
            <div className="chip-row">
              {RANGES.map((r) => (
                <span className="chip-chip" key={r}>{r}</span>
              ))}
            </div>
            <CheckList
              items={[
                "Range presets and custom dates",
                "CSV export per report",
                "Permission-gated viewing and export",
                "Store-scoped reports on multi-store setups",
              ]}
            />
          </div>
          <div className="split-note">
            <div className="note-card">
              <h4>Who sees what</h4>
              <p>
                Reports follow the permission system: viewing and exporting are separate permissions, so
                a cashier with till access doesn't automatically see profit.
              </p>
              <Link to="/security" className="text-link">Roles & permissions <ArrowRight size={13} /></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap note-band">
          <span className="note-band-icon"><BarChart3 size={20} /></span>
          <div>
            <h3>The dashboard tells today's story</h3>
            <p>
              Open the workspace and see today's sales, transactions, average sale and online orders at
              a glance — alongside a seven-day sales overview and quick actions.
            </p>
          </div>
        </div>
      </section>

      <CTASection
        title="See your numbers on one screen"
        lead="Log in to onePOS for the dashboard and the full report library — sales, stock, cash and VAT together."
      />
    </div>
  );
}