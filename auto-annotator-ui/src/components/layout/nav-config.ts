import {
  Boxes,
  Cpu,
  Database,
  FlaskConical,
  LayoutDashboard,
  Play,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Single source of truth for the sidebar and the ⌘K command palette. */
export const navGroups: NavGroup[] = [
  {
    label: "Operate",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "Fleet overview and recent activity",
      },
      {
        title: "Synthetic Foundry",
        href: "/foundry",
        icon: FlaskConical,
        description: "Generate training data from a prompt",
      },
      {
        title: "Datasets",
        href: "/datasets",
        icon: Database,
        description: "Uploads, curation and labeling state",
      },
      {
        title: "Runs",
        href: "/runs",
        icon: Play,
        description: "Pipeline runs and live agent observability",
      },
    ],
  },
  {
    label: "Assets",
    items: [
      {
        title: "Model Registry",
        href: "/models",
        icon: Boxes,
        description: "Trained YOLO weights and metrics",
      },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      {
        title: "Hardware",
        href: "/hardware",
        icon: Cpu,
        description: "MI300X telemetry and node status",
      },
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        description: "Organization, members and API keys",
      },
    ],
  },
];

export const allNavItems = navGroups.flatMap((g) => g.items);

/** Simple mode hides infrastructure detail; Pro shows everything. */
export function navGroupsFor(mode: "simple" | "pro"): NavGroup[] {
  if (mode === "pro") return navGroups;
  return navGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.href !== "/hardware"),
    }))
    .filter((g) => g.items.length > 0);
}

export function titleForPath(pathname: string): string {
  const exact = allNavItems.find((i) => i.href === pathname);
  if (exact) return exact.title;
  const prefix = allNavItems
    .filter((i) => i.href !== "/" && pathname.startsWith(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return prefix?.title ?? "Auto-Annotator";
}
