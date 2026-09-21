#!/usr/bin/env node
// fix_login.cjs
const fs = require("fs");

// Fix Login.jsx
let content = fs.readFileSync("src/pages/auth/Login.jsx", "utf8");

// Fix 1: sessionMsg -> sessionMessage
content = content.replace(/sessionMsg/g, "sessionMessage");

// Fix 2: Remove the malformed duplicate Self-Checkout block
const brokenBlock =
  "\n\n                        {/* Customer-facing Self-Checkout entry (dedicated device) */}\n\n            {/* Customer-facing Self-Checkout entry (dedicated device) */}";
content = content.replace(brokenBlock, "\n\n            {/* Customer-facing Self-Checkout entry (dedicated device) */}");

fs.writeFileSync("src/pages/auth/Login.jsx", content);
console.log("Login.jsx fixed");

// Fix adminRoutes.js - remove indented duplicate Email Delivery
let routes = fs.readFileSync("src/utils/adminRoutes.js", "utf8");
routes = routes.replace(/    "Email Delivery": "email-delivery",\n/, "");
fs.writeFileSync("src/utils/adminRoutes.js", routes);
console.log("adminRoutes.js fixed");

