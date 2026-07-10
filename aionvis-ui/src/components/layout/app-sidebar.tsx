"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronsUpDown, Globe, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  DashboardStats,
  HardwareNode,
  Organization,
} from "@/lib/api/types";
import { useAuthStore } from "@/lib/stores/auth";
import { useUiModeStore } from "@/lib/stores/ui-mode";
import { cn } from "@/lib/utils";
import { navGroups } from "./nav-config";

function OrgSwitcher() {
  const { data: orgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api<Organization[]>(endpoints.organizations.list()),
  });
  const org = orgs?.[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent">
            <Building2 className="size-4" />
          </div>
          <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">
              {org?.name ?? "…"}
            </span>
            <span className="truncate text-xs text-muted-foreground capitalize">
              {org?.plan ?? ""} plan
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuItem>
          <Building2 className="size-4" />
          {org?.name ?? "…"}
          <Badge variant="outline" className="ml-auto capitalize">
            {org?.plan}
          </Badge>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Create organization…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  if (!user) return null;

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
          <Avatar className="size-8 rounded-lg">
            <AvatarFallback className="rounded-lg text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate text-sm font-medium">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start" side="top">
        <DropdownMenuLabel className="capitalize">{user.role}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/">
            <Globe className="size-4" />
            Landing page
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={logout} variant="destructive">
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavButton({
  item,
  active,
  simple,
}: {
  item: (typeof navGroups)[number]["items"][number];
  active: boolean;
  simple: boolean;
}) {
  const button = (
    <SidebarMenuButton
      asChild
      isActive={active}
      tooltip={item.title}
      className={cn(
        "group/nav relative h-11 gap-2.5 rounded-lg px-2.5 font-normal text-sidebar-foreground/75 transition-colors duration-150",
        "hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        "data-[active=true]:bg-primary/12 data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground",
        // Collapsed (icon-only) rail: a larger, centered square with a bigger icon.
        "group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-xl group-data-[collapsible=icon]:[&_svg]:size-5",
      )}
    >
      <Link href={item.href}>
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary transition-opacity duration-200 group-data-[collapsible=icon]:hidden",
            active ? "opacity-100" : "opacity-0",
          )}
        />
        <item.icon
          className={cn(
            "transition-colors",
            active
              ? "text-primary"
              : "text-sidebar-foreground/55 group-hover/nav:text-sidebar-foreground/80",
          )}
        />
        <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
      </Link>
    </SidebarMenuButton>
  );

  // Simple mode: hovering a menu item explains what lives behind the
  // technical name (the names themselves never change between modes).
  if (!simple) return button;
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-60 text-pretty">
        {item.help}
      </TooltipContent>
    </Tooltip>
  );
}

const STATUS_DOT: Record<HardwareNode["status"], string> = {
  online: "bg-emerald-500",
  busy: "bg-primary animate-pulse",
  offline: "bg-muted-foreground",
};

/**
 * Live system pulse pinned to the bottom of the nav — fills the dead space
 * under the menu with the three numbers an operator glances at between
 * pages. Reuses the dashboard/hardware query keys, so it costs nothing
 * extra and stays in sync with the pages.
 */
function SidebarStatus({ simple }: { simple: boolean }) {
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api<DashboardStats>(endpoints.dashboard.stats()),
  });
  const { data: nodes } = useQuery({
    queryKey: ["hardware-nodes"],
    queryFn: () => api<HardwareNode[]>(endpoints.hardware.nodes()),
  });
  const node = nodes?.[0];
  if (!node && !stats) return null;

  return (
    <div className="mx-1 space-y-2.5 rounded-xl border border-sidebar-border bg-sidebar-accent/35 p-3 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-sidebar-foreground/40">
          System
        </span>
        {node && (
          <span className="flex items-center gap-1.5 text-[11px] capitalize text-sidebar-foreground/70">
            <span
              className={cn("size-1.5 rounded-full", STATUS_DOT[node.status])}
            />
            {node.status}
          </span>
        )}
      </div>
      {node && (
        <Link
          href="/hardware"
          className="block truncate text-xs font-medium hover:underline"
        >
          {node.name}
          <span className="font-normal text-sidebar-foreground/55">
            {" "}· {node.gpu.replace("AMD Instinct ", "")} · {node.vramGb} GB
          </span>
        </Link>
      )}
      {stats && (
        <div className="space-y-1.5 border-t border-sidebar-border pt-2.5 text-xs">
          <Link
            href="/runs"
            className="flex items-center justify-between hover:underline"
          >
            <span className="text-sidebar-foreground/55">
              {simple ? "Builds in progress" : "Active runs"}
            </span>
            <span className="font-medium tabular-nums">
              {stats.activeRuns}
              {stats.queuedRuns > 0 && (
                <span className="font-normal text-sidebar-foreground/55">
                  {" "}+{stats.queuedRuns} queued
                </span>
              )}
            </span>
          </Link>
          <div className="flex items-center justify-between">
            <span className="text-sidebar-foreground/55">
              {simple ? "Models built" : "Models trained"}
            </span>
            <span className="font-medium tabular-nums">
              {stats.modelsTrained}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sidebar-foreground/55">Credits left</span>
            <span className="font-medium tabular-nums">
              ${stats.creditsRemainingUsd.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const simple = useUiModeStore((s) => s.mode) === "simple";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="gap-1 px-3 pt-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="rounded-lg">
              <Link href="/" title="aionVIS home">
                {/* Collapsed rail can't fit the wordmark — the favicon eye
                    tile stands in (same asset as the browser tab). */}
                <Image
                  src="/icon.png"
                  alt="aionVIS"
                  width={512}
                  height={512}
                  className="hidden size-8 shrink-0 rounded-lg shadow-sm shadow-primary/40 group-data-[collapsible=icon]:block"
                />
                <div className="grid flex-1 gap-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <Image
                    src="/aionvis-wordmark.png"
                    alt="aionVIS"
                    width={1087}
                    height={240}
                    className="h-4.5 w-auto justify-self-start"
                  />
                  <span className="truncate text-[11px] text-muted-foreground">
                    Command Center
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <OrgSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-2 pt-2 group-data-[collapsible=icon]:px-0">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label} className="py-1 group-data-[collapsible=icon]:px-0">
            <SidebarGroupLabel className="px-2.5 text-[10px] font-semibold tracking-[0.14em] uppercase text-sidebar-foreground/40">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1 group-data-[collapsible=icon]:gap-1.5">
                {group.items.map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <NavButton item={item} active={active} simple={simple} />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <div className="mt-auto px-1 pb-1">
          <SidebarStatus simple={simple} />
        </div>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-3 py-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
