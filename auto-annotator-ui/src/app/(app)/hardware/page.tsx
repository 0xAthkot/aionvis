"use client";

import { Cpu } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/shared/help-tip";
import { ConnectNodeCard } from "@/components/shared/connect-node-card";
import { Badge } from "@/components/ui/badge";
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
            <stop offset="0%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.38} />
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
          strokeWidth={2.5}
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
    <main className="stagger-children mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Hardware
            <HelpTip>
              The graphics card (GPU) doing all the work. VRAM is its working
              memory; utilization is how hard it&apos;s working. You can also
              connect a rented cloud GPU here.
            </HelpTip>
          </span>
        }
        description="Live telemetry for the GPU fleet running the agent swarm."
      />

      {/* Always reachable — attaching/detaching a node must work even when
          the current source is down and telemetry can't load. */}
      <ConnectNodeCard />

      {!node || !latest ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <section className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Cpu className="size-5 text-muted-foreground" />
                </div>
                <div className="space-y-0.5">
                  <h2 className="text-lg font-semibold tracking-tight">
                    {node.name}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {node.gpu} · {node.vramGb} GB HBM3 · {node.region} ·{" "}
                    AMD Developer Cloud
                  </p>
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
            <dl className="grid grid-cols-2 gap-y-5 border-y border-border/70 sm:grid-cols-4 sm:divide-x sm:divide-border/70">
              <div className="py-4 pr-4 sm:px-8 sm:first:pl-0">
                <dt className="text-xs text-muted-foreground">VRAM</dt>
                <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                  {latest.vramUsedGb.toFixed(1)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}/ {latest.vramTotalGb} GB
                  </span>
                </dd>
              </div>
              <div className="py-4 pr-4 sm:px-8">
                <dt className="text-xs text-muted-foreground">Utilization</dt>
                <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                  {latest.gpuUtilPct}%
                </dd>
              </div>
              <div className="py-4 pr-4 sm:px-8">
                <dt className="text-xs text-muted-foreground">Temperature</dt>
                <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                  {latest.tempC}°C
                </dd>
              </div>
              <div className="py-4 pr-4 sm:px-8">
                <dt className="text-xs text-muted-foreground">Power</dt>
                <dd className="text-2xl font-semibold tracking-tight tabular-nums">
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
              <div className="space-y-1.5">
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
          </section>

          <div className="grid items-start gap-x-10 gap-y-8 xl:grid-cols-2">
            <section className="space-y-3">
              <div className="space-y-1">
                <h3 className="section-label">VRAM utilization</h3>
                <p className="text-sm text-muted-foreground">
                  Watch it flush at hip.empty_cache() between pipeline stages
                </p>
              </div>
              <TelemetryChart
                data={samples}
                dataKey="vramUsedGb"
                domainMax={latest.vramTotalGb}
              />
            </section>
            <section className="space-y-3">
              <div className="space-y-1">
                <h3 className="section-label">GPU utilization</h3>
                <p className="text-sm text-muted-foreground">
                  Compute load across synthesis, SAM 3 and training
                </p>
              </div>
              <TelemetryChart
                data={samples}
                dataKey="gpuUtilPct"
                domainMax={100}
              />
            </section>
          </div>

        </>
      )}
    </main>
  );
}
