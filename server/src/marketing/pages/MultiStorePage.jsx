import React from "react";
import { Link } from "react-router-dom";
import {
  Store,
  MonitorPlay,
  Users,
  ShieldCheck,
  BarChart3,
  ArrowRight,
  Network,
  Building2,
  UserCog,
} from "lucide-react";
import { usePageMeta } from "../utils/meta";
import { PageHero, SectionHead, CheckList, Btn, CTASection, BrowserFrame } from "../components/Ui";
import { MultiStoreScreen } from "../components/AppMockups";

const CAPABILITIES = [
  { icon: Store, title: "Stores", blurb: "Each store is a first-class entity with its own record — name, code, address and status." },
  { icon: MonitorPlay, title: "Terminals", blurb: "Tills are tracked per terminal and store, so sessions belong to a real device." },
  { icon: Users, title: "Store-scoped users", blurb: "Every user belongs to a company and a store — access stays local where it should." },
  { icon: ShieldCheck, title: "Roles & permissions", blurb: "Cashiers, managers and owners each get exactly the permissions their job needs." },
  { icon: BarChart3, title: "Consolidated reports", blurb: "Reports cover the whole company and each store, so performance is comparable." },
  { icon: Network, title: "Company separation", blurb: "Companies are fully separate: one login never reaches another business's data." },
];

export default function MultiStorePage() {
  usePageMeta({
    title: "onePOS | Multi-store management — one company, many stores",
    description:
      "onePOS multi-store management: stores, terminals, store-scoped users, roles and permissions, central visibility and consolidated reporting for retail chains.",
  });

  return (
    <div className="page">
      <PageHero
        crumbs={[{ label: "Home", to: "/" }, { label: "Multi-store" }]}
        eyebrow="Business management"
        title="One company. Many stores. One view."
        lead="onePOS is built around companies, stores and terminals. Owners see the whole business; staff see their store — and everyone works from the same system."
      >
        <div className="page-hero-actions">
          <Btn href="/login" variant="primary">Log in to onePOS</Btn>
          <Btn to="/employees" variant="secondary">See Employees & Permissions</Btn>
        </div>
      </PageHero>

      <section className="section section--flush">
        <div className="wrap">
          <BrowserFrame url="app.onepos.example/stores" caption="Store cards with today's sales, transactions and stock — plus the roles and permissions panel.">
            <MultiStoreScreen />
          </BrowserFrame>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead
            eyebrow="How the business is organised"
            title="Company · Store · Terminal"
            lead="Three levels, one hierarchy — so both a single shop and a chain run on the same model."
          />
          <div className="hierarchy">
            <div className="hier-card hier-card--company">
              <Building2 size={18} />
              <h3>Company</h3>
              <p>The business: its product catalogue, roles, suppliers, customers and reports.</p>
            </div>
            <span className="hier-arrow"><ArrowRight size={16} /></span>
            <div className="hier-card">
              <Store size={18} />
              <h3>Stores</h3>
              <p>Locations with their own records, users, terminals, sales and stock activity.</p>
            </div>
            <span className="hier-arrow"><ArrowRight size={16} /></span>
            <div className="hier-card">
              <MonitorPlay size={18} />
              <h3>Terminals</h3>
              <p>Tills and their sessions — open, transact, close, reconcile.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="wrap">
          <SectionHead eyebrow="Store management" title="What an owner can do from one screen" />
          <div className="feature-grid feature-grid--3">
            {CAPABILITIES.map((f) => {
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
        <div className="wrap split-section">
          <div className="split-copy">
            <SectionHead eyebrow="People across stores" title="Permissions that follow the role, not the person" />
            <p className="lead">
              A cashier's access is defined once by role — then that role is applied per store.
              Discounts, voids, drawer access and reports all sit behind permission codes, so control
              scales with the team.
            </p>
            <CheckList
              items={[
                "Administrator, manager and cashier patterns",
                "Permissions for the till, cash, stock and reports",
                "User and role management behind permissions",
                "Audit log tracks actions across the business",
              ]}
            />
            <Link to="/security" className="text-link">Security & business control <ArrowRight size={13} /></Link>
          </div>
          <div className="split-note">
            <div className="note-card">
              <h4>Why store separation matters</h4>
              <p>
                When users, terminals and sessions are store-scoped, a bad day at one location stays at
                that location — and the company view still shows the whole picture.
              </p>
              <div className="mini-cards">
                <div className="mini-card">
                  <UserCog size={15} />
                  <span>Store manager sees their store's reports, not payroll.</span>
                </div>
                <div className="mini-card">
                  <ShieldCheck size={15} />
                  <span>Owner sees consolidated reports across every store.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CTASection
        title="Run the whole chain on one system"
        lead="Log in to onePOS to see the company view — or explore employees, permissions and security first."
      />
    </div>
  );
}