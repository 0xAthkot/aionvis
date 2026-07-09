"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  FlaskConical,
  FolderPlus,
  MessageSquareText,
  Target,
} from "lucide-react";
import { GpuFleetCard } from "@/components/dashboard/gpu-fleet-card";
import { RecentRuns } from "@/components/dashboard/recent-runs";
import { StatCards } from "@/components/dashboard/stat-cards";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { Paginated, PipelineRun } from "@/lib/api/types";
import { SIMPLE_STAGE } from "@/lib/simple-language";
import { useUiModeStore } from "@/lib/stores/ui-mode";

const STEPS = [
  {
    icon: FolderPlus,
    title: "1 · Create a project",
    body: "Name it and list the objects to detect — “forklift”, “pallet”, any noun works.",
    href: "/foundry",
  },
  {
    icon: MessageSquareText,
    title: "2 · Say the job",
    body: "One sentence about the deployment — “my drone needs to detect rotten potatoes”. The agent swarm designs the scenes, creates the photos, labels them and checks its own work.",
    href: "/foundry",
  },
  {
    icon: Target,
    title: "3 · Test your model",
    body: "Minutes later, drop a real photo on the finished model — flag any miss and the next run fixes it.",
    href: "/models",
  },
] as const;

function GettingStarted() {
  return (
    <div className="grid gap-6 sm:grid-cols-3 sm:gap-2">
      {STEPS.map((s) => (
        <Link
          key={s.title}
          href={s.href}
          className="group/step -m-2 flex gap-3 rounded-xl p-3 transition-colors hover:bg-accent/50"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover/step:bg-primary group-hover/step:text-primary-foreground">
            <s.icon className="size-4.5" />
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-sm font-medium">
              {s.title}
              <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/step:opacity-100" />
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {s.body}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const mode = useUiModeStore((s) => s.mode);
  const simple = mode === "simple";

  // Live one-line status: what the swarm is doing this second. Shares the
  // "runs" query with RecentRuns, so it costs no extra request.
  const { data: runs } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api<Paginated<PipelineRun>>(endpoints.runs.list()),
  });
  const active = runs?.items.find((r) => r.status === "running");
  const summary = !runs
    ? simple
      ? "Checking on the swarm…"
      : "Loading fleet state…"
    : active
      ? `${active.name} — ${
          simple
            ? SIMPLE_STAGE[active.stage].toLowerCase()
            : active.stage.replace(/_/g, " ")
        } · ${active.progress.pct}%`
      : simple
        ? "The swarm is idle — say the job and it builds your next model."
        : "Fleet idle — launch a run to put the swarm to work.";

  return (
    <main className="stagger-children mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Dashboard"
        description={
          <span className="flex items-center gap-2">
            {active && (
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
            )}
            {summary}
          </span>
        }
        actions={
          <Button asChild size="lg" className="shadow-md shadow-primary/25">
            <Link href="/foundry">
              <FlaskConical className="size-4" />
              {simple ? "Build a model" : "Launch run"}
            </Link>
          </Button>
        }
      />

      {/* Simple mode leads with "what do I do next"; Pro leads with the fleet. */}
      {simple && <GettingStarted />}
      <StatCards />
      <div className="grid items-start gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <GpuFleetCard />
        </div>
        <div className="lg:border-l lg:border-border/70 lg:pl-8">
          <RecentRuns />
        </div>
      </div>
    </main>
  );
}
