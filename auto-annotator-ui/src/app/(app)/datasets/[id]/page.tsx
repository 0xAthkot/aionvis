"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Download, X } from "lucide-react";
import { toast } from "sonner";
import { BBoxImage } from "@/components/datasets/bbox-image";
import { DatasetAnalyticsPanel } from "@/components/datasets/dataset-analytics";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, apiPatch, apiPost } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  AnnotatedImage,
  Dataset,
  DatasetExportRequest,
  Paginated,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "accepted" | "rejected";

const curationBadge: Record<
  AnnotatedImage["curationState"],
  { label: string; className: string }
> = {
  accepted: { label: "Accepted", className: "bg-emerald-500/15 text-emerald-400" },
  rejected: { label: "Rejected", className: "bg-destructive/15 text-destructive" },
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
};

export default function DatasetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: dataset } = useQuery({
    queryKey: ["dataset", id],
    queryFn: () => api<Dataset>(endpoints.datasets.get(id)),
  });
  const { data: imagePage } = useQuery({
    queryKey: ["dataset-images", id],
    queryFn: () =>
      api<Paginated<AnnotatedImage>>(endpoints.datasets.images(id)),
  });

  const curate = useMutation({
    mutationFn: ({
      imageId,
      curationState,
    }: {
      imageId: string;
      curationState: "accepted" | "rejected";
    }) =>
      apiPatch<AnnotatedImage>(endpoints.datasets.curateImage(id, imageId), {
        curationState,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Paginated<AnnotatedImage>>(
        ["dataset-images", id],
        (old) =>
          old && {
            ...old,
            items: old.items.map((img) =>
              img.id === updated.id ? updated : img,
            ),
          },
      );
    },
  });

  const exportDataset = useMutation({
    mutationFn: (format: DatasetExportRequest["format"]) =>
      apiPost<{ downloadUrl: string }>(endpoints.datasets.export(id), {
        format,
      }),
    onSuccess: (res, format) => {
      // Trigger the browser download directly — no extra click.
      const a = document.createElement("a");
      a.href = res.downloadUrl;
      a.download = `${id}-${format}.zip`;
      a.click();
      toast.success(`${format.toUpperCase()} export ready`, {
        description: "Training-ready archive — images, labels and metadata.",
      });
    },
    onError: (err) =>
      toast.error("Export failed", { description: err.message }),
  });

  const images = useMemo(() => imagePage?.items ?? [], [imagePage]);
  const filtered = useMemo(
    () =>
      filter === "all"
        ? images
        : images.filter((img) => img.curationState === filter),
    [images, filter],
  );
  const selected = images.find((img) => img.id === selectedId) ?? null;

  const acceptRate =
    images.length > 0
      ? Math.round(
          (images.filter((i) => i.curationState === "accepted").length /
            images.length) *
            100,
        )
      : 0;

  if (!dataset) {
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
          <Link href="/datasets">
            <ArrowLeft className="size-3.5" />
            All datasets
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {dataset.name}
            </h1>
            <Badge variant="secondary">
              {dataset.origin === "synthetic" ? "Synthetic" : "BYOD"}
            </Badge>
            <Badge variant={dataset.status === "ready" ? "default" : "outline"}>
              {dataset.status}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["yolo", "coco", "voc", "csv"] as const).map((format) => (
              <Button
                key={format}
                variant="outline"
                size="sm"
                disabled={exportDataset.isPending || dataset.status !== "ready"}
                onClick={() => exportDataset.mutate(format)}
              >
                <Download className="size-3.5" />
                {format.toUpperCase()}
              </Button>
            ))}
            {dataset.runId && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/runs/${dataset.runId}`}>
                  Producing run <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {dataset.imageCount.toLocaleString()} images ·{" "}
          {dataset.labeledCount.toLocaleString()} labeled ·{" "}
          {(dataset.sizeMb / 1024).toFixed(1)} GB · created{" "}
          {new Date(dataset.createdAt).toLocaleDateString()}
        </p>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>Curation</CardTitle>
                <CardDescription>
                  Sample of {images.length} — accept or reject the Critic&apos;s
                  work · {acceptRate}% accepted
                </CardDescription>
              </div>
              <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="accepted">Accepted</TabsTrigger>
                  <TabsTrigger value="rejected">Rejected</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent>
            {!imagePage ? (
              <Skeleton className="h-72 w-full" />
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No {filter} images in this sample.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {filtered.map((image) => (
                  <figure key={image.id} className="group relative">
                    <button
                      type="button"
                      className="block w-full rounded-md ring-primary focus-visible:ring-2"
                      onClick={() => setSelectedId(image.id)}
                    >
                      <BBoxImage image={image} classes={dataset.classes} />
                    </button>
                    <span
                      className={cn(
                        "absolute top-1.5 left-1.5 rounded-sm px-1.5 py-0.5 text-[10px] font-medium",
                        curationBadge[image.curationState].className,
                      )}
                    >
                      {curationBadge[image.curationState].label}
                    </span>
                    <div className="absolute top-1 right-1 hidden gap-1 group-hover:flex">
                      <Button
                        size="icon"
                        variant="secondary"
                        className="size-6"
                        aria-label="Accept"
                        disabled={curate.isPending}
                        onClick={() =>
                          curate.mutate({
                            imageId: image.id,
                            curationState: "accepted",
                          })
                        }
                      >
                        <Check className="size-3 text-emerald-400" />
                      </Button>
                      <Button
                        size="icon"
                        variant="secondary"
                        className="size-6"
                        aria-label="Reject"
                        disabled={curate.isPending}
                        onClick={() =>
                          curate.mutate({
                            imageId: image.id,
                            curationState: "rejected",
                          })
                        }
                      >
                        <X className="size-3 text-destructive" />
                      </Button>
                    </div>
                    <figcaption className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                      {image.fileName}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <DatasetAnalyticsPanel datasetId={id} />
      </div>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono text-base">
                  {selected.fileName}
                </DialogTitle>
                <DialogDescription>
                  {selected.width}×{selected.height} · split: {selected.split}
                </DialogDescription>
              </DialogHeader>
              <BBoxImage
                image={selected}
                classes={dataset.classes}
                showLabels
              />
              {selected.critique && (
                <div
                  className={cn(
                    "rounded-lg border p-3 text-sm",
                    selected.critique.verdict === "rejected"
                      ? "border-destructive/40 bg-destructive/10"
                      : "border-emerald-500/30 bg-emerald-500/10",
                  )}
                >
                  <p className="font-medium capitalize">
                    Critic verdict: {selected.critique.verdict}
                    {selected.critique.iou !== undefined &&
                      ` · IoU ${selected.critique.iou}`}
                    {` · ${selected.critique.attempts} attempt${selected.critique.attempts > 1 ? "s" : ""}`}
                  </p>
                  {selected.critique.reason && (
                    <p className="mt-1 text-muted-foreground">
                      {selected.critique.reason}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selected.critique.critic}
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={curate.isPending}
                  onClick={() =>
                    curate.mutate({
                      imageId: selected.id,
                      curationState: "rejected",
                    })
                  }
                >
                  <X className="size-3.5 text-destructive" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  disabled={curate.isPending}
                  onClick={() =>
                    curate.mutate({
                      imageId: selected.id,
                      curationState: "accepted",
                    })
                  }
                >
                  <Check className="size-3.5" />
                  Accept
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
