import React from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import MarketingSite from "./marketing/MarketingSite.jsx";
import OfflineQueueDebug from "./pages/offlineQueue/OfflineQueueDebug.jsx";

import HomePage from "./marketing/pages/HomePage";
import POSPage from "./marketing/pages/POSPage";
import InventoryPage from "./marketing/pages/InventoryPage";
import PurchasingPage from "./marketing/pages/PurchasingPage";
import FeaturePage from "./marketing/pages/FeaturePage";
import MultiStorePage from "./marketing/pages/MultiStorePage";
import OnlineOrdersPage from "./marketing/pages/OnlineOrdersPage";
import IntegrationsPage from "./marketing/pages/IntegrationsPage";
import WhatsAppPage from "./marketing/pages/WhatsAppPage";
import PlatformsPage from "./marketing/pages/PlatformsPage";
import PlatformPage from "./marketing/pages/PlatformPage";
import HardwarePage from "./marketing/pages/HardwarePage";
import ReportsPage from "./marketing/pages/ReportsPage";
import SecurityPage from "./marketing/pages/SecurityPage";
import EcosystemPage from "./marketing/pages/EcosystemPage";
import IndustryPage from "./marketing/pages/IndustryPage";
import ResourcesPage from "./marketing/pages/ResourcesPage";
import FAQPage from "./marketing/pages/FAQPage";
import HelpCentrePage from "./marketing/pages/HelpCentrePage";
import HelpCategoryPage from "./marketing/pages/HelpCategoryPage";
import HelpArticlePage from "./marketing/pages/HelpArticlePage";
import TableOrderPage from "./marketing/pages/TableOrderPage.jsx";
import NotFoundPage from "./marketing/pages/NotFoundPage.jsx";

/*
 * Legacy marketing URLs kept working so old links, the sitemap and search
 * referrals never dead-end. /login, /app, /app/*, /api/* and /i/:token are
 * untouched — the server routes those to the operational application.
 */
const LEGACY_FEATURE_MAP = {
  pos: "/pos",
  inventory: "/inventory",
  purchasing: "/purchasing",
  customers: "/customers",
  suppliers: "/suppliers",
  employees: "/employees",
  "multi-store": "/multi-store",
  reports: "/reports",
  offline: "/platforms",
};

function LegacyFeatureRedirect() {
  const { feature } = useParams();
  const target = LEGACY_FEATURE_MAP[feature] || "/pos";
  return <Navigate to={target} replace />;
}

function LegacyRedirect({ to }) {
  return <Navigate to={to} replace />;
}

/** Paths used by the smoke test and sitemap tooling. */
export const MARKETING_PATHS = [
  "/",
  "/pos",
  "/inventory",
  "/purchasing",
  "/customers",
  "/suppliers",
  "/employees",
  "/multi-store",
  "/online-orders",
  "/whatsapp",
  "/integrations",
  "/integrations/uber-eats",
  "/integrations/deliveroo",
  "/integrations/just-eat",
  "/integrations/shopify",
  "/integrations/accounting",
  "/integrations/api",
  "/platforms",
  "/platform/web",
  "/platform/windows",
  "/platform/android",
  "/platform/ios",
  "/hardware",
  "/reports",
  "/security",
  "/ecosystem",
  "/resources",
  "/faq",
  "/help",
  "/help/getting-started",
  "/help/tutorials",
  "/help/troubleshooting",
  "/help/training",
  "/help/product-guides",
  "/help/visual-guides",
  "/industry/retail",
  "/industry/convenience",
  "/industry/off-licence",
  "/industry/grocery",
  "/industry/multi-store-retail",
];

/** The marketing route table (single source of truth for router + tests). */
export function MarketingRoutes() {
  return (
    <Routes>
      <Route path="table-order/:token" element={<TableOrderPage />} />
      <Route path="/" element={<MarketingSite />}>
        <Route index element={<HomePage />} />
        <Route path="pos" element={<POSPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="purchasing" element={<PurchasingPage />} />
        <Route path="customers" element={<FeaturePage feature="customers" />} />
        <Route path="suppliers" element={<FeaturePage feature="suppliers" />} />
        <Route path="employees" element={<FeaturePage feature="employees" />} />
        <Route path="multi-store" element={<MultiStorePage />} />
        <Route path="online-orders" element={<OnlineOrdersPage />} />
        <Route path="whatsapp" element={<WhatsAppPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="integrations/:integration" element={<IntegrationsPage />} />
        <Route path="platforms" element={<PlatformsPage />} />
        <Route path="platform/:platform" element={<PlatformPage />} />
        <Route path="hardware" element={<HardwarePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="ecosystem" element={<EcosystemPage />} />
        <Route path="industry/:sector" element={<IndustryPage />} />
        <Route path="resources" element={<ResourcesPage />} />
        <Route path="faq" element={<FAQPage />} />
        <Route path="help" element={<HelpCentrePage />} />
        <Route path="help/article/:slug" element={<HelpArticlePage />} />
        <Route path="help/:category" element={<HelpCategoryPage />} />

        {/* Diagnostics — OfflineQueueDebug is read-only and device-local; it
            renders "(empty or not logged in)" when no session token exists,
            so the marketing bundle must never reference an auth gate here. */}
        <Route path="offline-queue" element={<OfflineQueueDebug />} />
        <Route path="product" element={<LegacyRedirect to="/pos" />} />
        <Route path="product/:feature" element={<LegacyFeatureRedirect />} />
        <Route path="online-delivery" element={<LegacyRedirect to="/online-orders" />} />

        {/* Unknown marketing paths render a real 404 (app paths never reach here) */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}