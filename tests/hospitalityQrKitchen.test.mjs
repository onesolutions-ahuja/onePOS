import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
const read=p=>fs.readFileSync(p,"utf8");
test("hospitality QR ordering resolves products server-side and creates KDS ticket",()=>{const s=read("server/routes/hospitality.js");assert.match(s,/public\/qr\/:token\/orders/);assert.match(s,/SELECT id,name,price FROM products/);assert.match(s,/INSERT INTO hospitality_kds_tickets/);assert.doesNotMatch(s,/req\.body\?\.price/)});
test("QR sessions store only token hashes",()=>{const s=read("server/routes/hospitality.js");assert.match(s,/createHash\("sha256"\)/);assert.match(s,/token_hash/)});
test("kitchen printing uses canonical registered payload builder",()=>{const r=read("server/services/platformFunctionRegistry.js"),u=read("app/src/pages/hospitality/KitchenDisplay.jsx");assert.match(r,/hospitality\.kitchen\.print_payload/);assert.match(u,/kds\/tickets\/\$\{(?:t|ticket)\.id\}\/print/)});
test("public table order page is routed",()=>{assert.match(read("app/src/routes.jsx"),/table-order\/:token/)});
