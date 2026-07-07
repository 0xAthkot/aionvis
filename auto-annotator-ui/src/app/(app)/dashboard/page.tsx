"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { GpuFleetCard } from "@/components/dashboard/gpu-fleet-card";
import { RecentRuns } from "@/components/dashboard/recent-runs";
import { StatCards } from "@/components/dashboard/stat-cards";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Command Center
          </h1>
          <p className="text-sm text-muted-foreground">
            Fleet overview for Aegis Robotics
          </p>
        </div>
        <Button asChild>
          <Link href="/foundry">
            <FlaskConical className="size-4" />
            Launch run
          </Link>
        </Button>
      </header>

      <StatCards />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <GpuFleetCard />
        </div>
        <RecentRuns />
      </div>
    </main>
  );
}
