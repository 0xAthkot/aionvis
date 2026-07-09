"use client";

import { Cpu } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/layout/page-header";
import { ConnectNodeCard } from "@/components/shared/connect-node-card";
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

/** Same validated hues as every other telemetry chart in the app. */
const chartConfig = {
  vramUsedGb: { label: "VRAM used (GB)", color: "#3987e5" },
  gpuUtilPct: { label: "GPU utilization (%)", color: "#199e70" },
} satisfies ChartConfig;

function TelemetryChart({
  data,
  dataKey,
  domainMax,
}: {
  data: TelemetrySample[];
  dataKey: "vramUsedGb" | "gpuUtilPct";
  domainMax: number;
}) {
  return (
    <ChartContainer config={chartConfig} className="h-52 w-full">
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <defs>
          <linearGradient id={`hw-fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.25} />
            <stop offset="100%" stopColor={`var(--color-${dataKey})`} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.35} />
        <XAxis
          dataKey="at"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          minTickGap={48}
          tick={{ fontSize: 11 }}
          tickFormatter={(v: string) =>
            new Date(v).toLocaleTimeString(undefined, {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
            })
          }
        />
        <YAxis
          domain={[0, domainMax]}
          tickLine={false}
          axisLine={false}
          width={44}
          tick={{ fontSize: 11 }}
        />
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
          fill={`url(#hw-fill-${dataKey})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export default function HardwarePage() {
  const { node, samples, latest } = useTelemetry(150);

  return (
    <main className="page-enter mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Hardware"
        description="Live telemetry for the GPU fleet running the agent swarm."
      />

      {/* Always reachable — attaching/detaching a node must work even when
          the current source is down and telemetry can't load. */}
      <ConnectNodeCard />

      {!node || !latest ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                    <Cpu className="size-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-0.5">
                    <CardTitle>{node.name}</CardTitle>
                    <CardDescription>
                      {node.gpu} · {node.vramGb} GB HBM3 · {node.region} ·{" "}
                      AMD Developer Cloud
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline">ROCm {node.rocmVersion}</Badge>
                  <Badge variant="outline">PyTorch {node.pytorchVersion}</Badge>
                  <Badge
                    variant={node.status === "offline" ? "secondary" : "default"}
                    className="capitalize"
                  >
                    {node.status}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">VRAM</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {latest.vramUsedGb.toFixed(1)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}/ {latest.vramTotalGb} GB
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Utilization</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {latest.gpuUtilPct}%
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Temperature</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {latest.tempC}°C
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Power</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {latest.powerW} W
                    {latest.throughput && (
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}· {latest.throughput.value}{" "}
                        {latest.throughput.kind === "it_per_s" ? "it/s" : "img/s"}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              {node.residentModels && node.residentModels.length > 0 && (
                <div className="mt-4 space-y-1.5 border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    Resident swarm — every agent model held in VRAM at once,
                    so the pipeline streams instead of taking turns
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
            </CardContent>
          </Card>

          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>VRAM utilization</CardTitle>
                <CardDescription>
                  Watch it flush at hip.empty_cache() between pipeline stages
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TelemetryChart
                  data={samples}
                  dataKey="vramUsedGb"
                  domainMax={latest.vramTotalGb}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>GPU utilization</CardTitle>
                <CardDescription>
                  Compute load across synthesis, SAM 3 and training
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TelemetryChart
                  data={samples}
                  dataKey="gpuUtilPct"
                  domainMax={100}
                />
              </CardContent>
            </Card>
          </div>

        </>
      )}
    </main>
  );
}
