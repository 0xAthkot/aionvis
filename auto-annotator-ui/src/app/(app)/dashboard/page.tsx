"use client";

import Link from "next/link";
import { FlaskConical, FolderPlus, MessageSquareText, Target } from "lucide-react";
import { GpuFleetCard } from "@/components/dashboard/gpu-fleet-card";
import { RecentRuns } from "@/components/dashboard/recent-runs";
import { StatCards } from "@/components/dashboard/stat-cards";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUiModeStore } from "@/lib/stores/ui-mode";

const STEPS = [
  {
    icon: FolderPlus,
    title: "1 · Create a project",
    body: "Name it and list the objects to detect — “forklift”, “pallet”, any noun works.",
  },
  {
    icon: MessageSquareText,
    title: "2 · Describe the scene",
    body: "One sentence. The agent swarm generates the photos, labels them and checks its own work.",
  },
  {
    icon: Target,
    title: "3 · Test your model",
    body: "Minutes later, drop a real photo on the finished model — flag any miss and the next run fixes it.",
  },
];

function GettingStarted() {
  return (
    <Card>
      <CardContent className="grid gap-6 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.title} className="flex gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <s.icon className="size-4.5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const mode = useUiModeStore((s) => s.mode);

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === "simple" ? "Your models" : "Command Center"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "simple"
              ? "Describe a scene, get a trained model — start below"
              : "Fleet overview for Aegis Robotics"}
          </p>
        </div>
        <Button asChild>
          <Link href="/foundry">
            <FlaskConical className="size-4" />
            {mode === "simple" ? "Build a model" : "Launch run"}
          </Link>
        </Button>
      </header>

      <StatCards />

      {mode === "simple" && <GettingStarted />}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <GpuFleetCard />
        </div>
        <RecentRuns />
      </div>
    </main>
  );
}
