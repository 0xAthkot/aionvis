"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Boxes, GitCompareArrows, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/shared/help-tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { ModelArtifact } from "@/lib/api/types";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ModelCard({
  model,
  selected,
  selectionFull,
  onToggle,
}: {
  model: ModelArtifact;
  selected: boolean;
  selectionFull: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <Card
      className={`flex flex-col transition-shadow duration-200 ${selected ? "ring-primary/50 shadow-md shadow-primary/10" : ""}`}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Checkbox
                checked={selected}
                disabled={!selected && selectionFull}
                onCheckedChange={() => onToggle(model.id)}
                aria-label={`Select ${model.name} for comparison`}
              />
              {model.name}
              <span className="text-muted-foreground">v{model.version}</span>
            </CardTitle>
            <CardDescription>
              {model.fileName} · {model.fileSizeMb.toFixed(1)} MB ·{" "}
              {new Date(model.createdAt).toLocaleDateString()}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="font-mono uppercase">
              {model.architecture}
            </Badge>
            <Badge
              variant={
                model.status === "ready"
                  ? "default"
                  : model.status === "archived"
                    ? "secondary"
                    : "outline"
              }
            >
              {model.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <div className="grid grid-cols-4 gap-3">
          {model.metrics.top1 !== undefined && model.metrics.top1 !== null ? (
            <>
              <Metric label="Top-1" value={model.metrics.top1.toFixed(3)} />
              <Metric label="Top-5" value={(model.metrics.top5 ?? 0).toFixed(3)} />
              <Metric label="Classes" value={String(model.classes.length)} />
              <Metric label="Epochs" value={String(model.metrics.epochsRun)} />
            </>
          ) : (
            <>
              <Metric label="mAP@50" value={model.metrics.map50.toFixed(3)} />
              <Metric label="mAP@50–95" value={model.metrics.map5095.toFixed(3)} />
              <Metric label="Precision" value={model.metrics.precision.toFixed(3)} />
              <Metric label="Recall" value={model.metrics.recall.toFixed(3)} />
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {model.classes.map((cls) => (
            <Badge key={cls} variant="secondary" className="font-mono text-xs">
              {cls}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Trained on {model.trainedOn.gpu} · ROCm {model.trainedOn.rocmVersion}{" "}
          · {model.metrics.epochsRun} epochs in{" "}
          {model.metrics.trainingTimeMin} min
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link href={`/models/${model.id}`}>
            Metrics &amp; export <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Compare caps at 4 — one fixed-order hue per model on the compare page. */
const MAX_COMPARE = 4;

export default function ModelsPage() {
  const { data: models } = useQuery({
    queryKey: ["models"],
    queryFn: () => api<ModelArtifact[]>(endpoints.models.list()),
  });
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_COMPARE
          ? prev
          : [...prev, id],
    );

  return (
    <main className="page-enter mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Model Registry
            <HelpTip>
              Every model the swarm has trained for you. Open one to test it
              on real photos or download the weights; tick two or more to
              compare them side by side.
            </HelpTip>
          </span>
        }
        description="Deployable YOLO weights produced by the agent swarm — tick two or more to compare experiments."
        actions={
          selected.length > 0 ? (
            <>
              <span className="text-xs text-muted-foreground">
                {selected.length}/{MAX_COMPARE} selected
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                <X className="size-3.5" />
                Clear
              </Button>
              <Button
                size="sm"
                disabled={selected.length < 2}
                asChild={selected.length >= 2}
              >
                {selected.length >= 2 ? (
                  <Link href={`/models/compare?ids=${selected.join(",")}`}>
                    <GitCompareArrows className="size-3.5" />
                    Compare {selected.length}
                  </Link>
                ) : (
                  <>
                    <GitCompareArrows className="size-3.5" />
                    Compare
                  </>
                )}
              </Button>
            </>
          ) : undefined
        }
      />

      {models && models.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {[
            ["Models", String(models.length)],
            ["Ready", String(models.filter((m) => m.status === "ready").length)],
            [
              "Best mAP@50",
              Math.max(...models.map((m) => m.metrics.map50)).toFixed(3),
            ],
            [
              "Architectures",
              String(new Set(models.map((m) => m.architecture)).size),
            ],
          ].map(([label, value]) => (
            <span
              key={label}
              className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-muted-foreground"
            >
              {label}
              <span className="font-medium text-foreground tabular-nums">
                {value}
              </span>
            </span>
          ))}
        </div>
      )}

      {!models ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : models.length === 0 ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed">
          <Boxes className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No models yet — launch a run from the Foundry to train one.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              selected={selected.includes(model.id)}
              selectionFull={selected.length >= MAX_COMPARE}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
    </main>
  );
}
