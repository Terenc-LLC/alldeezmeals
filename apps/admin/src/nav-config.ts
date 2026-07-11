import {
  LayoutDashboard,
  ShieldCheck,
  ListChecks,
  Users,
  BarChart3,
  Boxes,
  FlaskConical,
  MessageSquare,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavGroupId = "operations" | "management" | "tools";

export type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
  group: NavGroupId;
};

// Grouping mirrors the IA in TER-509: operations (day-to-day monitoring +
// queues) · management (entity administration) · tools (utilities).
export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: "operations", label: "Operations" },
  { id: "management", label: "Management" },
  { id: "tools", label: "Tools" },
];

export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard, group: "operations" },
  { path: "/insights", label: "Insights", icon: BarChart3, group: "operations" },
  { path: "/approvals", label: "Approvals", icon: ShieldCheck, group: "operations" },
  { path: "/review-queues", label: "Review Queues", icon: ListChecks, group: "operations" },
  { path: "/users", label: "Users", icon: Users, group: "management" },
  { path: "/catalog", label: "Catalog", icon: Boxes, group: "management" },
  { path: "/beta", label: "Beta Program", icon: FlaskConical, group: "management" },
  { path: "/feedback", label: "Feedback", icon: MessageSquare, group: "management" },
  { path: "/tools", label: "Tools", icon: Wrench, group: "tools" },
];
