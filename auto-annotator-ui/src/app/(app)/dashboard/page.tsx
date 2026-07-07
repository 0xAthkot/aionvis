"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { GpuFleetCard } from "@/components/dashboard/gpu-fleet-card";
import { RecentRuns } from "@/components/dashboard/recent-runs";
import { StatCards } from "@/components/dashboard/stat-cards";
import { Button } from "@/components/ui/button";
import { useUiModeStore } from "@/lib/stores/ui-mode";

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

      {mode === "simple" ? (
        <RecentRuns />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <GpuFleetCard />
          </div>
          <RecentRuns />
        </div>
      )}
    </main>
  );
}
