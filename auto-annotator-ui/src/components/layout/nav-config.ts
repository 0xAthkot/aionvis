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

/**
 * Simple mode = the SAME destinations as Pro, in plain language (the
 * Coinbase Simple/Advanced pattern: identical capability, jargon-free
 * presentation). Never remove a tab here — rename and explain instead.
 */
const simpleNavGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "Your models and recent activity",
      },
      {
        title: "Build a model",
        href: "/foundry",
        icon: FlaskConical,
        description: "Describe a scene, get a detection model",
      },
      {
        title: "Activity",
        href: "/runs",
        icon: Play,
        description: "Watch your models being built",
      },
    ],
  },
  {
    label: "Library",
    items: [
      {
        title: "Training data",
        href: "/datasets",
        icon: Database,
        description: "The photos your models learn from",
      },
      {
        title: "Your models",
        href: "/models",
        icon: Boxes,
        description: "Test trained models on your own photos",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        title: "GPU monitor",
        href: "/hardware",
        icon: Cpu,
        description: "The graphics card doing the work",
      },
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        description: "Team and API keys",
      },
    ],
  },
];

export function navGroupsFor(mode: "simple" | "pro"): NavGroup[] {
  return mode === "pro" ? navGroups : simpleNavGroups;
}

export function titleForPath(
  pathname: string,
  mode: "simple" | "pro" = "pro",
): string {
  // Simple-mode names win where they exist; fall back to the full map so
  // pages without a simple tab (run detail, datasets) still get a title.
  const items = [
    ...(mode === "simple" ? simpleNavGroups.flatMap((g) => g.items) : []),
    ...allNavItems,
  ];
  const exact = items.find((i) => i.href === pathname);
  if (exact) return exact.title;
  const prefix = items
    .filter((i) => i.href !== "/" && pathname.startsWith(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return prefix?.title ?? "Auto-Annotator";
}
