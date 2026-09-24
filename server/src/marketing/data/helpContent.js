export const HELP_CATEGORIES = [
  {
    slug: "getting-started",
    label: "Getting Started",
    eyebrow: "Start with confidence",
    title: "Your first week with onePOS",
    description: "Short, practical guides for getting a store ready and helping every team member find their way around.",
    icon: "rocket",
  },
  {
    slug: "tutorials",
    label: "Tutorials",
    eyebrow: "Learn by doing",
    title: "Step-by-step till and store tasks",
    description: "Follow a task from start to finish, with simple instructions written for busy shop teams.",
    icon: "book-open",
  },
  {
    slug: "troubleshooting",
    label: "Troubleshooting",
    eyebrow: "Fix common issues",
    title: "Get the till moving again",
    description: "Practical checks for login, connectivity, hardware, payments, syncing, stock and permissions.",
    icon: "life-buoy",
  },
  {
    slug: "training",
    label: "Staff Training",
    eyebrow: "Train your team",
    title: "Role-based learning paths",
    description: "A calm first-day checklist for till operators, managers and administrators.",
    icon: "graduation-cap",
  },
  {
    slug: "product-guides",
    label: "Product Guides",
    eyebrow: "Understand the workspace",
    title: "Guides to the onePOS platform",
    description: "Reference material for products, stock, customers, reports, permissions and multi-store work.",
    icon: "layers",
  },
  {
    slug: "visual-guides",
    label: "Screenshots & Visual Guides",
    eyebrow: "See the steps",
    title: "Visual guides for your setup",
    description: "Screenshot-ready articles with numbered steps and captions. Real product images can be added when available.",
    icon: "image",
  },
];

const gettingStarted = [
  {
    slug: "first-day-onepos-checklist",
    title: "First-day onePOS checklist",
    summary: "A simple order for getting a new till operator comfortable before the first busy shift.",
    category: "getting-started",
    readTime: "5 min",
    tags: ["new staff", "training"],
    sections: [
      { heading: "Before the first customer", steps: ["Confirm the operator has their own login and the correct store access.", "Check the till device is charged or plugged in and can reach the onePOS sign-in page.", "Have a test product, a training payment method and the store's refund process ready."] },
      { heading: "Practise the essentials", steps: ["Log in and identify the current store and till.", "Make a practice sale, try holding it, then resume and complete it.", "Practise cash and card workflows using your store's approved process.", "Ask the operator to explain what they would do if the internet or printer stopped working."] },
      { heading: "Finish the handover", steps: ["Show where to find Help & Support and how to report an issue.", "Review who can approve discounts, refunds and cash actions.", "Complete the first shift with the end-of-day checklist and a manager check."] },
    ],
    related: ["creating-a-sale", "holding-and-resuming-a-sale", "till-and-day-end"],
  },
];

const tutorials = [
  {
    slug: "creating-a-sale",
    title: "Creating a sale",
    summary: "Add products, check the basket and complete a sale without slowing down the queue.",
    category: "tutorials", readTime: "3 min", tags: ["sales", "till"],
    screenshot: "Sale screen showing the basket and payment action",
    sections: [
      { heading: "Add the products", steps: ["Find a product using the search or scan its barcode if a scanner is connected.", "Check the product name, quantity and price in the basket.", "Add a customer only when your store needs the sale linked to their account."] },
      { heading: "Check and complete", steps: ["Review the basket with the customer before taking payment.", "Choose the payment method and follow the prompts for that method.", "Wait for the sale confirmation before handing over the receipt or goods."] },
      { heading: "If something looks wrong", body: "Do not guess at a price or tax setting. Pause the sale and ask a manager to check the product record or permission required for a price change." },
    ],
    related: ["taking-different-payment-methods", "applying-a-discount", "processing-a-refund"],
  },
  {
    slug: "holding-and-resuming-a-sale",
    title: "Holding and resuming a sale",
    summary: "Put a basket aside when a customer needs time, then bring it back without starting again.",
    category: "tutorials", readTime: "2 min", tags: ["sales", "held sales"],
    sections: [
      { heading: "Hold the current basket", steps: ["Check the basket is the correct customer's items.", "Choose the hold action and confirm the basket is saved.", "Tell the customer how you will identify the held sale, if your store uses a reference or name."] },
      { heading: "Resume it", steps: ["Open held sales from the till actions.", "Match the reference, customer or basket details before selecting it.", "Review the basket again, then continue to payment."] },
    ],
    related: ["creating-a-sale", "taking-different-payment-methods"],
  },
  {
    slug: "taking-different-payment-methods",
    title: "Taking different payment methods",
    summary: "Keep cash, card and other enabled methods clear at the point of payment.",
    category: "tutorials", readTime: "4 min", tags: ["payments", "cash", "card"],
    sections: [
      { heading: "Choose the method", steps: ["Confirm the final sale total with the customer.", "Choose the payment method that matches how the customer is paying.", "For a card terminal, follow the terminal prompts and wait for approval before completing the sale."] },
      { heading: "Cash payments", steps: ["Enter the amount received and count the change back to the customer.", "Leave the sale complete only after the till shows the correct change or balance."] },
      { heading: "Split or unusual payments", body: "Only use split or alternative payment options that are enabled for your store. If the terminal and onePOS show different results, stop and follow the payment troubleshooting guide rather than taking a second payment." },
    ],
    related: ["payment-or-card-machine-problems", "till-and-day-end"],
  },
  {
    slug: "applying-a-discount",
    title: "Applying a discount",
    summary: "Apply an approved discount and make sure the customer and receipt show the right total.",
    category: "tutorials", readTime: "2 min", tags: ["discounts", "permissions"],
    sections: [
      { heading: "Apply the approved discount", steps: ["Add the products and confirm which item or basket the discount applies to.", "Choose the discount action and select the approved rule or enter the permitted value.", "Check the new total and the discount line before taking payment."] },
      { heading: "If the option is unavailable", body: "Discounts may be restricted by role or store policy. Ask the manager with the appropriate permission instead of sharing a login." },
    ],
    related: ["creating-a-sale", "user-and-permission-problems"],
  },
  {
    slug: "processing-a-refund",
    title: "Processing a refund or return",
    summary: "Use your store policy and the original sale details to handle a return safely.",
    category: "tutorials", readTime: "4 min", tags: ["returns", "refunds"],
    sections: [
      { heading: "Check the return", steps: ["Confirm the item, quantity and reason for return against your store policy.", "Find the original sale where your setup supports it, and check the payment method.", "Ask a manager to approve the return if your role requires approval."] },
      { heading: "Complete the return", steps: ["Select the return or refund action and review the negative lines before confirming.", "Use the approved refund method and wait for the confirmation.", "Keep the returned item and stock decision with the store's normal process."] },
      { heading: "Escalate when needed", body: "Never take a second card payment or promise a refund when the original payment cannot be found. Record the details and ask the manager or support contact to investigate." },
    ],
    related: ["user-and-permission-problems", "stock-discrepancies"],
  },
  {
    slug: "managing-products-and-stock",
    title: "Managing products and stock",
    summary: "Keep product details useful at the till and make stock changes traceable.",
    category: "product-guides", readTime: "5 min", tags: ["products", "stock"],
    sections: [
      { heading: "Update a product", steps: ["Open the product area and search by name or barcode.", "Update only the fields your role and store process allow, then review the saved value.", "Test the product at the till after a barcode, price or availability change."] },
      { heading: "Record a stock change", steps: ["Choose the correct store and product.", "Use the appropriate movement, receipt or adjustment reason rather than changing a number without context.", "Add a note when the reason will help the next person reconcile the stock."] },
    ],
    related: ["stock-discrepancies", "stock-transfers-between-stores", "sales-not-syncing"],
  },
  {
    slug: "stock-transfers-between-stores",
    title: "Stock transfers between stores",
    summary: "Move stock between locations with a clear sending and receiving handover.",
    category: "product-guides", readTime: "4 min", tags: ["stock", "multi-store"],
    sections: [
      { heading: "Create the transfer", steps: ["Select the sending and receiving stores.", "Add each product and quantity, then check the transfer summary.", "Save or submit the transfer using the status available in your setup."] },
      { heading: "Complete the handover", steps: ["Pack and label the goods with the transfer reference.", "The receiving store counts the delivery before marking it received.", "Investigate differences immediately so both store records stay explainable."] },
    ],
    related: ["managing-products-and-stock", "stock-discrepancies"],
  },
  {
    slug: "managing-customers",
    title: "Managing customers",
    summary: "Find or add a customer when it helps with receipts, returns or your store relationship.",
    category: "product-guides", readTime: "3 min", tags: ["customers"],
    sections: [
      { heading: "Find a customer", steps: ["Search using the detail your store is permitted to use.", "Check the result carefully before linking it to a sale.", "Update details only when the customer has confirmed the change."] },
      { heading: "Add a customer to a sale", steps: ["Open the customer selector from the sale.", "Choose the correct customer and confirm the sale summary.", "Follow your store's privacy and receipt process."] },
    ],
    related: ["creating-a-sale", "processing-a-refund"],
  },
  {
    slug: "reports-and-till-day-end",
    title: "Reports and till/day-end procedures",
    summary: "Close a shift with a consistent count, review and handover routine.",
    category: "product-guides", readTime: "5 min", tags: ["reports", "cash", "end of day"],
    sections: [
      { heading: "Before closing the till", steps: ["Finish or clearly hand over every open basket.", "Check card, cash and other payment totals against the shift information available to you.", "Print or export the reports your store policy requires."] },
      { heading: "Count and hand over", steps: ["Count cash away from the customer queue and have a second person verify where required.", "Record differences; do not silently change a total to make it match.", "Complete the close or handover action available in your setup."] },
    ],
    related: ["taking-different-payment-methods", "sales-not-syncing", "user-and-permission-problems"],
  },
  {
    slug: "user-and-permission-management",
    title: "User and permission management",
    summary: "Give each person their own access and keep sensitive actions with the right roles.",
    category: "product-guides", readTime: "4 min", tags: ["users", "permissions", "security"],
    sections: [
      { heading: "Add or update access", steps: ["Open user management as an authorised administrator.", "Give the person their own account and the correct company/store scope.", "Choose only the permissions needed for their role, then save and ask them to sign in."] },
      { heading: "Keep access safe", steps: ["Never share a manager or administrator login.", "Remove or change access when someone leaves or changes role.", "Use the troubleshooting guide if a legitimate user cannot see an action."] },
    ],
    related: ["user-and-permission-problems", "first-day-onepos-checklist"],
  },
];

const troubleshooting = [
  ["login-problems", "Login problems", "Check the email, password, browser and store access before asking for a reset."],
  ["internet-or-offline-mode", "Internet or offline mode", "Know what to check when the connection drops and what to do while work is queued."],
  ["till-connection-problems", "Till connection problems", "A calm checklist for a till that cannot reach the onePOS workspace."],
  ["printer-problems", "Printer problems", "Check power, the selected printer and whether the device can print outside onePOS."],
  ["scanner-problems", "Scanner problems", "Check the scanner connection and barcode input without changing product data."],
  ["payment-or-card-machine-problems", "Payment or card-machine issues", "Avoid duplicate payments and record what the terminal says."],
  ["sales-not-syncing", "Sales not syncing", "Check the connection and queue status before retrying a sale."],
  ["stock-discrepancies", "Stock discrepancies", "Trace the movement before making an adjustment."],
  ["user-and-permission-problems", "User or permission problems", "Confirm store scope and ask an authorised administrator to help."],
].map(([slug, title, summary]) => ({
  slug, title, summary, category: "troubleshooting", readTime: "3 min", tags: ["troubleshooting"],
  sections: [
    { heading: "Start with the safe checks", steps: ["Write down the time, till/store and what the screen says.", "Do not repeat a payment or delete a sale while you are diagnosing the issue.", "Check the relevant cable, power, browser connection or account detail."] },
    { heading: "Try one change at a time", steps: ["Refresh or reconnect only after noting any unsaved work.", "Retry the smallest safe action and check whether the status changes.", "If the issue affects other tills or stores, tell the manager before continuing."] },
    { heading: "If this does not solve the problem", body: "Escalate through your store's support route with the store, till, time, affected sale or product, exact message and steps already tried. A screenshot of the message is useful; never include a password or full card number." },
  ],
  related: ["first-day-onepos-checklist", "reports-and-till-day-end"],
}));

const training = [
  {
    slug: "new-till-operator-learning-path",
    title: "New till operator learning path",
    summary: "A practical first-day path from signing in to closing a shift.",
    category: "training", readTime: "10 min", tags: ["training", "till operator"],
    sections: [
      { heading: "Learn in this order", steps: ["Sign in and identify the right store and till.", "Start a shift using your store's normal opening process.", "Create a sale, take cash and card payments, and explain the receipt.", "Hold and resume a sale, then practise a refund with a manager.", "Find a product, understand a stock message and report a discrepancy.", "Complete the till/day-end handover checklist."] },
      { heading: "Ready-to-work check", body: "The operator should be able to describe what they would do when the internet, printer, scanner or card machine fails. They should also know which actions need a manager and where to find Help & Support." },
    ],
    related: ["creating-a-sale", "holding-and-resuming-a-sale", "taking-different-payment-methods", "processing-a-refund", "reports-and-till-day-end"],
  },
  {
    slug: "store-manager-learning-path",
    title: "Store manager learning path",
    summary: "Build confidence around approvals, stock control, reports and team support.",
    category: "training", readTime: "10 min", tags: ["training", "manager"],
    sections: [
      { heading: "Manager checklist", steps: ["Review users, store access and approval permissions.", "Practise discounts, refunds, stock adjustments and transfer handovers.", "Review sales, payment and inventory reports for a normal trading day.", "Walk through the troubleshooting escalation details your support contact needs.", "Coach a till operator through opening, a busy queue and day-end."] },
    ],
    related: ["user-and-permission-management", "stock-transfers-between-stores", "reports-and-till-day-end"],
  },
  {
    slug: "administrator-learning-path",
    title: "Administrator learning paths",
    summary: "A reference checklist for administrators responsible for access and setup.",
    category: "training", readTime: "8 min", tags: ["training", "administrator"],
    sections: [
      { heading: "Administrator checklist", steps: ["Confirm the company and store structure reflects the real business.", "Create named users and review role permissions.", "Check products, prices, stock locations and reporting access.", "Document the approved hardware, payment and support contacts for each store.", "Review access when staff or responsibilities change."] },
    ],
    related: ["user-and-permission-management", "managing-products-and-stock"],
  },
];

export const HELP_ARTICLES = [...gettingStarted, ...tutorials, ...troubleshooting, ...training];
export const HELP_ARTICLES_BY_SLUG = Object.fromEntries(HELP_ARTICLES.map((article) => [article.slug, article]));

export function getCategory(slug) {
  return HELP_CATEGORIES.find((category) => category.slug === slug);
}

export function getArticlesForCategory(slug) {
  return HELP_ARTICLES.filter((article) => article.category === slug);
}
