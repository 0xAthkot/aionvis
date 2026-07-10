"use client";

import {
  Cog,
  ImagePlus,
  ScanEye,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentInstance, AgentKind, AgentState } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const agentIcons: Record<AgentKind, LucideIcon> = {
  prompt: Sparkles,
  synthesis: ImagePlus,
  vision: ScanEye,
  critic: ShieldCheck,
  mlops: Cog,
};

const stateStyle: Record<AgentState, { label: string; className: string }> = {
  idle: { label: "Idle", className: "text-muted-foreground" },
  thinking: { label: "Thinking", className: "text-amber-500 animate-pulse" },
  working: { label: "Working", className: "text-primary animate-pulse" },
  waiting_gpu: { label: "Waiting for GPU", className: "text-sky-500" },
  done: { label: "Done", className: "text-emerald-500" },
  error: { label: "Error", className: "text-destructive" },
};

export function AgentCard({ agent }: { agent: AgentInstance }) {
  const Icon = agentIcons[agent.kind];
  const state = stateStyle[agent.state];

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted",
          (agent.state === "working" || agent.state === "thinking") &&
            "bg-primary/10",
        )}
      >
        <Icon className={cn("size-4.5", state.className)} />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{agent.displayName}</p>
          <span className={cn("text-xs", state.className)}>{state.label}</span>
        </div>
        <Badge variant="outline" className="font-normal">
          {agent.model} · {agent.provider}
        </Badge>
        {agent.currentTask && (
          <p className="truncate pt-0.5 font-mono text-xs text-muted-foreground">
            {agent.currentTask}
          </p>
        )}
      </div>
    </div>
  );
}

export function AgentRoster({ agents }: { agents: AgentInstance[] }) {
  return (
    <div className="grid gap-2">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
