import {
  BookOpen,
  GraduationCap,
  Image,
  Layers3,
  LifeBuoy,
  Rocket,
} from "lucide-react";

const ICONS = {
  "book-open": BookOpen,
  "graduation-cap": GraduationCap,
  image: Image,
  layers: Layers3,
  "life-buoy": LifeBuoy,
  rocket: Rocket,
};

export function HelpIcon({ name, size = 20 }) {
  const Icon = ICONS[name] || BookOpen;
  return <Icon size={size} aria-hidden="true" />;
}
