/*
 * Registry for online delivery-platform services (Uber Eats / Deliveroo).
 *
 * Usage:
 *   const service = getPlatformService("uber");     // throws on unknown platform
 *   await service.acceptOrder({ order });           // stubbed until real integration
 */

import uberEatsService from "./uber.js";
import deliverooService from "./deliveroo.js";

export const ONLINE_PLATFORMS = ["uber", "deliveroo"];

const platformServices = {
  uber: uberEatsService,
  deliveroo: deliverooService,
};

export function isOnlinePlatform(platform) {
  return Object.prototype.hasOwnProperty.call(platformServices, platform);
}

export function getPlatformService(platform) {
  const service = platformServices[platform];

  if (!service) {
    throw new Error(`Unknown online platform: ${platform}`);
  }

  return service;
}

export function listPlatformServices() {
  return ONLINE_PLATFORMS.map((platform) => getPlatformService(platform));
}
