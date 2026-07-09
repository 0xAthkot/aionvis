"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpTip } from "@/components/shared/help-tip";
import type { HardwareNode, TelemetrySample } from "@/lib/api/types";
import { useTelemetry } from "@/hooks/use-telemetry";
import { useUiModeStore } from "@/lib/stores/ui-mode";
import { cn } from "@/lib/utils";

/** Validated against the dark console surfaces (dataviz palette, dark steps). */
const chartConfig = {
  vramUsedGb: { label: "VRAM used (GB)", color: "#3987e5" },
  gpuUtilPct: { label: "GPU utilization (%)", color: "#199e70" },
} satisfies ChartConfig;

const WINDOW = 90;

export function Sparkline({
  data,
  dataKey,
  domainMax,
  className,
}: {
  data: TelemetrySample[];
  dataKey: "vramUsedGb" | "gpuUtilPct";
  domainMax: number;
  className?: string;
}) {
  return (
    <ChartContainer config={chartConfig} className={className ?? "h-16 w-full"}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={`var(--color-${dataKey})`}
              stopOpacity={0.25}
            />
            <stop
              offset="100%"
              stopColor={`var(--color-${dataKey})`}
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <XAxis dataKey="at" hide />
        <YAxis domain={[0, domainMax]} hide />
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_, payload) => {
                const at = payload?.[0]?.payload?.at as string | undefined;
                return at ? new Date(at).toLocaleTimeString() : "";
              }}
            />
          }
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={`var(--color-${dataKey})`}
          strokeWidth={2}
          fill={`url(#fill-${dataKey})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

const NODE_STATUS: Record<
  HardwareNode["status"],
  { dot: string; simple: string }
> = {
  online: { dot: "bg-emerald-500", simple: "Healthy — ready for a run" },
  busy: {
    dot: "bg-primary animate-pulse",
    simple: "Healthy — working on your run",
  },
  offline: { dot: "bg-muted-foreground", simple: "Offline" },
};

/** Full telemetry body — always what Pro sees; Simple gets it on expand. */
function TelemetryDetails({
  node,
  samples,
  latest,
}: {
  node: HardwareNode | undefined;
  samples: TelemetrySample[];
  latest: TelemetrySample;
}) {
  return (
    <>
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-muted-foreground">VRAM used</p>
          <p className="text-sm font-medium">
            {latest.vramUsedGb.toFixed(1)}
            <span className="text-muted-foreground"> / {latest.vramTotalGb} GB</span>
          </p>
        </div>
        <Sparkline
          data={samples}
          dataKey="vramUsedGb"
          domainMax={latest.vramTotalGb}
          className="h-20 w-full"
        />
      </div>
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-muted-foreground">GPU utilization</p>
          <p className="text-sm font-medium">{latest.gpuUtilPct}%</p>
        </div>
        <Sparkline
          data={samples}
          dataKey="gpuUtilPct"
          domainMax={100}
          className="h-20 w-full"
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{latest.tempC}°C · {latest.powerW} W</span>
        {latest.throughput && (
          <span>
            {latest.throughput.value} {latest.throughput.kind === "it_per_s" ? "it/s" : "img/s"}
          </span>
        )}
      </div>
      {node?.residentModels && node.residentModels.length > 0 && (
        <div className="space-y-1.5 border-t border-border/60 pt-4">
          <p className="text-xs text-muted-foreground">
            Resident swarm — models held in VRAM
          </p>
          <div className="flex flex-wrap gap-1.5">
            {node.residentModels.map((m) => (
              <Badge key={m} variant="outline" className="font-normal">
                {m}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Open section (no card chrome) — the data sits directly on the page. */
export function GpuFleetCard() {
  const simple = useUiModeStore((s) => s.mode) === "simple";
  const [expanded, setExpanded] = useState(false);
  const { node, samples, latest } = useTelemetry(WINDOW);
  const showDetails = !simple || expanded;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="section-label flex items-center gap-1.5">
            {simple ? "Your GPU" : "GPU fleet"}
            <HelpTip>
              The graphics card that runs the agents. The bar shows how much
              of its working memory (VRAM) is in use — details reveals the
              live charts engineers see.
            </HelpTip>
          </h2>
          <p className="text-sm text-muted-foreground">
            {node
              ? `${node.gpu} · ${node.vramGb} GB · ${node.region}`
              : "Loading node…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {node && !simple && (
            <Badge variant="outline">ROCm {node.rocmVersion}</Badge>
          )}
          {node && (
            <Badge
              variant={node.status === "offline" ? "secondary" : "default"}
              className="capitalize"
            >
              {node.status}
            </Badge>
          )}
          {simple && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? "Hide details" : "Show details"}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-200",
                  expanded && "rotate-180",
                )}
              />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-5">
        {!latest ? (
          <Skeleton className={showDetails ? "h-40 w-full" : "h-14 w-full"} />
        ) : !showDetails ? (
          // Simple mode: one calm summary row — every number is one click away.
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "size-2 rounded-full",
                  NODE_STATUS[node?.status ?? "online"].dot,
                )}
              />
              <p className="text-sm font-medium">
                {NODE_STATUS[node?.status ?? "online"].simple}
              </p>
            </div>
            <div className="space-y-1.5">
              <Progress
                value={(latest.vramUsedGb / latest.vramTotalGb) * 100}
                className="h-1.5"
              />
              <p className="text-xs text-muted-foreground">
                {latest.vramUsedGb.toFixed(1)} of {latest.vramTotalGb} GB memory
                in use
              </p>
            </div>
          </div>
        ) : (
          <TelemetryDetails node={node} samples={samples} latest={latest} />
        )}
      </div>
    </section>
  );
}
