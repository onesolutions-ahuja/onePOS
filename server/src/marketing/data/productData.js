/**
 * canonical feature data for the onePOS marketing site.
 *
 * Written against the actual repository: routes/*.js, database/schema.sql,
 * src/pages/* and src/services/*. Where the platform vision extends beyond
 * today's implementation, wording stays general ("built around", "channel
 * strategy") instead of claiming verified third-party integrations.
 */

const productData = {
  inventory: {
    title: "Inventory",
    category: "Inventory & Stock",
    tagline: "Know what you have, where it is, and what to reorder.",
    summary:
      "A single product catalogue with live stock levels, a full movement ledger, low-stock visibility, adjustments and reconciliation — updated automatically by every sale, purchase, return and online order.",
    icon: "package",
    highlight:
      "Every sale, purchase, return and online order writes a dated stock movement, so the current balance always has a traceable history behind it.",
    features: [
      "Product catalogue with name, SKU and barcode",
      "Price, VAT rate and cost price per product",
      "Stock level and low-stock threshold per product",
      "Per-product 'track stock' control",
      "Stock movement ledger (sale, purchase, return, adjustment…)",
      "Stock adjustments with quantity and reason",
      "Reconciliation view: system stock vs ledger balance",
      "Low-stock visibility across the catalogue",
      "Movement history grouped by product and store",
      "Movement types for online orders (reserve / release)",
      "Opening stock setup for new products",
      "CSV export of stock data",
    ],
    benefits: [
      { title: "Live balances", description: "Stock moves the moment a transaction happens at the till, a purchase is received, or an online order completes." },
      { title: "Traceable history", description: "Every quantity change is a dated ledger entry with a reference, user and reason." },
      { title: "Reorder with confidence", description: "Low-stock thresholds and valuation data show you what to order next." },
    ],
    related: [
      { to: "/purchasing", label: "Purchasing", note: "Receiving stock creates PURCHASE ledger movements" },
      { to: "/pos", label: "POS & Till", note: "Sales reduce stock automatically" },
      { to: "/reports", label: "Reports", note: "Inventory movements report" },
    ],
  },
  purchasing: {
    title: "Purchasing",
    category: "Purchasing & Suppliers",
    tagline: "Order, receive and track what comes into the business.",
    summary:
      "Purchase orders with supplier, store, date and status, plus a receiving workflow that turns goods in into stock on the shelf — with cost prices, line totals and generated inventory movements all in one place.",
    icon: "truck",
    highlight:
      "Receiving stock creates PURCHASE ledger movements automatically, so the stock balance and the books stay in step.",
    features: [
      "Purchase orders per store and supplier",
      "Purchase status tracking (pending / received)",
      "Add purchase with line items (product, SKU, quantity, unit cost)",
      "Goods receiving workflow",
      "Generated inventory movements shown per purchase",
      "Supplier management with contact details",
      "Purchase history and totals",
      "Purchase import with column mapping and preview",
      "CSV export of purchase data",
    ],
    benefits: [
      { title: "One receiving flow", description: "Add the order, receive the goods, and stock updates in the same step." },
      { title: "Cost control", description: "Unit cost, line totals and stock valuation stay visible against each order." },
      { title: "Supplier clarity", description: "Every order is tied to a supplier and a store for clean history." },
    ],
    related: [
      { to: "/inventory", label: "Inventory", note: "Receiving writes movement history" },
      { to: "/suppliers", label: "Suppliers", note: "Supplier records feed purchase orders" },
      { to: "/reports", label: "Reports", note: "Profit & margin reporting" },
    ],
  },
  customers: {
    title: "Customers",
    category: "Customers",
    tagline: "Customer records connected to the till.",
    summary:
      "Keep customer profiles with contact details and loyalty numbers, associate them with sales at the till, and track their purchase history per store — from walk-in checkout to repeat customers.",
    icon: "users",
    highlight:
      "A customer can be attached to any sale at the till, so purchase history builds up naturally as people shop with you.",
    features: [
      "Customer profiles (name, email, phone, address)",
      "Loyalty number support",
      "Notes per customer",
      "Active / inactive customer control",
      "Customer-store association with last purchase date",
      "Customer search and filtering",
      "Attach customer at the till (walk-in by default)",
      "Customer spend and returns reporting",
    ],
    benefits: [
      { title: "Context at the counter", description: "Attach the right customer to a sale in two taps." },
      { title: "History that builds itself", description: "Purchase activity accumulates per store as you serve people." },
      { title: "Better reporting", description: "Understand customer spend and returns across the business." },
    ],
    related: [
      { to: "/pos", label: "POS & Till", note: "Customer association at checkout" },
      { to: "/reports", label: "Reports", note: "Customer spend report" },
      { to: "/whatsapp", label: "WhatsApp", note: "Invoice delivery to customers" },
    ],
  },
  suppliers: {
    title: "Suppliers",
    category: "Purchasing",
    tagline: "The people the business buys from, in one list.",
    summary:
      "Supplier records with contact details feed directly into purchase orders, so ordering, receiving and history all reference the same supplier entries.",
    icon: "building",
    highlight: "Supplier records are the backbone of purchasing — every order you raise is tied to one.",
    features: [
      "Supplier records with business and contact details",
      "Active / inactive supplier control",
      "Supplier search",
      "Purchase orders linked to suppliers",
      "Purchase history per supplier",
    ],
    benefits: [
      { title: "Cleaner purchasing", description: "Ordering always references an existing supplier record." },
      { title: "History in one place", description: "See what you buy and from whom, over time." },
    ],
    related: [
      { to: "/purchasing", label: "Purchasing", note: "Orders, receiving and stock updates" },
      { to: "/inventory", label: "Inventory", note: "Stock raised by received goods" },
    ],
  },
  employees: {
    title: "Employees & Permissions",
    category: "People",
    tagline: "The right access for every person in the business.",
    summary:
      "User accounts tied to roles and granular permissions, scoped to a company and a store. From owner to cashier, everyone gets exactly the access their job needs — and every action can be audited.",
    icon: "user-cog",
    highlight:
      "Permissions cover the till, cash, products, inventory, customers, reports, users, roles, payments, integration management and online orders.",
    features: [
      "User accounts with name, username, email and PIN",
      "Roles with descriptions and system-role flags",
      "Granular permission codes per role",
      "Company and store scope on every account",
      "Active user control and last-login tracking",
      "Permission areas: sales, discounts, voids and refunds",
      "Cash and till permissions (drawer, payout, open/close)",
      "Product, inventory and customer permissions",
      "Report viewing and export permissions",
      "User, role, payment and settings management permissions",
      "Integration and online-orders configuration permissions",
      "Audit log of actions across the business",
    ],
    benefits: [
      { title: "Least-privilege by design", description: "Set up a cashier, a manager and an owner role — each with its own permission set." },
      { title: "Store-aware access", description: "Users are attached to stores, so access stays local where it should be." },
      { title: "Accountability", description: "Discounts, refunds, voids and adjustments sit behind permissions, with audit trails." },
    ],
    related: [
      { to: "/multi-store", label: "Multi-store", note: "Company and store separation" },
      { to: "/security", label: "Security & Control", note: "Roles, permissions and audit" },
      { to: "/pos", label: "POS & Till", note: "Till actions behind permissions" },
    ],
  },
};

export default productData;