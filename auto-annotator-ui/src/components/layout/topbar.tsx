"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { HardwareNode } from "@/lib/api/types";
import { useUiModeStore, type UiMode } from "@/lib/stores/ui-mode";
import { useAnyUnsaved } from "@/lib/stores/unsaved";
import { cn } from "@/lib/utils";
import { titleForPath } from "./nav-config";

function ModeToggle() {
  const mode = useUiModeStore((s) => s.mode);
  const setMode = useUiModeStore((s) => s.setMode);
  // Switching modes swaps whole page trees, so unlaunched form input (a run
  // being configured, an unsaved dialog) is unmounted — confirm first, but
  // only when some form actually reports unsaved input.
  const anyUnsaved = useAnyUnsaved();
  const [pending, setPending] = useState<UiMode | null>(null);

  return (
    <>
      <div
        className="flex items-center rounded-full border p-0.5"
        role="group"
        aria-label="Interface complexity"
      >
        {(["simple", "pro"] as UiMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              if (m === mode) return;
              if (anyUnsaved) setPending(m);
              else setMode(m);
            }}
            title={
              m === "simple"
                ? "Guided interface with sensible defaults"
                : "Full control plane — every option, terminal, telemetry"
            }
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-all duration-200",
              mode === m
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/40"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Switch to {pending === "pro" ? "Pro" : "Simple"} mode?
            </DialogTitle>
            <DialogDescription>
              {pending === "pro"
                ? "The full control plane replaces the guided interface — every knob exposed up front."
                : "The guided interface replaces the full console — same features, plain language, sensible defaults."}{" "}
              You have unsaved input on this page; switching clears it.
              Running jobs are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pending) setMode(pending);
                setPending(null);
              }}
            >
              Switch to {pending === "pro" ? "Pro" : "Simple"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-md">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4!" />
      <h1 className="text-sm font-medium">{titleForPath(pathname)}</h1>
      <div className="ml-auto flex items-center gap-3">
        <ModeToggle />
        <GpuStatusChip />
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
