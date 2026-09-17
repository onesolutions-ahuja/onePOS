# Online Orders UI

## Deferred cross-report Quick Date standard

Future report work should reuse a shared date-range control above the existing From/To picker, rather than duplicate date logic per report. Presets: Today, Yesterday, This Week, This Month, This Quarter, Fiscal Year.

A preset only calculates and populates From/To. Users may then adjust either date manually. The existing Refresh/Run function alone loads the report; preset selection must not fetch data or introduce separate backend functions. From/To remains the source of truth. Reuse the existing shared report date-range utilities where suitable when this standard is applied; fiscal-year and week boundaries should follow the agreed reporting configuration.

No Reports implementation is included in this Online Orders UI batch.

## Verification scope

Production build and backend syntax checks pass. Temporary browser tests used mocked API responses to check action visibility, response-driven card updates/removal, permission-gated processing, OTP requests, independent order busy state and ORDER_BUSY recovery. Printing was checked separately with mocked order details, including blocking incomplete tickets while details load. These checks do not validate live platform integrations, physical printers or live backend completion/sale transactions.

The project has no npm test script. No database test orders were created. Temporary browser harness files and profile were removed.

Summary counts describe the latest loaded orders (existing endpoint limit: 500), not all-time totals. Platform counts are pending orders only.
