/*
 * Deliveroo integration service.
 *
 * Placeholder implementation - all platform calls are stubs (see
 * platformServiceBase.js). Real credentials/API calls to be added later,
 * keeping Deliveroo-specific behaviour out of POS/checkout logic.
 */

import { createPlatformService } from "./platformServiceBase.js";

const deliverooService = createPlatformService({
  platform: "deliveroo",
  displayName: "Deliveroo",
});

export default deliverooService;
