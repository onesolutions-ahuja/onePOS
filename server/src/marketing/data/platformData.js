/**
 * Device / connectivity data for the onePOS marketing site.
 *
 * onePOS today is a browser-based application. It runs on Windows desktop
 * touch terminals, Android tablets, iPad and any modern browser. Peripheral
 * connectivity (scanners, printers, cash drawers) depends on the device and
 * connection setup — this page describes that honestly instead of claiming
 * native drivers or proprietary hardware support it does not have.
 */

const platformData = {
  web: {
    name: "Web Browser",
    tagline: "The core onePOS experience — in any modern browser.",
    summary:
      "onePOS is built as a modern web application running in Chrome, Edge, Firefox and Safari. There is no install step: the till, dashboard and admin areas are the same product, available anywhere a browser can run.",
    features: [
      "No installation — works in any modern browser",
      "The full till, admin and reporting experience",
      "Always current — updates ship centrally",
      "Works on Windows, Android and iPad devices",
      "Responsive layout for touch and mouse",
      "Same account, same data, every device",
    ],
    benefits: [
      { title: "Zero rollout", description: "A URL, a login and the business is live — no per-PC installs." },
      { title: "One product everywhere", description: "The till on the counter and the reports in the office are the same onePOS." },
      { title: "Always in step", description: "Because onePOS is centrally hosted, every screen runs the same version." },
    ],
    devices: ["Desktop", "Laptop", "Touch terminal", "Tablet"],
  },
  windows: {
    name: "Microsoft Windows",
    tagline: "Windows desktop and touchscreen terminals.",
    summary:
      "Run onePOS in a browser on Windows — PC, touchscreen terminal or the traditional till PC. For barcode scanners, receipt printers and cash drawers, connectivity follows the device and connection setup (where a bridge or connector is needed, it is configured at the setup layer rather than pretending the browser owns the USB port).",
    features: [
      "Windows 10 / 11 desktops and touch terminals",
      "Touchscreen-friendly layout at the till",
      "Full keyboard and mouse support",
      "Barcode scanner input via USB/Bluetooth devices",
      "Receipt printing via browser print and device printers",
      "Cash drawer control where the device connection supports it",
    ],
    benefits: [
      { title: "Familiar hardware", description: "Most shops already own a Windows PC worth using as a till." },
      { title: "Big screens", description: "Full-size displays keep the product grid and basket in view." },
    ],
    devices: ["Windows PC", "Windows touch terminal", "All-in-one POS units"],
  },
  android: {
    name: "Android",
    tagline: "Tablet-based checkout on Android.",
    summary:
      "Run onePOS in a browser on Android tablets for a portable, touch-first checkout. Scanners and receipt printers connect per device — Bluetooth/USB peripherals are used where the tablet and connection setup support them, keeping the setup honest about what each device can do.",
    features: [
      "Android tablets (browser-based onePOS)",
      "Touch-first product grid and basket",
      "Portable checkout anywhere in the store",
      "Bluetooth/USB barcode scanners per device support",
      "Receipt printing where the printer connection supports it",
      "Same account, stock and sales as every other device",
    ],
    benefits: [
      { title: "Mobility", description: "Checkout where the customer is — a tablet fits on a counter or in hand." },
      { title: "Modern hardware", description: "Today's tablets are fast, bright and long-lasting." },
    ],
    devices: ["Android tablet", "Android phone (limited use)"],
  },
  ios: {
    name: "Apple iPad",
    tagline: "iPad checkout in Safari.",
    summary:
      "Run onePOS in Safari on iPad for a clean, touch-first POS. iPad hardware is used as-is — no special build required to serve customers from a tablet.",
    features: [
      "iPad via Safari (browser-based onePOS)",
      "Touch-first till layout",
      "Portable or counter-mounted iPad POS",
      "Receipt printing where the printer connection supports it",
      "Same account, stock and sales as every other device",
    ],
    benefits: [
      { title: "Clean hardware", description: "iPad makes a tidy, customer-friendly till surface." },
    ],
    devices: ["iPad", "iPad Air", "iPad Pro"],
  },
  offline: {
    name: "Offline & Connectivity",
    tagline: "Built to tolerate a flaky connection.",
    summary:
      "onePOS keeps essential operational context when connectivity drops: offline storage and a sync queue hold activity locally and push it when the connection returns, with connectivity status surfaced in the app.",
    features: [
      "Offline storage for essential context",
      "Queued activity syncs when the connection returns",
      "Connectivity status indicators in the app",
      "Network-aware behaviour at the till",
      "Designed to keep the counter usable during outages",
    ],
    benefits: [
      { title: "Keep selling", description: "The till keeps working when the internet blinks — sync happens when it recovers." },
    ],
    devices: ["All platforms"],
  },
};

export default platformData;