import {
  BookOpen,
  Building2,
  CircleHelp,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
export const menu = [
  { key: "overview", name: "Overview", icon: LayoutDashboard },
  { key: "bookings", name: "Bookings", icon: BookOpen, permission: "bookings:read" },
  { key: "organisations", name: "Organisations", icon: Building2 },
  { key: "people", name: "People", icon: Users, permission: "party:admin" },
  { key: "roles", name: "Roles", icon: ShieldCheck },
  { key: "audit", name: "Audit", icon: ScrollText, permission: "audit:read" },
  { key: "framework", name: "Framework", icon: CircleHelp },
];
export function route() {
  return window.location.hash.slice(1).split("/")[0] || "overview";
}
