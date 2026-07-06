"use client";

import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { TelemetrySample } from "@/lib/api/types";
import { useTelemetry } from "@/hooks/use-telemetry";

/** Validated against the dark card surface (dataviz palette, dark steps). */
const chartConfig = {
  vramUsedGb: { label: "VRAM used (GB)", color: "#3987e5" },
  gpuUtilPct: { label: "GPU utilization (%)", color: "#199e70" },
} satisfies ChartConfig;

const WINDOW = 90;

export function Sparkline({
  data,
  dataKey,
  domainMax,
}: {
  data: TelemetrySample[];
  dataKey: "vramUsedGb" | "gpuUtilPct";
  domainMax: number;
}) {
  return (
    <ChartContainer config={chartConfig} className="h-16 w-full">
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

export function GpuFleetCard() {
  const { node, samples, latest } = useTelemetry(WINDOW);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>GPU fleet</CardTitle>
            <CardDescription>
              {node
                ? `${node.gpu} · ${node.vramGb} GB · ${node.region}`
                : "Loading node…"}
            </CardDescription>
          </div>
          {node && (
            <div className="flex items-center gap-2">
              <Badge variant="outline">ROCm {node.rocmVersion}</Badge>
              <Badge
                variant={node.status === "offline" ? "secondary" : "default"}
                className="capitalize"
              >
                {node.status}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!latest ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <p className="text-sm text-muted-foreground">VRAM used</p>
                <p className="text-sm font-medium">
                  {latest.vramUsedGb.toFixed(1)}
                  <span className="text-muted-foreground">
                    {" "}
                    / {latest.vramTotalGb} GB
                  </span>
                </p>
              </div>
              <Sparkline
                data={samples}
                dataKey="vramUsedGb"
                domainMax={latest.vramTotalGb}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <p className="text-sm text-muted-foreground">GPU utilization</p>
                <p className="text-sm font-medium">{latest.gpuUtilPct}%</p>
              </div>
              <Sparkline data={samples} dataKey="gpuUtilPct" domainMax={100} />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{latest.tempC}°C · {latest.powerW} W</span>
              {latest.throughput && (
                <span>
                  {latest.throughput.value} {latest.throughput.kind === "it_per_s" ? "it/s" : "img/s"}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
