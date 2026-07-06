"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Sparkline } from "@/components/dashboard/gpu-fleet-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTelemetry } from "@/hooks/use-telemetry";

/**
 * Compact live VRAM readout for Mission Control. Because telemetry follows
 * the simulator's load model, the flush at each `hip.empty_cache()` boundary
 * is visible right next to the log line announcing it.
 */
export function VramCard() {
  // Live-only window: starts at "now" so stage flushes are front and center.
  const { node, samples, latest } = useTelemetry(60, false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Hardware</CardTitle>
            <CardDescription>{node?.gpu ?? "Loading…"}</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/hardware">
              Details <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!latest || !node ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-muted-foreground">VRAM</p>
              <p className="text-sm font-medium">
                {latest.vramUsedGb.toFixed(1)}
                <span className="text-muted-foreground">
                  {" "}/ {latest.vramTotalGb} GB
                </span>
              </p>
            </div>
            <Sparkline
              data={samples}
              dataKey="vramUsedGb"
              domainMax={latest.vramTotalGb}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>util {latest.gpuUtilPct}%</span>
              <span>
                {latest.tempC}°C · {latest.powerW} W
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
