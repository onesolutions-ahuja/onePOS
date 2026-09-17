/**
 * Industry solution data for the onePOS marketing site.
 *
 * Written against the actual repository feature set. Claims that the codebase
 * does not support (age-verification prompts, electronic scale integration,
 * expiry-date tracking, staff scheduling) have been deliberately excluded.
 */

const industryData = {
  retail: {
    title: "Retail",
    description: "Comprehensive POS and business management for retail operations of all sizes.",
    overview:
      "onePOS gives retail businesses a complete operational platform: point-of-sale transactions, inventory, purchasing, customers and reporting in one system. From the front counter to the stockroom to the supplier desk, the whole business works from the same records.",
    challenges: [
      "Managing inventory across many product categories",
      "Tracking sales performance and customer behaviour",
      "Coordinating staff with different roles and permissions",
      "Handling peak periods efficiently",
      "Keeping stock balances honest across sales and returns",
      "Processing returns and exchanges cleanly",
    ],
    solutions: [
      { title: "Unified sales platform", description: "All sales flow through one till with consistent products, pricing and payment options." },
      { title: "Real-time inventory", description: "Stock updates on every sale, purchase, return and online order, with low-stock visibility." },
      { title: "Staff management", description: "Roles and granular permissions define exactly what each person can do." },
      { title: "Comprehensive reporting", description: "Sales, payments, top products, profit, till & cash and VAT reports in one place." },
    ],
    features: [
      "Fast product scanning and lookup",
      "Cash, card and split payments",
      "Customer association and history",
      "Discounts behind permissions",
      "Returns with automatic stock reversal",
      "Suppliers and purchasing workflow",
      "Online order flow (Uber Eats, Deliveroo)",
      "WhatsApp invoice delivery",
      "CSV export of key reports",
    ],
  },
  convenience: {
    title: "Convenience Stores",
    description: "A fast, reliable POS for high-transaction convenience retail.",
    overview:
      "Convenience stores live on speed and reliability. onePOS is built for high-throughput checkout — scanning, payment and receipt in seconds — with stock and suppliers managed in the same system so the store never loses track of what it sells.",
    challenges: [
      "High transaction volume at peak times",
      "Diverse product categories with varying margins",
      "Stock accuracy across fast-moving lines",
      "Shift-based operation with multiple staff",
      "Processing returns and voids without chaos",
    ],
    solutions: [
      { title: "Fast checkout", description: "Barcode scanning, product search and tile-based checkout designed for queues." },
      { title: "Category-based organisation", description: "Categories keep navigation and reporting manageable across a wide range." },
      { title: "Cash accountability", description: "Till sessions and cash movements give every shift a clean reconciliation." },
      { title: "Supplier workflow", description: "Purchasing and receiving keep the shelves full without double entry." },
    ],
    features: [
      "High-speed barcode scanning",
      "Cash, card and split payments",
      "Till sessions with expected cash",
      "Category-based product organisation",
      "Low-stock visibility",
      "Purchasing and receiving",
      "Shift-friendly permission roles",
      "Reports per day, week and custom ranges",
    ],
  },
  "off-licence": {
    title: "Off-licence",
    description: "Controlled, well-managed retail for licensed goods.",
    overview:
      "Off-licence retail needs tight control over stock, cash and staff. onePOS provides the management layer — precise sales records, controlled discounts and refunds, strong cash accountability and clean purchasing — while leaving the human decisions where they belong.",
    challenges: [
      "High-value stock that needs tight control",
      "Controlled discounts, voids and refunds",
      "Cash-heavy trade needing accurate reconciliation",
      "Seasonal demand swings",
      "Supplier relationships and purchasing",
    ],
    solutions: [
      { title: "Permissioned control", description: "Discounts, voids, refunds and payouts sit behind permissions, so discretion is controlled." },
      { title: "Cash accountability", description: "Till sessions with expected cash make each shift reconcile cleanly." },
      { title: "Inventory control", description: "High-value lines tracked with live balances, movements and low-stock visibility." },
      { title: "Supplier workflow", description: "Purchasing, receiving and cost tracking keep margins visible." },
    ],
    features: [
      "Permissioned discounts, voids and refunds",
      "Till sessions and cash difference reporting",
      "Live stock balances and movements",
      "Low-stock thresholds",
      "Supplier and purchase records",
      "Profit & margin reports",
      "VAT summary",
      "Customer association for regulars",
    ],
  },
  grocery: {
    title: "Grocery",
    description: "Robust catalogues, fast checkout and dependable stock for grocery retail.",
    overview:
      "Grocery stores carry thousands of lines, busy counters and constant receiving. onePOS manages large product catalogues with search and categories, keeps stock honest through movement history, and ties purchasing and receiving into the same records as sales.",
    challenges: [
      "Large product catalogues with thousands of lines",
      "Fast-moving stock on tight margins",
      "Perishable lines needing rotation discipline",
      "Frequent supplier receiving",
      "High-volume transaction processing",
    ],
    solutions: [
      { title: "Large catalogue management", description: "Efficient search and categories keep thousands of products manageable." },
      { title: "Movement-led inventory", description: "Every sale and delivery is a dated movement — balances can always be explained." },
      { title: "Receiving workflow", description: "Purchases, receiving and PURCHASE movements in one flow keep shelf and ledger in step." },
      { title: "High-volume checkout", description: "Scan-first checkout with cash, card and split payments keeps queues moving." },
    ],
    features: [
      "Large catalogue with search and categories",
      "SKU and barcode products",
      "Movement ledger with references",
      "Low-stock visibility",
      "Purchasing and receiving",
      "Cash, card and split payments",
      "Sales-by-day and top-products reports",
      "CSV export",
    ],
  },
  "multi-store-retail": {
    title: "Multi-store Retail",
    description: "Central visibility across stores, without losing local control.",
    overview:
      "Multi-store retail needs one system that respects every location. onePOS's company/store/terminal model gives owners consolidated reporting and company-scoped permissions, while each store keeps its own users, terminals, sales and stock activity.",
    challenges: [
      "Comparing performance across locations fairly",
      "Controlling access per store and per role",
      "Keeping stock activity attributable to a location",
      "Consistent products and pricing control",
      "One set of books for the whole company",
    ],
    solutions: [
      { title: "Company · store · terminal", description: "A hierarchy where every record belongs to the right level." },
      { title: "Store-scoped users", description: "Cashiers see their store; owners see the company." },
      { title: "Multi-location records", description: "Sales, sessions, movements and reports are store-attributable." },
      { title: "Consolidated reporting", description: "Company-wide numbers alongside per-store detail." },
    ],
    features: [
      "Company and store hierarchy",
      "Store-scoped users and terminals",
      "Roles and granular permissions",
      "Store-attributable sales and movements",
      "Consolidated reports",
      "Per-store till sessions",
      "Central product catalogue",
      "Audit trail for key actions",
    ],
  },
};

export default industryData;