"use client";

import { use } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Download, Rocket } from "lucide-react";
import { toast } from "sonner";
import { InferencePlayground } from "@/components/registry/inference-playground";
import { ModelCardView } from "@/components/registry/model-card";
import { AccuracyCurves, LossCurves, MapCurves } from "@/components/registry/training-curves";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { ModelArtifact, ModelExportFormat } from "@/lib/api/types";

const EXPORT_FORMATS: { format: ModelExportFormat; label: string; hint: string }[] = [
  { format: "onnx", label: "ONNX", hint: "runtime-agnostic" },
  { format: "torchscript", label: "TorchScript", hint: "PyTorch C++/mobile" },
  { format: "openvino", label: "OpenVINO", hint: "Intel CPU · zip" },
];

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
    mutationFn: (format: ModelExportFormat) =>
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
    <main className="page-enter mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <header className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link href="/models">
            <ArrowLeft className="size-3.5" />
            Model Registry
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {model.name}{" "}
              <span className="text-muted-foreground">v{model.version}</span>
            </h1>
            <Badge variant="outline" className="font-mono uppercase">
              {model.architecture}
            </Badge>
            {model.task && model.task !== "detect" && (
              <Badge variant="outline" className="capitalize">
                {model.task === "obb" ? "Rotated boxes" : model.task}
              </Badge>
            )}
            <Badge variant={model.status === "ready" ? "default" : "secondary"}>
              {model.status}
            </Badge>
          </div>
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={exportModel.isPending}>
                  <Download className="size-3.5" />
                  Export
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(model.architecture.startsWith("rf-detr")
                  ? EXPORT_FORMATS.filter((f) => f.format === "onnx")
                  : EXPORT_FORMATS
                ).map((f) => (
                  <DropdownMenuItem
                    key={f.format}
                    onClick={() => exportModel.mutate(f.format)}
                  >
                    {f.label}
                    <span className="ml-auto pl-4 text-xs text-muted-foreground">
                      {f.hint}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
                Managed endpoints are on the roadmap — try the inference
                playground below for live predictions
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
        {model.metrics.top1 !== undefined && model.metrics.top1 !== null ? (
          <>
            <MetricTile label="Top-1 accuracy" value={model.metrics.top1.toFixed(3)} />
            <MetricTile label="Top-5 accuracy" value={(model.metrics.top5 ?? 0).toFixed(3)} />
            <MetricTile label="Classes" value={String(model.classes.length)} />
            <MetricTile label="Epochs" value={String(model.metrics.epochsRun)} />
          </>
        ) : (
          <>
            <MetricTile label="mAP@50" value={model.metrics.map50.toFixed(3)} />
            <MetricTile label="mAP@50–95" value={model.metrics.map5095.toFixed(3)} />
            <MetricTile label="Precision" value={model.metrics.precision.toFixed(3)} />
            <MetricTile label="Recall" value={model.metrics.recall.toFixed(3)} />
          </>
        )}
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
            <CardTitle>
              {model.task === "classify" ? "Validation accuracy" : "Validation mAP"}
            </CardTitle>
            <CardDescription>Accuracy convergence per epoch</CardDescription>
          </CardHeader>
          <CardContent>
            {model.task === "classify" ? (
              <AccuracyCurves curves={model.curves} />
            ) : (
              <MapCurves curves={model.curves} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <InferencePlayground model={model} />
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
      </div>

      {model.modelCard && <ModelCardView card={model.modelCard} />}
    </main>
  );
}
