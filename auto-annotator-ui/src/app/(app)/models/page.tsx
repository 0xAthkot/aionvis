"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function ModelCard({ model }: { model: ModelArtifact }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
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
          <Metric label="mAP@50" value={model.metrics.map50.toFixed(3)} />
          <Metric label="mAP@50–95" value={model.metrics.map5095.toFixed(3)} />
          <Metric label="Precision" value={model.metrics.precision.toFixed(3)} />
          <Metric label="Recall" value={model.metrics.recall.toFixed(3)} />
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

export default function ModelsPage() {
  const { data: models } = useQuery({
    queryKey: ["models"],
    queryFn: () => api<ModelArtifact[]>(endpoints.models.list()),
  });

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Model Registry</h1>
        <p className="text-sm text-muted-foreground">
          Deployable YOLO weights produced by the agent swarm.
        </p>
      </header>

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
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      )}
    </main>
  );
}
