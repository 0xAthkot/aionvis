"use client";

import { use } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Grid3x3, Rocket } from "lucide-react";
import { toast } from "sonner";
import { LossCurves, MapCurves } from "@/components/registry/training-curves";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api, apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { ModelArtifact } from "@/lib/api/types";

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function ModelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data: model } = useQuery({
    queryKey: ["model", id],
    queryFn: () => api<ModelArtifact>(endpoints.models.get(id)),
  });

  const exportModel = useMutation({
    mutationFn: (format: "pt" | "onnx") =>
      apiPost<{ downloadUrl: string }>(endpoints.models.export(id), { format }),
    onSuccess: (res, format) =>
      toast.success(`Export ready (${format.toUpperCase()})`, {
        description: `${res.downloadUrl} — served by the backend once connected.`,
      }),
    onError: (err) => toast.error("Export failed", { description: err.message }),
  });

  if (!model) {
    return (
      <main className="flex flex-1 flex-col gap-6 p-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link href="/models">
            <ArrowLeft className="size-3.5" />
            Model Registry
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">
              {model.name}{" "}
              <span className="text-muted-foreground">v{model.version}</span>
            </h1>
            <Badge variant="outline" className="font-mono uppercase">
              {model.architecture}
            </Badge>
            <Badge variant={model.status === "ready" ? "default" : "secondary"}>
              {model.status}
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={exportModel.isPending}
              onClick={() => exportModel.mutate("onnx")}
            >
              <Download className="size-3.5" />
              ONNX
            </Button>
            <Button
              size="sm"
              disabled={exportModel.isPending}
              onClick={() => exportModel.mutate("pt")}
            >
              <Download className="size-3.5" />
              Download .pt
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" variant="secondary" disabled>
                    <Rocket className="size-3.5" />
                    Deploy endpoint
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Inference endpoints ship with the backend integration
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {model.fileName} · {model.fileSizeMb.toFixed(1)} MB · trained{" "}
          {new Date(model.createdAt).toLocaleString()} on {model.trainedOn.gpu}{" "}
          ({model.trainedOn.vramGb} GB, ROCm {model.trainedOn.rocmVersion}) ·{" "}
          {model.metrics.epochsRun} epochs in {model.metrics.trainingTimeMin} min
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile label="mAP@50" value={model.metrics.map50.toFixed(3)} />
        <MetricTile label="mAP@50–95" value={model.metrics.map5095.toFixed(3)} />
        <MetricTile label="Precision" value={model.metrics.precision.toFixed(3)} />
        <MetricTile label="Recall" value={model.metrics.recall.toFixed(3)} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Training loss</CardTitle>
            <CardDescription>Box and class loss per epoch</CardDescription>
          </CardHeader>
          <CardContent>
            <LossCurves curves={model.curves} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Validation mAP</CardTitle>
            <CardDescription>Accuracy convergence per epoch</CardDescription>
          </CardHeader>
          <CardContent>
            <MapCurves curves={model.curves} />
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Provenance</CardTitle>
            <CardDescription>
              Full lineage from prompt to weights
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Produced by run</dt>
                <dd>
                  <Link
                    href={`/runs/${model.runId}`}
                    className="font-medium hover:underline"
                  >
                    {model.runId}
                  </Link>
                </dd>
              </div>
              {model.datasetId && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Trained on dataset</dt>
                  <dd>
                    <Link
                      href={`/datasets/${model.datasetId}`}
                      className="font-medium hover:underline"
                    >
                      {model.datasetId}
                    </Link>
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Classes</dt>
                <dd className="font-mono text-xs">
                  {model.classes.join(", ")}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Node</dt>
                <dd className="font-mono text-xs">
                  {model.trainedOn.nodeName}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Confusion matrix</CardTitle>
            <CardDescription>Per-class error analysis</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed">
              <Grid3x3 className="size-6 text-muted-foreground" />
              <p className="px-6 text-center text-xs text-muted-foreground">
                Computed by the evaluation service on the backend — the
                contract reserves this panel.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
