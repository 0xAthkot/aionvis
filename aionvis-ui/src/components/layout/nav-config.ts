import {
  Boxes,
  Cpu,
  Database,
  FlaskConical,
  FolderKanban,
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
  /** Plain-language explanation surfaced in Simple mode (hover help). */
  help: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Single source of truth for the sidebar and the ⌘K command palette.
 * The menu is IDENTICAL in Simple and Pro mode — same names, same layout
 * (a menu that reshuffles when you flip a toggle is disorienting). Simple
 * mode explains the technical names instead, via each item's `help` text.
 */
export const navGroups: NavGroup[] = [
  {
    label: "Operate",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "Fleet overview and recent activity",
        help: "Your home screen — what the swarm is doing right now.",
      },
      {
        title: "Projects",
        href: "/projects",
        icon: FolderKanban,
        description: "Every project with its runs, datasets and models",
        help: "One row per goal you're building models for — see everything each project produced, search and filter across all of them.",
      },
      {
        title: "Synthetic Foundry",
        href: "/foundry",
        icon: FlaskConical,
        description: "Generate training data from a use case",
        help: "Where models are born: say what your model is for and the AI agents create the training photos, label them and train it.",
      },
      {
        title: "Datasets",
        href: "/datasets",
        icon: Database,
        description: "Uploads, curation and labeling state",
        help: "The photo collections your models learn from — made by the swarm or uploaded by you.",
      },
      {
        title: "Runs",
        href: "/runs",
        icon: Play,
        description: "Pipeline runs and live agent observability",
        help: "Every model build, live and finished — open one to watch the agents work.",
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
        help: "Your finished models — test them on real photos and download them.",
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
        help: "The graphics card doing the work — its health, memory and load.",
      },
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        description: "Organization, members and API keys",
        help: "Your team, access keys and connected services.",
      },
    ],
  },
];

export const allNavItems = navGroups.flatMap((g) => g.items);

export function titleForPath(pathname: string): string {
  const exact = allNavItems.find((i) => i.href === pathname);
  if (exact) return exact.title;
  const prefix = allNavItems
    .filter((i) => i.href !== "/" && pathname.startsWith(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return prefix?.title ?? "aionVIS";
}
