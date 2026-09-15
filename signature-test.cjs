const crypto = require("crypto");

const secret = "PASTE_YOUR_DELIVEROO_SECRET_HERE";
const body = '{"event":"order.created","order_id":"sandbox-test-001"}';

const signature = crypto
  .createHmac("sha256", secret)
  .update(body, "utf8")
  .digest("hex");

console.log("Signature:");
console.log(signature);