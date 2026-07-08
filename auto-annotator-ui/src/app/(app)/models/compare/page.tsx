"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Trophy } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { ModelArtifact } from "@/lib/api/types";
import { CLASS_COLORS } from "@/lib/class-colors";
import { cn } from "@/lib/utils";

/** Compare up to this many models — one fixed-order hue each. */
const MAX_COMPARE = 4;

interface MetricRow {
  label: string;
  value: (m: ModelArtifact) => number | undefined;
  format: (v: number) => string;
  /** Whether a higher value wins the row. */
  higherWins: boolean;
}

const METRIC_ROWS: MetricRow[] = [
  { label: "mAP@50", value: (m) => m.metrics.map50, format: (v) => v.toFixed(3), higherWins: true },
  { label: "mAP@50–95", value: (m) => m.metrics.map5095, format: (v) => v.toFixed(3), higherWins: true },
  { label: "Precision", value: (m) => m.metrics.precision, format: (v) => v.toFixed(3), higherWins: true },
  { label: "Recall", value: (m) => m.metrics.recall, format: (v) => v.toFixed(3), higherWins: true },
  { label: "Top-1 accuracy", value: (m) => m.metrics.top1, format: (v) => v.toFixed(3), higherWins: true },
  { label: "Top-5 accuracy", value: (m) => m.metrics.top5, format: (v) => v.toFixed(3), higherWins: true },
  { label: "Epochs", value: (m) => m.metrics.epochsRun, format: (v) => String(v), higherWins: true },
  { label: "Training time (min)", value: (m) => m.metrics.trainingTimeMin, format: (v) => v.toFixed(1), higherWins: false },
  { label: "Weights (MB)", value: (m) => m.fileSizeMb, format: (v) => v.toFixed(1), higherWins: false },
];

function OverlayChart({
  models,
  metric,
  label,
  yDomain,
}: {
  models: ModelArtifact[];
  metric: "map50" | "boxLoss" | "top1";
  label: string;
  yDomain?: [number, number];
}) {
  // Merge per-model curves onto one epoch axis: row = { epoch, m_<id>: value }.
  const { data, config } = useMemo(() => {
    const byEpoch = new Map<number, Record<string, number>>();
    const cfg: ChartConfig = {};
    models.forEach((m, i) => {
      cfg[`m_${m.id}`] = { label: m.name, color: CLASS_COLORS[i % CLASS_COLORS.length] };
      for (const p of m.curves) {
        const v = p[metric];
        if (v === undefined) continue;
        const row = byEpoch.get(p.epoch) ?? { epoch: p.epoch };
        row[`m_${m.id}`] = v;
        byEpoch.set(p.epoch, row);
      }
    });
    return {
      data: [...byEpoch.values()].sort((a, b) => a.epoch - b.epoch),
      config: cfg,
    };
  }, [models, metric]);

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        No {label} curve data on the selected models.
      </p>
    );
  }

  return (
    <ChartContainer config={config} className="h-64 w-full">
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.35} />
        <XAxis dataKey="epoch" tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 11 }} />
        <YAxis domain={yDomain ?? ["auto", "auto"]} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={44} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => `Epoch ${v}`} />} />
        <ChartLegend content={<ChartLegendContent />} />
        {models.map((m) => (
          <Line
            key={m.id}
            type="monotone"
            dataKey={`m_${m.id}`}
            stroke={`var(--color-m_${m.id})`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

export default function CompareModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids: idsParam } = use(searchParams);
  const ids = useMemo(
    () => (idsParam ?? "").split(",").filter(Boolean).slice(0, MAX_COMPARE),
    [idsParam],
  );

  const { data: allModels } = useQuery({
    queryKey: ["models"],
    queryFn: () => api<ModelArtifact[]>(endpoints.models.list()),
  });

  const models = useMemo(
    () =>
      ids
        .map((id) => allModels?.find((m) => m.id === id))
        .filter((m): m is ModelArtifact => Boolean(m)),
    [allModels, ids],
  );

  const anyClassify = models.some((m) => m.task === "classify");
  const anyDetect = models.some((m) => m.task !== "classify");

  const activeRows = METRIC_ROWS.filter((row) =>
    models.some((m) => row.value(m) !== undefined && row.value(m) !== null),
  );

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link href="/models">
            <ArrowLeft className="size-3.5" />
            Model Registry
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Compare experiments
          </h1>
          <p className="text-sm text-muted-foreground">
            {models.length} models side by side — the best value in each row
            wears the trophy.
          </p>
        </div>
      </header>

      {!allModels ? (
        <Skeleton className="h-96 w-full" />
      ) : models.length < 2 ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed">
          <p className="text-sm text-muted-foreground">
            Pick at least two models in the registry to compare them.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/models">Back to registry</Link>
          </Button>
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Metrics</CardTitle>
              <CardDescription>
                Final validation metrics per model · colored dot matches the
                curve overlays below
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">Metric</TableHead>
                    {models.map((m, i) => (
                      <TableHead key={m.id}>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: CLASS_COLORS[i % CLASS_COLORS.length] }}
                            />
                            <Link
                              href={`/models/${m.id}`}
                              className="font-medium text-foreground hover:underline"
                            >
                              {m.name}
                            </Link>
                          </div>
                          <div className="flex gap-1.5">
                            <Badge variant="outline" className="font-mono text-[10px] uppercase">
                              {m.architecture}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {m.task ?? "detect"}
                            </Badge>
                          </div>
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeRows.map((row) => {
                    const values = models.map((m) => row.value(m));
                    const defined = values.filter(
                      (v): v is number => v !== undefined && v !== null,
                    );
                    const best = row.higherWins
                      ? Math.max(...defined)
                      : Math.min(...defined);
                    // A tie (all equal) crowns nobody.
                    const contested = new Set(defined).size > 1;
                    return (
                      <TableRow key={row.label}>
                        <TableCell className="text-muted-foreground">
                          {row.label}
                        </TableCell>
                        {models.map((m, i) => {
                          const v = values[i];
                          const wins = contested && v === best;
                          return (
                            <TableCell
                              key={m.id}
                              className={cn(
                                "tabular-nums",
                                wins && "font-semibold text-foreground",
                              )}
                            >
                              {v === undefined || v === null ? (
                                <span className="text-muted-foreground/50">—</span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5">
                                  {row.format(v)}
                                  {wins && (
                                    <Trophy className="size-3 text-primary" aria-label="best in row" />
                                  )}
                                </span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell className="text-muted-foreground">Classes</TableCell>
                    {models.map((m) => (
                      <TableCell key={m.id} className="text-xs">
                        {m.classes.join(", ")}
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Trained</TableCell>
                    {models.map((m) => (
                      <TableCell key={m.id} className="text-xs text-muted-foreground">
                        {new Date(m.createdAt).toLocaleDateString()} · {m.trainedOn.gpu}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {anyDetect && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>mAP@50 per epoch</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <OverlayChart models={models} metric="map50" label="mAP" yDomain={[0, 1]} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Box loss per epoch</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <OverlayChart models={models} metric="boxLoss" label="loss" />
                  </CardContent>
                </Card>
              </>
            )}
            {anyClassify && (
              <Card>
                <CardHeader>
                  <CardTitle>Top-1 accuracy per epoch</CardTitle>
                </CardHeader>
                <CardContent>
                  <OverlayChart models={models} metric="top1" label="accuracy" yDomain={[0, 1]} />
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </main>
  );
}
