import {
  Activity,
  Bike,
  Box,
  Briefcase,
  Building2,
  Bus,
  Calendar,
  Car,
  ClipboardList,
  Clock,
  CreditCard,
  Database,
  FileText,
  Flag,
  Folder,
  Globe,
  HardHat,
  Heart,
  Home,
  Layers,
  List,
  Mail,
  MapPin,
  Package,
  Phone,
  Plane,
  Settings,
  Shield,
  ShoppingBag,
  Star,
  Store,
  Tag,
  Tractor,
  Truck,
  User,
  Users,
  Warehouse,
  Wrench,
} from "lucide-react";

/*
 * ICON KEYS for configured Platform Object navigation.
 *
 * Platform metadata stores a KEY ("vehicle"), never component source or markup,
 * so a persisted icon can only ever select one of the components registered
 * here — there is nothing to evaluate and nothing to execute. This reuses the
 * one icon library the admin UI already ships (lucide-react); no second set.
 *
 * An unknown, missing or malformed key resolves to the default Object icon.
 */
export const DEFAULT_OBJECT_ICON_KEY = "box";

export const OBJECT_NAV_ICON_OPTIONS = Object.freeze([
  { key: "box", label: "Object", Icon: Box },
  { key: "package", label: "Product", Icon: Package },
  { key: "car", label: "Vehicle", Icon: Car },
  { key: "truck", label: "Delivery", Icon: Truck },
  { key: "tractor", label: "Equipment", Icon: Tractor },
  { key: "bike", label: "Bike", Icon: Bike },
  { key: "bus", label: "Transport", Icon: Bus },
  { key: "plane", label: "Travel", Icon: Plane },
  { key: "users", label: "People", Icon: Users },
  { key: "user", label: "Person", Icon: User },
  { key: "briefcase", label: "Business", Icon: Briefcase },
  { key: "building", label: "Company", Icon: Building2 },
  { key: "store", label: "Store", Icon: Store },
  { key: "warehouse", label: "Warehouse", Icon: Warehouse },
  { key: "hard-hat", label: "Works", Icon: HardHat },
  { key: "wrench", label: "Service", Icon: Wrench },
  { key: "clipboard", label: "Jobs", Icon: ClipboardList },
  { key: "list", label: "List", Icon: List },
  { key: "layers", label: "Groups", Icon: Layers },
  { key: "folder", label: "Documents", Icon: Folder },
  { key: "file-text", label: "Records", Icon: FileText },
  { key: "tag", label: "Tags", Icon: Tag },
  { key: "flag", label: "Flags", Icon: Flag },
  { key: "star", label: "Favourites", Icon: Star },
  { key: "heart", label: "Care", Icon: Heart },
  { key: "activity", label: "Activity", Icon: Activity },
  { key: "calendar", label: "Schedule", Icon: Calendar },
  { key: "clock", label: "Time", Icon: Clock },
  { key: "credit-card", label: "Billing", Icon: CreditCard },
  { key: "shopping-bag", label: "Orders", Icon: ShoppingBag },
  { key: "phone", label: "Phone", Icon: Phone },
  { key: "mail", label: "Mail", Icon: Mail },
  { key: "map-pin", label: "Locations", Icon: MapPin },
  { key: "globe", label: "Online", Icon: Globe },
  { key: "database", label: "Data", Icon: Database },
  { key: "shield", label: "Compliance", Icon: Shield },
  { key: "home", label: "Property", Icon: Home },
  { key: "settings", label: "Config", Icon: Settings },
]);

const ICONS_BY_KEY = Object.freeze(
  Object.fromEntries(OBJECT_NAV_ICON_OPTIONS.map((option) => [option.key, option.Icon]))
);

/** Keys an administrator may persist (identifiers only — no markup). */
export const OBJECT_NAV_ICON_KEYS = Object.freeze(Object.keys(ICONS_BY_KEY));

/** Normalizes persisted input the same way the server does. */
export function normalizeObjectIconKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

/** Resolves a stored key to a component, falling back to the Object icon. */
export function resolveObjectNavIcon(key) {
  const normalized = normalizeObjectIconKey(key);
  return ICONS_BY_KEY[normalized] || ICONS_BY_KEY[DEFAULT_OBJECT_ICON_KEY];
}

export function isKnownObjectIconKey(key) {
  return Boolean(ICONS_BY_KEY[normalizeObjectIconKey(key)]);
}
