import React from "react";
import {
  LayoutDashboard,
  FileText,
  RefreshCw,
  Package,
  Tag,
  Receipt,
  Users,
  Grid3X3,
  Store,
  CreditCard,
  ShoppingBag,
  Plug,
  Calculator,
  BarChart3,
  Search,
  X,
  Plus,
  Download,
  Bell,
  Check,
  Send,
  MapPin,
  User2,
  ArrowRight,
  CircleDollarSign,
  Printer,
  QrCode,
  ScanLine,
  HardDrive,
  Settings2,
  ShieldCheck,
  ChevronDown,
  Play,
  Boxes,
  Wrench,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* App chrome primitives (mirror the real onePOS admin shell)          */
/* ------------------------------------------------------------------ */

const SIDEBAR_ITEMS = [
  ["Dashboard", LayoutDashboard],
  ["Sales", FileText],
  ["Returns", RefreshCw],
  ["Products", Package],
  ["Categories", Tag],
  ["Purchases", Receipt],
  ["Suppliers", Users],
  ["Inventory", Grid3X3],
  ["Customers", Users],
  ["Employees", Users],
  ["Stores", Store],
  ["Payments", CreditCard],
  ["Order Prep", ShoppingBag],
  ["Integrations", Plug],
  ["Accounting", Calculator],
  ["Reports", BarChart3],
];

export function AppShell({ children, active = "Dashboard", store = "London Store", slim = false, url }) {
  return (
    <div className={`app-shell ${slim ? "app-shell--slim" : ""}`}>
      <aside className="app-side">
        <div className="app-side-brand">
          <span className="app-side-logo" aria-hidden="true">
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span>onePOS</span>
        </div>
        <nav className="app-side-nav" aria-hidden="true">
          {SIDEBAR_ITEMS.map(([name, Icon]) => (
            <span key={name} className={`app-side-item ${name === active ? "is-active" : ""}`}>
              <Icon size={13} />
              <span className="app-side-label">{name}</span>
            </span>
          ))}
        </nav>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div>
            <div className="app-topbar-title">{active}</div>
            <div className="app-topbar-sub">{store}</div>
          </div>
          <div className="app-topbar-actions">
            <span className="app-search" aria-hidden="true">
              <Search size={12} />
              <span>Search…</span>
            </span>
            <Bell size={14} className="app-topbar-icon" />
            <span className="app-avatar">JD</span>
          </div>
        </header>
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}

function Row({ cells }) {
  return (
    <div className="w-row">
      {cells.map((cell, i) => (
        <div className={`w-cell ${cell.className || ""}`} key={i}>
          {cell.content}
        </div>
      ))}
    </div>
  );
}

function Badge({ tone = "green", children }) {
  return <span className={`w-badge w-badge--${tone}`}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export function DashboardScreen({ caption }) {
  const stats = [
    ["Today's Sales", "£2,847.62", "+12%"],
    ["Transactions", "142", "+8%"],
    ["Average Sale", "£20.05", "—"],
    ["Online Orders", "8", "3 new"],
  ];
  const days = [
    ["Mon", 34], ["Tue", 48], ["Wed", 40], ["Thu", 55], ["Fri", 72], ["Sat", 88], ["Sun", 63],
  ];
  const max = 88;
  return (
    <AppShell active="Dashboard" url={null}>
      <div className="mock-heading">
        <div>
          <div className="mock-title">Dashboard</div>
          <div className="mock-sub">Today's activity for the current store.</div>
        </div>
      </div>
      <div className="w-stat-grid">
        {stats.map(([label, value, delta]) => (
          <div className="w-card w-stat" key={label}>
            <div className="w-stat-label">{label}</div>
            <div className="w-stat-value">{value}</div>
            <div className="w-stat-delta">{delta}</div>
          </div>
        ))}
      </div>
      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card-title">Sales Overview · Last 7 days</div>
          <div className="w-chart">
            {days.map(([day, h]) => (
              <div className="w-chart-col" key={day}>
                <div className="w-chart-bar" style={{ height: `${(h / max) * 100}%` }}></div>
                <span className="w-chart-day">{day}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="w-card">
          <div className="w-card-title">Quick Actions</div>
          <div className="w-actions">
            <span className="w-action"><Package size={14} /> Add Product</span>
            <span className="w-action"><Users size={14} /> Add Customer</span>
            <span className="w-action"><Receipt size={14} /> Receive Stock</span>
            <span className="w-action"><BarChart3 size={14} /> View Reports</span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* POS / Till                                                          */
/* ------------------------------------------------------------------ */

export function PosScreen({ caption }) {
  const categories = ["All Products", "Beverages", "Snacks", "Groceries", "Chilled", "Frozen", "Household"];
  const grid = [
    ["Cola 500ml", "£1.25"], ["Still Water 1L", "£0.90"], ["Crisps", "£0.85"],
    ["Milk 2L", "£1.45"], ["Bread Loaf", "£1.10"], ["Eggs x6", "£1.65"],
    ["Coffee 200g", "£3.20"], ["Tea Bags x80", "£2.10"], ["Rice 1kg", "£1.30"],
  ];
  return (
    <div className="pos-shell">
      <div className="pos-head">
        <span className="pos-logo"><i></i><i></i><i></i></span>
        <span className="pos-store">London Store</span>
        <span className="pos-terminal">Till 2</span>
        <span className="pos-user"><User2 size={11} /> J. Demo</span>
        <span className="pos-session"><span className="live-dot"></span>Session open</span>
      </div>
      <div className="pos-body">
        <aside className="pos-cats">
          {categories.map((c, i) => (
            <span className={`pos-cat ${i === 0 ? "is-active" : ""}`} key={c}>{c}</span>
          ))}
        </aside>
        <div className="pos-grid">
          <span className="pos-search"><Search size={12} /> Search products or scan barcode…</span>
          <div className="pos-tiles">
            {grid.map(([name, price]) => (
              <span className="pos-tile" key={name}>
                <span className="pos-tile-art"><Package size={16} /></span>
                <span className="pos-tile-name">{name}</span>
                <span className="pos-tile-price">{price}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="pos-cart">
          <div className="pos-cart-title">Current Sale</div>
          <div className="pos-line"><span>Cola 500ml × 2</span><b>£2.50</b></div>
          <div className="pos-line"><span>Crisps × 1</span><b>£0.85</b></div>
          <div className="pos-line"><span>Bread Loaf × 1</span><b>£1.10</b></div>
          <div className="pos-cart-totals">
            <div className="pos-line"><span>Subtotal</span><b>£4.45</b></div>
            <div className="pos-line"><span>VAT (20%)</span><b>£0.74</b></div>
            <div className="pos-total"><span>Total</span><b>£5.19</b></div>
          </div>
          <div className="pos-cart-actions">
            <span className="pos-btn-ghost">Hold</span>
            <span className="pos-btn-ghost">Discount</span>
            <span className="pos-btn-pay">Pay £5.19</span>
          </div>
          <div className="pos-customer">Customer: <b>Walk-in Customer</b></div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export function InventoryScreen({ caption }) {
  const rows = [
    ["Cola 500ml", "COLA500", "Beverages", "24", "20", "ok"],
    ["Milk 2L", "MILK2L", "Chilled", "6", "12", "low"],
    ["Crisps", "CRISP40", "Snacks", "0", "25", "out"],
    ["Coffee 200g", "COFF200", "Groceries", "31", "15", "ok"],
  ];
  return (
    <AppShell active="Inventory">
      <div className="mock-heading">
        <div>
          <div className="mock-title">Inventory</div>
          <div className="mock-sub">Stock levels and movement history.</div>
        </div>
      </div>
      <Row cells={[
        { content: <div className="mock-sub">Movement History</div>, className: "w-cell-title" },
        { content: <span className="w-chip">Adjust Stock</span>, className: "w-cell-right" },
      ]} />
      <div className="w-table">
        <Row cells={["Product", "SKU", "Category", "Stock", "Low Level", "Status"].map((h) => ({ content: h, className: "w-th" }))} />
        {rows.map(([name, sku, cat, stock, low, tone]) => (
          <Row key={sku} cells={[
            { content: <b>{name}</b> },
            { content: sku },
            { content: cat },
            { content: stock },
            { content: low },
            { content: <Badge tone={tone}>{tone === "ok" ? "Healthy" : tone === "low" ? "Low stock" : "Out of stock"}</Badge> },
          ]} />
        ))}
      </div>
      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card-title">Movement ledger</div>
          <div className="w-movement">
            <div className="pos-line"><span>PURCHASE · Milk 2L</span><b>+24</b></div>
            <div className="pos-line"><span>SALE · Cola 500ml</span><b>−2</b></div>
            <div className="pos-line"><span>ADJUSTMENT_OUT · Crisps</span><b>−5</b></div>
            <div className="pos-line"><span>ONLINE_RESERVE · Coffee</span><b>−1</b></div>
          </div>
        </div>
        <div className="w-card">
          <div className="w-card-title">Reconciliation</div>
          <div className="w-recon">
            <span className="w-recon-ok"><Check size={12} /> Stock balance matches ledger</span>
            <div className="pos-line"><span>Current stock</span><b>61</b></div>
            <div className="pos-line"><span>Ledger balance</span><b>61</b></div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* Purchasing                                                          */
/* ------------------------------------------------------------------ */

export function PurchasingScreen({ caption }) {
  const rows = [
    ["PO-2026-0184", "FreshCo Wholesale", "London Store", "17 Sep 2026", "Received", "£486.20"],
    ["PO-2026-0183", "CityVend Ltd", "London Store", "15 Sep 2026", "Received", "£1,204.10"],
    ["PO-2026-0182", "FreshCo Wholesale", "London Store", "12 Sep 2026", "Pending", "£318.75"],
  ];
  return (
    <AppShell active="Purchases">
      <div className="mock-heading">
        <div>
          <div className="mock-title">Purchases</div>
          <div className="mock-sub">Orders, receiving and generated stock movements.</div>
        </div>
        <span className="w-chip w-chip--primary"><Plus size={12} /> Add Purchase / Receive Stock</span>
      </div>
      <div className="w-table">
        <Row cells={["Reference", "Supplier", "Store", "Purchase date", "Status", "Total"].map((h) => ({ content: h, className: "w-th" }))} />
        {rows.map(([ref, sup, store, date, status, total]) => (
          <Row key={ref} cells={[
            { content: <b>{ref}</b> },
            { content: sup },
            { content: store },
            { content: date },
            { content: <Badge tone={status === "Received" ? "green" : "amber"}>{status}</Badge> },
            { content: <b>{total}</b> },
          ]} />
        ))}
      </div>
      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card-title">Receive stock</div>
          <div className="w-form">
            <label className="pos-line"><span>Product</span><span className="w-input">Select product…</span></label>
            <label className="pos-line"><span>Quantity</span><span className="w-input w-input-sm">12</span></label>
            <label className="pos-line"><span>Unit cost</span><span className="w-input w-input-sm">£1.05</span></label>
            <div className="w-note">Receiving stock creates <b>PURCHASE</b> ledger movements.</div>
          </div>
        </div>
        <div className="w-card">
          <div className="w-card-title">Purchase import</div>
          <div className="w-import">
            <span className="w-import-icon"><Boxes size={16} /></span>
            <div className="mock-sub">Drop a CSV or spreadsheet of products, quantities and unit costs</div>
            <span className="w-chip w-chip--primary"><UploadGlyph /> Choose file</span>
          </div>
          <div className="w-note">Columns are mapped to product lookup, quantity and unit cost before import.</div>
        </div>
      </div>
    </AppShell>
  );
}

function UploadGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 10V3M5 5.5 8 2.5l3 3M3 10.5v2h10v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Multi-store / business management                                   */
/* ------------------------------------------------------------------ */

export function MultiStoreScreen({ caption }) {
  const stores = [
    ["London Store", "High Street, London", "£2,847", "142", "24", "ok"],
    ["Manchester Store", "Market Square, Manchester", "£1,920", "97", "18", "ok"],
    ["Birmingham Store", "Corner Parade, Birmingham", "£1,348", "71", "31", "low"],
  ];
  return (
    <AppShell active="Stores">
      <div className="mock-heading">
        <div>
          <div className="mock-title">Stores</div>
          <div className="mock-sub">Spire Retail Group · 3 stores</div>
        </div>
        <span className="w-chip w-chip--primary"><Plus size={12} /> Add store</span>
      </div>
      <div className="w-store-grid">
        {stores.map(([name, addr, sales, txns, stock, tone]) => (
          <div className="w-card w-store" key={name}>
            <div className="w-store-head">
              <span className="w-store-icon"><Store size={15} /></span>
              <div>
                <div className="w-store-name">{name}</div>
                <div className="w-store-addr">{addr}</div>
              </div>
              <Badge tone={tone}>{tone === "ok" ? "Live" : "Low stock"}</Badge>
            </div>
            <div className="w-store-stats">
              <div><span className="w-store-num">{sales}</span><span className="w-store-lbl">Today's sales</span></div>
              <div><span className="w-store-num">{txns}</span><span className="w-store-lbl">Transactions</span></div>
              <div><span className="w-store-num">{stock}</span><span className="w-store-lbl">Low-stock items</span></div>
            </div>
          </div>
        ))}
      </div>
      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card-title">Roles & permissions</div>
          <div className="w-role"><span><ShieldCheck size={13} /> Administrator</span><span className="w-perms">All permissions</span></div>
          <div className="w-role"><span><User2 size={13} /> Store Manager</span><span className="w-perms">Sales, products, inventory, reports</span></div>
          <div className="w-role"><span><User2 size={13} /> Cashier</span><span className="w-perms">sale.create · cash.open_drawer</span></div>
        </div>
        <div className="w-card">
          <div className="w-card-title">Company view</div>
          <div className="w-note">One company, many stores. Users, roles, products and reports are scoped by company and store — central visibility without giving everyone access to everything.</div>
          <div className="w-kpi"><span><BarChart3 size={13} /> Consolidated reports</span><b>3 stores</b></div>
          <div className="w-kpi"><span><Users size={13} /> Staff accounts</span><b>9</b></div>
        </div>
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* Online orders                                                       */
/* ------------------------------------------------------------------ */

export function OnlineOrdersScreen({ caption }) {
  const orders = [
    ["ORD-U-88412", "uber-eats", "J. Patel", "2 × Cola 500ml · 1 × Crisps", "£4.35", "Preparing", "amber"],
    ["ORD-D-33107", "deliveroo", "M. Okafor", "1 × Coffee 200g · 1 × Milk 2L", "£5.10", "Received", "blue"],
    ["ORD-U-88409", "uber-eats", "S. Ahmed", "3 × Still Water 1L", "£2.70", "Ready", "green"],
  ];
  return (
    <AppShell active="Order Prep">
      <div className="mock-heading">
        <div>
          <div className="mock-title">Online orders</div>
          <div className="mock-sub">Uber Eats · Deliveroo — one workflow, one stock ledger.</div>
        </div>
        <span className="w-chip w-chip--primary"><Settings2 size={12} /> Platform settings</span>
      </div>
      <div className="w-tabs">
        <span className="w-tab is-active">All</span>
        <span className="w-tab">Uber Eats</span>
        <span className="w-tab">Deliveroo</span>
        <span className="w-tab">Completed</span>
      </div>
      <div className="w-order-list">
        {orders.map(([id, platform, name, items, total, status, tone]) => (
          <div className="w-card w-order" key={id}>
            <div className="w-order-head">
              <span className={`w-order-platform w-order-platform--${platform}`}>
                {platform === "uber-eats" ? "Uber Eats" : "Deliveroo"}
              </span>
              <b>{id}</b>
              <Badge tone={tone}>{status}</Badge>
            </div>
            <div className="w-order-body">
              <span className="w-order-customer"><User2 size={12} /> {name}</span>
              <span className="w-order-items">{items}</span>
              <b className="w-order-total">{total}</b>
            </div>
            <div className="w-order-actions">
              <span className="w-chip">Map items</span>
              <span className="w-chip w-chip--primary">Prepare</span>
            </div>
          </div>
        ))}
      </div>
      <div className="w-note">Item mapping links platform items to your products; completing an order creates the POS sale and updates stock in the same transaction.</div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* WhatsApp                                                            */
/* ------------------------------------------------------------------ */

export function WhatsAppScreen({ caption }) {
  return (
    <div className="wa-grid">
      <AppShell active="WhatsApp Settings" slim>
        <div className="mock-heading">
          <div>
            <div className="mock-title">WhatsApp invoice delivery</div>
            <div className="mock-sub">Secure links and PDF invoices — test before you activate.</div>
          </div>
        </div>
        <div className="w-card">
          <div className="w-card-title">Connection</div>
          <div className="w-form">
            <label className="pos-line"><span>Phone Number ID</span><span className="w-input">123456789012345</span></label>
            <label className="pos-line"><span>Access token</span><span className="w-input w-input-mask">••••9f2k</span></label>
            <label className="pos-line"><span>Webhook verify token</span><span className="w-input w-input-mask">••••7q3n</span></label>
            <label className="pos-line"><span>Delivery mode</span><span className="w-seg"><b>Link</b><i>PDF</i></span></label>
            <label className="pos-line"><span>Auto-send invoices</span><span className="w-toggle is-on"><i></i></span></label>
          </div>
          <div className="w-actions">
            <span className="w-chip w-chip--primary"><Play size={11} /> Test Connection</span>
            <span className="w-chip">Save & Activate</span>
          </div>
        </div>
        <div className="w-card">
          <div className="w-card-title">Send test invoice</div>
          <div className="w-form">
            <label className="pos-line"><span>Sale</span><span className="w-input">Select a sale…</span></label>
            <label className="pos-line"><span>Recipient number</span><span className="w-input">+44 7••• ••• 219</span></label>
          </div>
          <div className="w-note">Preview builds the exact message and sends nothing. Real test send delivers to the number you enter; delivery log masks customer numbers.</div>
        </div>
      </AppShell>

      <div className="phone" aria-label="WhatsApp chat mockup">
        <div className="phone-bar">
          <span className="phone-brand"><span className="phone-wa" /></span>
          <span className="phone-title">onePOS Invoices</span>
          <span className="phone-status">online</span>
        </div>
        <div className="phone-chat">
          <div className="phone-bubble phone-bubble--in">
            <div className="phone-bubble-title">Invoice #1042 — £5.19</div>
            <div className="phone-bubble-line">Cola 500ml × 2 · £2.50</div>
            <div className="phone-bubble-line">Crisps × 1 · £0.85</div>
            <div className="phone-bubble-line">Bread Loaf × 1 · £1.10</div>
            <div className="phone-bubble-total">Total (incl. VAT) · £5.19</div>
            <span className="phone-bubble-cta"><Download size={11} /> View invoice</span>
            <div className="phone-bubble-link">onepos.inv/t/9k2f7q31</div>
            <div className="phone-bubble-meta">Secure invoice link · expires in 30 days</div>
          </div>
          <div className="phone-bubble phone-bubble--in">
            <div className="phone-bubble-title">Invoice #1041 — £12.40 (PDF)</div>
            <span className="phone-pdf"><FilePdfGlyph /> Invoice-1041.pdf · 28 KB</span>
          </div>
          <div className="phone-bubble phone-bubble--out">
            Thanks! 😊
          </div>
        </div>
        <div className="phone-input">
          <span>Message</span>
          <Send size={13} />
        </div>
      </div>
    </div>
  );
}

function FilePdfGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M3 2.5h6l4 4v7h-10v-11z" strokeLinejoin="round" />
      <path d="M9 2.5v4h4" strokeLinejoin="round" />
      <path d="M5.5 9h5M5.5 10.8h5" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Integrations / API & accounting                                     */
/* ------------------------------------------------------------------ */

export function IntegrationsScreen({ caption }) {
  const rows = [
    ["WhatsApp", "whatsapp", "Connected", "green"],
    ["Uber Eats", "uber", "Configured · sandbox", "amber"],
    ["Deliveroo", "deliveroo", "Configured · sandbox", "amber"],
    ["DataForward API", "custom", "Tested · active", "green"],
  ];
  return (
    <AppShell active="Integrations">
      <div className="mock-heading">
        <div>
          <div className="mock-title">Integrations</div>
          <div className="mock-sub">Provider records · encrypted credentials · endpoint configuration.</div>
        </div>
        <span className="w-chip w-chip--primary"><Plus size={12} /> New integration</span>
      </div>
      <div className="w-table">
        <Row cells={["Name", "Provider", "Status", ""].map((h) => ({ content: h, className: "w-th" }))} />
        {rows.map(([name, provider, status, tone]) => (
          <Row key={name} cells={[
            { content: <b>{name}</b> },
            { content: provider },
            { content: <Badge tone={tone}>{status}</Badge> },
            { content: <span className="w-chip">Configure</span>, className: "w-cell-right" },
          ]} />
        ))}
      </div>
      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card-title">Endpoint configuration</div>
          <div className="w-form">
            <label className="pos-line"><span>Method</span><span className="w-seg"><b>POST</b><i>GET</i><i>PUT</i></span></label>
            <label className="pos-line"><span>Target URL</span><span className="w-input">https://api.example.com/v1/sales</span></label>
            <label className="pos-line"><span>Auth</span><span className="w-input">Bearer ••••••••</span></label>
          </div>
          <div className="w-actions"><span className="w-chip w-chip--primary"><Play size={11} /> Test endpoint</span></div>
        </div>
        <div className="w-card">
          <div className="w-card-title">Field mapping</div>
          <div className="w-map">
            <span className="w-map-side"><i>onePOS field</i><b>sale.total</b><b>sale.created_at</b><b>sale.receipt_no</b></span>
            <ArrowRight size={13} className="w-map-arrow" />
            <span className="w-map-side"><i>Target field</i><b>invoice.total</b><b>invoice.date</b><b>invoice.reference</b></span>
          </div>
        </div>
        <div className="w-card w-card--wide">
          <div className="w-card-title">API log</div>
          <div className="w-table w-table--tiny">
            <Row cells={["Time", "Endpoint", "Status", "Duration"].map((h) => ({ content: h, className: "w-th" }))} />
            <Row cells={[{ content: "17 Sep 16:42:11" }, { content: <code>POST /integrations/…/test</code> }, { content: <Badge tone="green">200</Badge> }, { content: "142 ms" }]} />
            <Row cells={[{ content: "17 Sep 15:03:48" }, { content: <code>GET /api/…/exports</code> }, { content: <Badge tone="green">200</Badge> }, { content: "98 ms" }]} />
            <Row cells={[{ content: "17 Sep 14:12:02" }, { content: <code>POST /integrations/…/run</code> }, { content: <Badge tone="red">500</Badge> }, { content: "1.2 s" }]} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export function ReportsScreen({ caption }) {
  const rows = [
    ["17 Sep 2026", "Cash", "£1,842.10", "Received"],
    ["17 Sep 2026", "Card", "£992.35", "Completed"],
    ["17 Sep 2026", "Split", "£13.17", "Completed"],
  ];
  return (
    <AppShell active="Reports">
      <div className="mock-heading">
        <div>
          <div className="mock-title">Reports</div>
          <div className="mock-sub">Daily totals for the selected range.</div>
        </div>
        <span className="w-chip"><Download size={12} /> Export CSV</span>
      </div>
      <div className="w-tabs">
        <span className="w-tab is-active">Sales by Day</span>
        <span className="w-tab">Payments</span>
        <span className="w-tab">Top Products</span>
        <span className="w-tab">Profit & Margin</span>
        <span className="w-tab">Till & Cash</span>
        <span className="w-tab">VAT Summary</span>
      </div>
      <div className="w-date"><span className="w-date-chip is-on">Today</span><span className="w-date-chip">7 days</span><span className="w-date-chip">30 days</span><span className="w-date-chip">Custom</span></div>
      <div className="w-table">
        <Row cells={["Date", "Payment", "Amount", "Status"].map((h) => ({ content: h, className: "w-th" }))} />
        {rows.map(([date, method, amount, status], i) => (
          <Row key={i} cells={[
            { content: date },
            { content: method },
            { content: <b>{amount}</b> },
            { content: <Badge tone="green">{status}</Badge> },
          ]} />
        ))}
      </div>
      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card-title">Summary</div>
          <div className="pos-line"><span>Gross sales</span><b>£2,847.62</b></div>
          <div className="pos-line"><span>VAT collected</span><b>£474.60</b></div>
          <div className="pos-line"><span>Gross profit</span><b>£1,203.11</b></div>
        </div>
        <div className="w-card">
          <div className="w-card-title">Reports available</div>
          <div className="w-kpi"><span><BarChart3 size={13} /> Sales by day</span><b>✓</b></div>
          <div className="w-kpi"><span><CreditCard size={13} /> Payments by method</span><b>✓</b></div>
          <div className="w-kpi"><span><Package size={13} /> Top products</span><b>✓</b></div>
          <div className="w-kpi"><span><Grid3X3 size={13} /> Inventory movements</span><b>✓</b></div>
        </div>
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* Hardware strip (used on hardware + platforms pages)                 */
/* ------------------------------------------------------------------ */

export function HardwareStrip() {
  const items = [
    [ScanLine, "Barcode scanner"],
    [Printer, "Receipt printer"],
    [CircleDollarSign, "Cash drawer"],
    [QrCode, "Touchscreen"],
    [CreditCard, "Card terminal"],
    [HardDrive, "Bridge / connector"],
  ];
  return (
    <div className="hw-strip">
      {items.map(([Icon, label]) => (
        <span className="hw-item" key={label}>
          <span className="hw-icon"><Icon size={18} /></span>
          <span className="hw-label">{label}</span>
        </span>
      ))}
    </div>
  );
}

export default {
  DashboardScreen,
  PosScreen,
  InventoryScreen,
  PurchasingScreen,
  MultiStoreScreen,
  OnlineOrdersScreen,
  WhatsAppScreen,
  IntegrationsScreen,
  ReportsScreen,
  HardwareStrip,
};