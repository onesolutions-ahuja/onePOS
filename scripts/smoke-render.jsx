import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { MarketingRoutes, MARKETING_PATHS } from "../src/routes.jsx";

let fails = 0;
let ok = 0;

for (const path of MARKETING_PATHS) {
  try {
    const html = renderToString(
      <MemoryRouter initialEntries={[path]}>
        <MarketingRoutes />
      </MemoryRouter>
    );
    ok++;
    console.log(`OK   ${path}  (${html.length} chars)`);
  } catch (err) {
    fails++;
    const msg = err && err.stack ? err.stack.split("\n").slice(0, 5).join(" | ") : String(err);
    console.log(`FAIL ${path}  ${msg}`);
  }
}

console.log(`\n${ok} routes OK, ${fails} failed`);
process.exit(fails ? 1 : 0);