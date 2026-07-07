"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { HardwareNode } from "@/lib/api/types";
import { useUiModeStore, type UiMode } from "@/lib/stores/ui-mode";
import { cn } from "@/lib/utils";
import { titleForPath } from "./nav-config";

function ModeToggle() {
  const mode = useUiModeStore((s) => s.mode);
  const setMode = useUiModeStore((s) => s.setMode);

  return (
    <div
      className="flex items-center rounded-full border p-0.5"
      role="group"
      aria-label="Interface complexity"
    >
      {(["simple", "pro"] as UiMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          title={
            m === "simple"
              ? "Guided interface with sensible defaults"
              : "Full control plane — every option, terminal, telemetry"
          }
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-colors",
            mode === m
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function GpuStatusChip() {
  const { data: nodes } = useQuery({
    queryKey: ["hardware-nodes"],
    queryFn: () => api<HardwareNode[]>(endpoints.hardware.nodes()),
  });
  const node = nodes?.[0];
  if (!node) return null;

  return (
    <Badge variant="outline" className="hidden gap-1.5 font-normal md:inline-flex">
      <span
        className={`size-1.5 rounded-full ${
          node.status === "offline"
            ? "bg-muted-foreground"
            : node.status === "busy"
              ? "bg-primary animate-pulse"
              : "bg-emerald-500"
        }`}
      />
      {node.name} · ROCm {node.rocmVersion}
    </Badge>
  );
}

export function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = usePathname();
  const mode = useUiModeStore((s) => s.mode);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4!" />
      <h1 className="text-sm font-medium">{titleForPath(pathname)}</h1>
      <div className="ml-auto flex items-center gap-2">
        <ModeToggle />
        {mode === "pro" && <GpuStatusChip />}
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={onOpenPalette}
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">Search…</span>
          <kbd className="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px]">
            Ctrl K
          </kbd>
        </Button>
      </div>
    </header>
  );
}
