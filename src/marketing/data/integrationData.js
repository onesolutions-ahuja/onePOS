/**
 * Integration + channel data for the onePOS marketing site.
 *
 * Presentation rule: third-party brands appear ONLY as "works with" /
 * "integration target" references. No partnership, sponsorship or endorsement
 * is implied. Where a channel is part of the onePOS architecture but the live
 * third-party connection is still being wired up, wording stays in product
 * terms ("built around", "channel strategy") rather than claiming live data
 * flows that do not exist yet.
 */

const integrationData = {
  "uber-eats": {
    name: "Uber Eats",
    category: "Delivery platform",
    icon: "uber-eats",
    color: "#06C167",
    route: "/integrations/uber-eats",
    tagline: "Online orders from Uber Eats, routed into your onePOS workflow.",
    summary:
      "onePOS's online-orders module is built around the Uber Eats order flow — platform configuration, webhook intake, item mapping and order progression through to a completed POS sale.",
    features: [
      "Platform configuration stored per company (encrypted credentials)",
      "Sandbox and production environments",
      "Order acceptance: manual or auto (configurable)",
      "Customer OTP requirement on completion (configurable)",
      "Uber order intake with external order ID",
      "Item mapping to your onePOS products",
      "Order progression: received → preparing → completed",
      "Platform-to-POS sale creation when an order completes",
      "Platform API request/response logging",
      "Connection test workflow (Get Stores)",
      "Menu item availability per platform (available on Uber Eats)",
    ],
    workflow: [
      { step: "Receive", detail: "Order details arrive with an external order ID and line items." },
      { step: "Map & prep", detail: "Items resolve against your product catalogue; the order moves to prep." },
      { step: "Complete", detail: "On completion, a POS sale is created and stock is updated in the same transaction." },
    ],
    note:
      "Platform credentials are encrypted at rest and only ever returned to the interface as masked hints.",
  },
  deliveroo: {
    name: "Deliveroo",
    category: "Delivery platform",
    icon: "deliveroo",
    color: "#00CCBC",
    route: "/integrations/deliveroo",
    tagline: "A webhook-first integration built around Deliveroo order events.",
    summary:
      "onePOS's online-orders module includes a Deliveroo webhook flow with HMAC signature verification and sequence-ID de-duplication, so order events land safely and exactly once.",
    features: [
      "Deliveroo webhook endpoint with HMAC verification",
      "Sequence GUID de-duplication (no double orders)",
      "Item mappings saved for future orders",
      "Manual item-to-product mapping (never auto-creates products)",
      "Order lifecycle: received → preparing → completed",
      "POS sale creation on completion",
      "Webhook health endpoint",
      "Platform request/response logging",
      "Sandbox and production environments",
    ],
    workflow: [
      { step: "Verify", detail: "Webhook signature and sequence are checked before anything is stored." },
      { step: "Create", detail: "The order is created idempotently in RECEIVED state; repeated deliveries change nothing." },
      { step: "Complete", detail: "Status progression drives prep; completion creates the POS sale and stock movements." },
    ],
    note:
      "Deliveroo order handling is isolated in dedicated services, keeping platform logic separate from the core till.",
  },
  "just-eat": {
    name: "Just Eat",
    category: "Delivery platform",
    icon: "just-eat",
    color: "#F36F21",
    route: "/integrations/just-eat",
    tagline: "Part of the same online-orders channel architecture.",
    summary:
      "Just Eat sits within onePOS's online-orders channel strategy — the same order lifecycle, item mapping and stock effects the platform applies to its other delivery channels.",
    features: [
      "Online-orders channel framework shared across platforms",
      "Common order lifecycle and prep workflow",
      "Item-to-product mapping approach",
      "Platform configuration per company",
      "Reporting across all online channels",
    ],
    workflow: [
      { step: "Channel setup", detail: "Delivery channels are configured per company with their own environment and credentials." },
      { step: "One workflow", detail: "Orders from any channel flow through the same prep and completion workflow." },
      { step: "Same books", detail: "Stock and sales behave consistently no matter where the order came from." },
    ],
    note:
      "Channel branding is shown for identification only. Just Eat support is presented as part of the onePOS channel strategy, not as a live third-party partnership.",
  },
  shopify: {
    name: "Shopify",
    category: "Online commerce",
    icon: "shopify",
    color: "#96BF47",
    route: "/integrations/shopify",
    tagline: "Online commerce within the onePOS channel direction.",
    summary:
      "Shopify represents the online commerce side of onePOS's channel strategy — the product, inventory and order model is designed to extend to a web storefront alongside delivery platforms.",
    features: [
      "Same product catalogue shared across channels",
      "Inventory effects driven by the same movement ledger",
      "Order handling within the online-orders workflow",
      "Channel configuration per company",
    ],
    workflow: [
      { step: "Catalogue", detail: "Products stay managed in one catalogue for every channel." },
      { step: "Channel", detail: "The online-orders architecture is built to extend to commerce channels." },
      { step: "Unified view", detail: "In-store and online activity land in the same reporting." },
    ],
    note:
      "Shopify branding is shown for identification only, as a target within the onePOS channel strategy.",
  },
  whatsapp: {
    name: "WhatsApp",
    category: "Customer communication",
    icon: "whatsapp",
    color: "#25D366",
    route: "/whatsapp",
    tagline: "Invoices delivered the way your customers already chat.",
    summary:
      "Send invoices to customers over WhatsApp — as a secure tokenised link or as a PDF — automatically or on demand, with a test-before-activate workflow built into settings.",
    features: [
      "Secure tokenised invoice links (/i/:token)",
      "PDF invoice delivery",
      "Link or PDF delivery mode (configurable)",
      "Automatic invoice sending on/off",
      "Invoice message template",
      "Test connection with real credential probe",
      "Preview test invoice (sends nothing)",
      "Send real test invoice to a chosen number",
      "Delivery log with customer numbers masked",
      "Encrypted credentials, masked on screen",
    ],
    workflow: [
      { step: "Connect", detail: "Add your WhatsApp Business credentials and test the connection before activation." },
      { step: "Deliver", detail: "Choose link or PDF mode and let invoices go out automatically — or send on demand." },
      { step: "Verify", detail: "The delivery log records attempts with customer numbers masked." },
    ],
    note:
      "WhatsApp is a trademark of Meta Platforms, Inc. onePOS is not affiliated with or endorsed by Meta. WhatsApp branding identifies the delivery channel only.",
  },
  accounting: {
    name: "Accounting",
    category: "Financial systems",
    icon: "calculator",
    color: "#7c3aed",
    route: "/integrations/accounting",
    routeLabel: "/integrations/accounting",
    tagline: "Financial data structured for your accounting workflow.",
    summary:
      "onePOS's accounting module connects the business data model to external accounting systems — provider configuration, endpoint setup, field mapping and test connections from the same integration foundation.",
    features: [
      "Accounting-style integration workspace",
      "Provider configuration with encrypted credentials",
      "Endpoint configuration for external systems",
      "Field mapping between onePOS data and target fields",
      "Connection testing before activation",
      "API request/response logs",
      "Secure credential storage (encrypted at rest)",
    ],
    workflow: [
      { step: "Configure", detail: "Add your accounting provider and encrypted credentials." },
      { step: "Map", detail: "Map onePOS fields to your target system's fields." },
      { step: "Test & log", detail: "Test the connection and review API logs for every attempt." },
    ],
    note:
      "No sales or purchase data leaves onePOS unless an integration is deliberately configured to send it.",
  },
  api: {
    name: "API & Integrations",
    category: "Developer & connectivity",
    icon: "plug",
    color: "#2563eb",
    route: "/integrations/api",
    tagline: "A provider-agnostic integration foundation.",
    summary:
      "onePOS ships a generic integration framework: name and provider per integration, encrypted credentials, endpoint configuration, field mapping and API logs — built to connect onePOS to the systems your business already uses.",
    features: [
      "Integration records with name and provider",
      "Encrypted credential storage at rest",
      "Endpoint configuration (method, URL, auth)",
      "Field mapping editor (source → target)",
      "Endpoint testing with saved or test credentials",
      "API log with status, duration and errors",
      "Permission-gated management (integration.manage)",
      "Provider-agnostic design — no data sent unless configured",
    ],
    workflow: [
      { step: "Create", detail: "Add an integration with a name and provider." },
      { step: "Configure", detail: "Set the endpoint and encrypted credentials." },
      { step: "Map & test", detail: "Map fields, test the endpoint, and review the log." },
    ],
    note:
      "API keys and secrets are hashed or encrypted before they touch the database and are never returned to the browser.",
  },
};

export default integrationData;